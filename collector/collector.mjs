import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cpus, homedir, totalmem } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadConfig, mergeConfig } from './config.mjs';
import { run } from './lib/exec.mjs';
import { TailReader } from './lib/tail-reader.mjs';
import { SessionModel } from './transcript/session-model.mjs';
import { readRegistry } from './sources/registry.mjs';
import { readAgentsCli } from './sources/agents-cli.mjs';
import { childrenIndex, findCodexRoots, findPidByArg, readPs, treeStats } from './sources/ps.mjs';
import { RepoResolver, repoStatus } from './sources/git.mjs';
import { deployStatus } from './sources/gh.mjs';
import { confirmDelivery, readBeacons, readPending, validateAnswers, writeAnswerFile, writeMessageFile } from './sources/pending.mjs';
import { listFolder, readFolderFile } from './sources/files.mjs';
import { checkImages, pruneUploads, saveImages, withScreenshots } from './sources/uploads.mjs';
import { compactSummary, memoryFiles, scratchpadOf } from './sources/memory.mjs';
import { applySince, buildAgent, countStates, sortAgents } from './derive/agent.mjs';
import { findCollisions } from './derive/collisions.mjs';
import { AlertEngine, notifyMac } from './alerts.mjs';
import { createTrackerServer } from './server.mjs';
import { renderTranscriptPage } from './transcript-page.mjs';

const DOC_FILE = /\.(md|markdown|mdx)$/i;
const DOC_MAX_BYTES = 2 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CPU_HISTORY_MS = 10 * 60_000;
const SUBAGENT_LOOKBACK_MS = 60 * 60_000;

export function makeLogger(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'collector.log');
  return message => {
    try {
      if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // logging must never take the collector down
    }
  };
}

function loadToken(path) {
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // created below
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

export async function startCollector({ root, claudeDir = join(homedir(), '.claude'), claudeBin = 'claude', home = homedir(), scratchBase = `/private/tmp/claude-${process.getuid?.() ?? 0}`, port: portOverride, deliveryTimeoutMs = 5000, notify = notifyMac, log = makeLogger(join(root, 'logs')) }) {
  const stateDir = join(root, 'state');
  const pendingDir = join(stateDir, 'pending');
  const answersDir = join(stateDir, 'answers');
  const modsDir = join(stateDir, 'mods');
  const messagesDir = join(stateDir, 'messages');
  const uploadsDir = join(stateDir, 'uploads');
  for (const dir of [stateDir, pendingDir, answersDir, modsDir, messagesDir, uploadsDir]) mkdirSync(dir, { recursive: true });
  const configPath = join(root, 'config.json');

  const sources = {};
  const markOk = name => { sources[name] = { ok: true, at: Date.now() }; };
  const markFail = (name, err) => {
    const error = String(err?.message ?? err).slice(0, 200);
    if (sources[name]?.ok !== false || sources[name].error !== error) log(`${name}: ${error}`);
    sources[name] = { ok: false, error, at: Date.now() };
  };

  // A bad config.json must not stop the service: launchd would restart it forever.
  let cfg;
  try {
    cfg = loadConfig(configPath);
    markOk('config');
  } catch (err) {
    cfg = mergeConfig({});
    markFail('config', err);
  }
  const token = loadToken(join(stateDir, 'token'));
  const tail = new TailReader();
  const sessions = new Map();
  const cpuHist = new Map();
  const resolver = new RepoResolver();
  const repoInfo = new Map();
  const deploys = new Map();
  const alerts = new AlertEngine({ cfg, notify, startedAt: Date.now() });
  const timers = [];
  const watchers = [];
  let registry = [];
  let cliAgents = [];
  let procs = new Map();
  let prevAgents = new Map();
  let snapshot = null;
  let server = null;
  let isResolving = false;
  let cpuMark = { usage: process.cpuUsage(), at: Date.now() };

  // A session resumed from another folder leaves a frozen copy of its transcript in the old
  // project; the live one is the most recently written.
  function findTranscript(sessionId) {
    const projects = join(claudeDir, 'projects');
    let dirs;
    try { dirs = readdirSync(projects); } catch { return null; }
    let best = null;
    for (const d of dirs) {
      const p = join(projects, d, `${sessionId}.jsonl`);
      try {
        const mtime = statSync(p).mtimeMs;
        if (!best || mtime > best.mtime) best = { path: p, mtime };
      } catch { /* not in this project */ }
    }
    return best?.path ?? null;
  }

  function sessionRecord(sessionId, now) {
    let rec = sessions.get(sessionId);
    if (!rec) {
      rec = { path: null, lookedAt: 0, model: new SessionModel(), childModels: new Map(), childPaths: new Map(), metaSeen: new Set() };
      sessions.set(sessionId, rec);
    }
    if (!rec.path && now - rec.lookedAt > 10_000) {
      rec.lookedAt = now;
      rec.path = findTranscript(sessionId);
    }
    return rec;
  }

  function readSubagents(sessionId, rec, now) {
    const wanted = [...rec.model.children.values()].filter(c => c.kind === 'subagent' && (c.state === 'running' || now - c.startedAt < SUBAGENT_LOOKBACK_MS));
    if (!wanted.length) return;
    const dir = join(dirname(rec.path), sessionId, 'subagents');
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith('.meta.json') || rec.metaSeen.has(name)) continue;
      try {
        const meta = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        if (typeof meta.toolUseId === 'string') rec.childPaths.set(meta.toolUseId, join(dir, name.replace(/\.meta\.json$/, '.jsonl')));
        rec.metaSeen.add(name);
      } catch {
        // half-written meta: retried next tick
      }
    }
    for (const child of wanted) {
      const path = rec.childPaths.get(child.id);
      if (!path) continue;
      if (!rec.childModels.has(child.id)) rec.childModels.set(child.id, new SessionModel());
      rec.childModels.get(child.id).applyLines(tail.read(path));
    }
  }

  function computeBases() {
    const bases = new Map();
    for (const r of registry) {
      bases.set(r.sessionId, { id: r.sessionId, kind: r.kind === 'background' ? 'background' : 'interactive', name: r.name, cwd: r.cwd, pid: r.pid, registry: r });
    }
    for (const c of cliAgents) {
      const known = bases.get(c.sessionId);
      if (known) { known.cliId = c.id; continue; }
      bases.set(c.sessionId, { id: c.sessionId, kind: c.kind, name: c.name, cwd: c.cwd, pid: c.pid ?? findPidByArg(procs, c.sessionId), cliId: c.id });
    }
    return bases;
  }

  function selfStats() {
    const now = Date.now();
    const used = process.cpuUsage(cpuMark.usage);
    const elapsedMs = Math.max(1, now - cpuMark.at);
    cpuMark = { usage: process.cpuUsage(), at: now };
    return {
      pid: process.pid,
      cpu: Math.round(((used.user + used.system) / 1000 / elapsedMs) * 1000) / 10,
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      claudeVersion: registry[0]?.version || undefined,
    };
  }

  function reposFor(agents) {
    const map = new Map();
    const ensure = path => {
      if (!map.has(path)) map.set(path, { ...(repoInfo.get(path) ?? { path, name: basename(path) }), deploy: deploys.get(path), agentIds: [] });
      return map.get(path);
    };
    for (const path of Object.keys(cfg.deployRepos)) ensure(path);
    for (const a of agents) {
      for (const t of a.touching) {
        if (!t.repo) continue;
        const r = ensure(t.repo);
        if (!r.agentIds.includes(a.id)) r.agentIds.push(a.id);
      }
    }
    return [...map.values()].sort((x, y) => y.agentIds.length - x.agentIds.length || x.name.localeCompare(y.name));
  }

  function queueResolve(agents) {
    if (isResolving) return;
    const paths = new Set();
    for (const a of agents) for (const t of a.touching) if (resolver.needsRefresh(t.path)) paths.add(t.path);
    if (!paths.size) return;
    isResolving = true;
    Promise.all([...paths].slice(0, 50).map(p => resolver.topOf(p).catch(() => null))).finally(() => { isResolving = false; });
  }

  function recordCpu(id, now, cpu, rssMb) {
    const hist = cpuHist.get(id) ?? [];
    hist.push({ at: now, cpu, rssMb });
    while (hist.length && now - hist[0].at > CPU_HISTORY_MS) hist.shift();
    cpuHist.set(id, hist);
  }

  function writeState(snap) {
    const file = join(stateDir, 'state.json');
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(snap));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      markFail('state', err);
    }
  }

  async function tick(isFull) {
    const now = Date.now();
    if (isFull) {
      try { registry = readRegistry(join(claudeDir, 'sessions')); markOk('registry'); } catch (err) { markFail('registry', err); }
      try { procs = await readPs(); markOk('ps'); } catch (err) { markFail('ps', err); }
    }
    const bases = computeBases();
    const { bySession: offers, expired } = readPending(pendingDir, now);
    const beacons = readBeacons(modsDir, now);
    for (const path of expired) {
      try { unlinkSync(path); } catch { /* the mod may have removed it already */ }
    }
    for (const [id, rec] of sessions) {
      if (bases.has(id)) continue;
      if (rec.path) tail.forget(rec.path);
      sessions.delete(id);
    }
    for (const id of bases.keys()) {
      const rec = sessionRecord(id, now);
      if (!rec.path) continue;
      rec.model.applyLines(tail.read(rec.path));
      readSubagents(id, rec, now);
    }

    const idx = childrenIndex(procs);
    const codex = findCodexRoots(procs).map(p => ({ id: `codex:${p.pid}`, kind: 'codex', name: 'Codex (VS Code)', cwd: '', pid: p.pid }));
    const agents = [];
    for (const base of [...bases.values(), ...codex]) {
      const proc = base.pid ? treeStats(procs, base.pid, idx) : null;
      if (isFull && proc) recordCpu(base.id, now, proc.cpu, proc.rssMb);
      const rec = base.kind === 'codex' ? undefined : sessions.get(base.id);
      const agent = buildAgent({
        base, model: rec?.model ?? null, registry: base.registry, proc, cpuHistory: cpuHist.get(base.id) ?? [],
        childModels: rec?.childModels, offer: offers.get(base.id), beacon: beacons.get(base.id), repoOf: p => resolver.lookup(p), now, cfg, home,
      });
      agents.push(applySince(agent, prevAgents.get(agent.id), now));
    }
    const liveIds = new Set(agents.map(a => a.id));
    for (const id of [...cpuHist.keys()]) if (!liveIds.has(id)) cpuHist.delete(id);

    queueResolve(agents);
    const collisions = findCollisions(agents, now, cfg.collisionWindowMin * 60_000);
    snapshot = {
      generatedAt: now,
      settings: { modToasts: cfg.modToasts, permissionDashboardSec: cfg.permissionDashboardSec, memoryAlertGb: cfg.memoryAlertGb },
      collector: selfStats(),
      machine: { totalMemMb: Math.round(totalmem() / 1_048_576), cpuCount: cpus().length },
      sources: { ...sources },
      counts: countStates(agents, collisions),
      agents: sortAgents(agents),
      repos: reposFor(agents),
      collisions,
    };
    prevAgents = new Map(agents.map(a => [a.id, a]));
    alerts.process(snapshot, now, cpuHist);
    writeState(snapshot);
    server?.broadcast(snapshot);
  }

  let chain = Promise.resolve();
  const schedule = isFull => (chain = chain.then(() => tick(isFull)).catch(err => log(`tick failed: ${err?.stack ?? err}`)));
  let lightTimer = null;
  const scheduleLight = () => {
    if (lightTimer) return;
    lightTimer = setTimeout(() => { lightTimer = null; schedule(false); }, 250);
  };

  async function pollAgents() {
    try { cliAgents = await readAgentsCli(claudeBin); markOk('agents'); } catch (err) { markFail('agents', err); }
  }

  async function pollGit() {
    let failed = null;
    for (const r of snapshot?.repos ?? []) {
      try { repoInfo.set(r.path, await repoStatus(r.path)); } catch (err) { failed = err; }
    }
    if (failed) markFail('git', failed); else markOk('git');
  }

  async function pollDeploys() {
    const entries = Object.entries(cfg.deployRepos);
    if (!entries.length) return;
    let failed = null;
    for (const [path, repo] of entries) {
      try { deploys.set(path, await deployStatus(repo)); } catch (err) { failed = err; }
    }
    if (failed) markFail('gh', failed); else markOk('gh');
  }

  function startTimers() {
    for (const t of timers.splice(0)) clearInterval(t);
    timers.push(setInterval(() => schedule(true), cfg.pollMs));
    timers.push(setInterval(() => void pollAgents(), cfg.agentsCliPollMs));
    timers.push(setInterval(() => void pollGit(), cfg.gitPollMs));
    timers.push(setInterval(() => void pollDeploys(), cfg.deployPollMs));
    timers.push(setInterval(() => pruneUploads(uploadsDir, Date.now()), 3_600_000));
  }

  function reloadConfig() {
    try {
      cfg = loadConfig(configPath);
      alerts.setConfig(cfg);
      markOk('config');
      startTimers();
    } catch (err) {
      markFail('config', err);
    }
    return schedule(true);
  }

  function modelFor(id) {
    const [sessionId, childId] = id.split(':');
    const rec = sessions.get(sessionId);
    if (!rec) return null;
    return childId ? rec.childModels.get(childId) ?? null : rec.model;
  }

  async function getTranscriptHtml(id) {
    const rec = sessions.get(id);
    if (!rec?.path) return null;
    const model = new SessionModel({ feedCap: 500 });
    model.applyLines(new TailReader({ initialBytes: 2 * 1024 * 1024 }).read(rec.path));
    const agent = snapshot?.agents.find(a => a.id === id);
    return renderTranscriptPage(agent?.name ?? id, model.feed);
  }

  /** A markdown file the agent wrote or read, for the dashboard's reader; anything else is refused. */
  function readDoc(agentId, path) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent?.docs?.some(d => d.path === path)) return { status: 404, error: 'That document is not one this agent has opened.' };
    try {
      const real = realpathSync(path);
      const st = statSync(real);
      if (!DOC_FILE.test(real) || !st.isFile()) return { status: 403, error: 'Only markdown files can be shown here.' };
      if (st.size > DOC_MAX_BYTES) return { status: 413, error: 'That file is too large to show here (2 MB at most).' };
      return { doc: { path, text: readFileSync(real, 'utf8'), mtimeMs: st.mtimeMs, size: st.size } };
    } catch (err) {
      if (err.code === 'ENOENT') return { status: 404, error: 'That file no longer exists.' };
      return { status: 500, error: `Could not read it (${err.code ?? err.message}).` };
    }
  }

  // The explorer: the agent's working folder, with the files the agent itself touched marked.
  const listings = new Map(); // agent id → { at, value }, so several open pages share one git call
  const browsable = agent => Boolean(agent?.cwd) && agent.kind !== 'codex' && agent.cwd !== home && agent.cwd !== '/';

  function touchedIn(agentId, cwd) {
    const rec = sessions.get(agentId);
    const out = {};
    for (const m of rec ? [rec.model, ...rec.childModels.values()] : []) {
      for (const f of m?.touchedFiles() ?? []) {
        if (!f.path.startsWith(`${cwd}/`)) continue;
        const rel = f.path.slice(cwd.length + 1);
        const prev = out[rel];
        out[rel] = prev ? { wrote: prev.wrote || f.wrote, at: Math.max(prev.at, f.at) } : { wrote: f.wrote, at: f.at };
      }
    }
    return out;
  }

  const cachedListing = async (key, dir) => {
    const hit = listings.get(key);
    if (hit && Date.now() - hit.at < 2000) return hit.value;
    const value = await listFolder(dir, { home });
    listings.set(key, { at: Date.now(), value });
    return value;
  };
  const memoryOf = agent => memoryFiles({ cwd: agent.cwd, home, claudeDir, transcriptPath: sessions.get(agent.id)?.path ?? null });

  /** The explorer: the agent's folder, its session's scratchpad, and what the session remembers. */
  async function listFiles(agentId) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent || agent.kind === 'codex') return { status: 404, error: 'That agent was not found, or has no folder.' };
    const folder = agent.cwd ? await cachedListing(agentId, agent.cwd) : { error: 'This agent has no folder.' };
    const scratchRoot = scratchpadOf(agentId, scratchBase, agent.cwd);
    const scratch = scratchRoot ? { root: scratchRoot, ...(await cachedListing(`scratch:${agentId}`, scratchRoot)) } : null;
    return {
      root: agent.cwd,
      ...(folder.error ? { git: false, files: [], status: {}, repos: [], truncated: false, folderError: folder.error } : folder),
      touched: agent.cwd ? touchedIn(agentId, agent.cwd) : {},
      scratch: scratch && !scratch.error ? { ...scratch, touched: touchedIn(agentId, scratchRoot) } : null,
      memory: memoryOf(agent),
    };
  }

  /** A file from the agent's folder or scratchpad, its memory, its conversation summary, or a document it opened. */
  async function readFile(agentId, path) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent) return { status: 404, error: 'That agent was not found.' };
    if (typeof path !== 'string') return { status: 403, error: "That file is outside the agent's folder." };
    if (path === '@summary') {
      const transcript = sessions.get(agentId)?.path;
      const summary = transcript ? compactSummary(transcript) : null;
      return summary
        ? { doc: { path, text: summary.text, mtimeMs: summary.at, size: summary.text.length } }
        : { status: 404, error: "This session hasn't been compacted yet, so it still holds the whole conversation. Open Full transcript to read it." };
    }
    if (agent.kind !== 'codex' && memoryOf(agent).some(m => m.path === path)) return readFolderFile(dirname(path), path);
    const scratchRoot = agent.kind === 'codex' ? null : scratchpadOf(agentId, scratchBase, agent.cwd);
    if (scratchRoot && path.startsWith(`${scratchRoot}/`)) return readFolderFile(scratchRoot, path);
    if (browsable(agent) && path.startsWith(`${agent.cwd}/`)) return readFolderFile(agent.cwd, path);
    const doc = readDoc(agentId, path);
    return doc.doc ? doc : { status: 403, error: "That file is outside the agent's folder." };
  }

  // The mod deletes the answer file once it has handed the answer to Claude. If that doesn't
  // happen within the timeout, the session isn't listening: withdraw it and say so.
  async function deliver(toolUseId, payload) {
    writeAnswerFile(answersDir, toolUseId, payload);
    return confirmDelivery(join(answersDir, `${toolUseId}.json`), { timeoutMs: deliveryTimeoutMs, failure: "The session didn't take the answer. Please answer it in its terminal." });
  }

  const askFor = (agentId, toolUseId, kind) => {
    const ask = snapshot?.agents.find(a => a.id === agentId)?.ask;
    return ask && ask.kind === kind && ask.toolUseId === toolUseId ? ask : undefined;
  };

  const actions = {
    async message(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!agent || agent.kind === 'codex') return { ok: false, error: 'That session was not found.' };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const checked = checkImages(body.images);
      if (checked.error) return { ok: false, error: checked.error };
      if (!text && !checked.images.length) return { ok: false, error: 'Type a message first.' };
      if (text.length > 20_000) return { ok: false, error: 'That message is too long (20,000 characters at most).' };
      if (!agent.mod?.live) return { ok: false, error: "That session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session." };
      const shots = saveImages(uploadsDir, agent.id, checked.images);
      const file = writeMessageFile(messagesDir, agent.id, withScreenshots(text, shots));
      return confirmDelivery(file, { timeoutMs: deliveryTimeoutMs, failure: "The session didn't pick up the message. Please send it in its terminal." });
    },
    async answer(body) {
      const ask = askFor(body?.agentId, body?.toolUseId, 'question');
      if (!ask) return { ok: false, error: 'That question is no longer waiting.' };
      const checked = validateAnswers(ask.questions, body.answers);
      if (checked.error) return { ok: false, error: checked.error };
      return deliver(ask.toolUseId, { answers: checked.answers });
    },
    async permit(body) {
      const ask = askFor(body?.agentId, body?.toolUseId, 'permission');
      if (!ask || ask.expiresAt <= Date.now()) return { ok: false, error: 'That permission prompt is no longer waiting.' };
      if (body.decision !== 'allow' && body.decision !== 'deny') return { ok: false, error: 'Choose Allow or Deny.' };
      return deliver(ask.toolUseId, { decision: body.decision });
    },
    async open(id) {
      const agent = ID_RE.test(id) ? snapshot?.agents.find(a => a.id === id || a.cliId === id) : undefined;
      if (!agent) return { ok: false, error: 'unknown agent' };
      if (agent.kind !== 'background' || !agent.cliId || !ID_RE.test(agent.cliId)) return { ok: false, error: 'only background sessions can be opened from here' };
      const res = await run('osascript', ['-e', 'on run argv', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', 'do script ("claude attach " & item 1 of argv)', '-e', 'end tell', '-e', 'end run', agent.cliId]);
      return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr.trim().slice(0, 200) };
    },
    async rm(ids) {
      const results = [];
      for (const id of ids.slice(0, 50)) {
        const agent = typeof id === 'string' && ID_RE.test(id) ? snapshot?.agents.find(a => a.id === id) : undefined;
        if (!agent || agent.kind !== 'background' || agent.state !== 'stale' || !agent.cliId) {
          results.push({ id: String(id), ok: false, error: 'not a stale background session' });
          continue;
        }
        const res = await run(claudeBin, ['rm', agent.cliId], { timeoutMs: 30_000 });
        results.push(res.code === 0 ? { id, ok: true } : { id, ok: false, error: res.stderr.trim().slice(0, 200) });
      }
      await pollAgents();
      schedule(true);
      return { results };
    },
  };

  await pollAgents();
  await schedule(true);

  server = createTrackerServer({
    port: portOverride ?? cfg.port, token, webFile: join(root, 'web', 'index.html'),
    getSnapshot: () => snapshot,
    getFeed: (id, limit) => modelFor(id)?.feed.slice(0, limit) ?? null,
    getTranscriptHtml, getDoc: readDoc, listFiles, readFile, actions, log,
  });
  const port = await server.listen();

  try {
    watchers.push(watch(pendingDir, () => scheduleLight()));
    watchers.push(watch(join(claudeDir, 'projects'), { recursive: true }, (_event, name) => {
      if (String(name ?? '').endsWith('.jsonl')) scheduleLight();
    }));
  } catch (err) {
    markFail('watch', err);
  }
  let configTimer = null;
  watchers.push(watch(root, (_event, name) => {
    if (name !== 'config.json') return;
    clearTimeout(configTimer);
    configTimer = setTimeout(() => void reloadConfig(), 200);
  }));

  startTimers();
  pruneUploads(uploadsDir, Date.now());
  void pollGit();
  void pollDeploys();
  log(`collector started on 127.0.0.1:${port}`);

  async function stop() {
    for (const t of timers.splice(0)) clearInterval(t);
    clearTimeout(lightTimer);
    clearTimeout(configTimer);
    for (const w of watchers) w.close();
    await chain;
    await server.close();
  }

  return { port, getSnapshot: () => snapshot, reloadConfig, actions, readDoc, listFiles, readFile, stop };
}
