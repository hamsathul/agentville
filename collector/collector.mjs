import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cpus, homedir, tmpdir, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig, mergeConfig } from './config.mjs';
import { run } from './lib/exec.mjs';
import { TailReader } from './lib/tail-reader.mjs';
import { SessionModel } from './transcript/session-model.mjs';
import { Conversation } from './transcript/conversation.mjs';
import { earlierHistory } from './transcript/backfill.mjs';
import { readRegistry } from './sources/registry.mjs';
import { readAgentsCli } from './sources/agents-cli.mjs';
import { childrenIndex, findCodexRoots, findPidByArg, isShellCommand, readPs, shellsOf, treeStats } from './sources/ps.mjs';
import { GIT_ENV, RepoResolver, githubSlug, repoStatus } from './sources/git.mjs';
import { deployStatus, pullRequests } from './sources/gh.mjs';
import { confirmDelivery, modAtLeast, readBeacons, readPending, readReplies, validateAnswers, writeAnswerFile, writeMessageFile, writeRequestFile } from './sources/pending.mjs';
import { checkFolderFile, listFolder, parsePorcelain, readFolderFile } from './sources/files.mjs';
import { listDirs, makeDir, startPlace } from './sources/folders.mjs';
import { contentTypeOf, parseCsv, readXlsx, viewOf } from './sources/previews.mjs';
import { repoFiles } from './derive/repo-files.mjs';
import { checkFiles, checkFolders, pruneUploads, saveFiles, typedPart, withAttachments } from './sources/uploads.mjs';
import { compactSummary, memoryFiles, scratchpadOf } from './sources/memory.mjs';
import { EFFORTS, MODELS, MODE_FLAGS, SESSION_ID, claudeCommand, closeTerminalScript, forkCommand, listSessions, projectsOf, shellQuote, terminalScript } from './sources/sessions.mjs';
import { appendRewind, cutTranscript, pruneForks, restorePoint } from './sources/fork.mjs';
import { parseMcpList, parsePluginDetails, projectServersOf, readOwnSkills, readRules, removeRule } from './sources/claude-setup.mjs';
import { applySince, buildAgent, countStates, sortAgents } from './derive/agent.mjs';
import { findCollisions } from './derive/collisions.mjs';
import { reposFor } from './derive/repos.mjs';
import { planReadings, planUsage } from './derive/plan.mjs';
import { noteDirectDeploys } from './derive/deploys.mjs';
import { AlertEngine, notifyMac } from './alerts.mjs';
import { createTrackerServer } from './server.mjs';
import { makeWorlds } from './worlds.mjs';
import { renderTranscriptPage } from './transcript-page.mjs';

const DOC_FILE = /\.(md|markdown|mdx)$/i;

// A session's process, for ending it: its command line, its terminal, a signal, whether it still runs.
const systemProcs = {
  commandOf: async pid => { const r = await run('ps', ['-o', 'command=', '-p', String(pid)], { timeoutMs: 5000 }); return r.code === 0 ? r.stdout.trim() : null; },
  ttyOf: async pid => { const r = await run('ps', ['-o', 'tty=', '-p', String(pid)], { timeoutMs: 5000 }); const t = r.code === 0 ? r.stdout.trim() : ''; return /^ttys\d+$/.test(t) ? t : null; },
  kill: (pid, sig) => process.kill(pid, sig),
  alive: pid => { try { process.kill(pid, 0); return true; } catch { return false; } },
  killGroup: (pgid, sig) => process.kill(-pgid, sig), // a shell command and everything it started
  groupAlive: pgid => { try { process.kill(-pgid, 0); return true; } catch { return false; } },
};
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

// macOS's own "Choose a folder" window (it has New Folder), asked of System Events so it comes up in
// front of the browser; the app that was in front gets the focus back after. 5 minutes to pick.
const CHOOSE_FOLDER = ['on run argv', 'set prev to path to frontmost application as text', 'try', 'with timeout of 300 seconds',
  'tell application "System Events"', 'activate', 'set f to choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))', 'end tell',
  'end timeout', 'on error number n', 'try', 'tell application prev to activate', 'end try', 'if n is -128 then return "cancelled"', 'error number n', 'end try',
  'try', 'tell application prev to activate', 'end try', 'return POSIX path of f', 'end run'];

/** Finder's folder window: { path } picked, { cancelled }, or { error }. */
async function chooseFolderMac({ start, prompt }) {
  const r = await run('osascript', [...CHOOSE_FOLDER.flatMap(line => ['-e', line]), start, prompt], { timeoutMs: 310_000 });
  const out = r.stdout.trim();
  if (r.code === 0 && out === 'cancelled') return { cancelled: true };
  if (r.code === 0 && out.startsWith('/')) return { path: out };
  return { error: /-1743|not allowed|Not authorized/i.test(r.stderr) ? 'macOS did not let the tracker open the folder window: allow it to control System Events under System Settings → Privacy & Security → Automation.' : `The folder window could not open (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).` };
}

/** Quick Look's picture of a document's first page (qlmanage -t), as PNG bytes. */
async function quickLookPicture(real) {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-ql-'));
  try {
    const r = await run('qlmanage', ['-t', '-s', '1600', '-o', dir, real], { timeoutMs: 30_000 });
    const png = join(dir, `${basename(real)}.png`);
    if (!existsSync(png)) throw new Error(r.stderr.trim().split('\n')[0] || 'no picture');
    return readFileSync(png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function startCollector({ root, claudeDir = join(homedir(), '.claude'), claudeBin = 'claude', home = homedir(), scratchBase = `/private/tmp/claude-${process.getuid?.() ?? 0}`, port: portOverride, deliveryTimeoutMs = 5000, notify = notifyMac, launch = args => run('osascript', args, { timeoutMs: 15_000 }), sessionProcs = systemProcs, endWaitMs = 8000, readProcs = readPs, deployStatusOf = deployStatus, pullRequestsOf = pullRequests, githubSlugOf = githubSlug, ticketMs = 600_000, quickLook = quickLookPicture, folderRoots = [home, '/Volumes'], chooseFolder = chooseFolderMac, stopWaitMs = 3000, revealFile = real => run('open', ['-R', real], { timeoutMs: 10_000 }), log = makeLogger(join(root, 'logs')) }) {
  // readProcs, deployStatusOf, pullRequestsOf and githubSlugOf read the machine and GitHub; a test or the demo video passes stand-ins.
  const stateDir = join(root, 'state');
  const pendingDir = join(stateDir, 'pending');
  const answersDir = join(stateDir, 'answers');
  const modsDir = join(stateDir, 'mods');
  const messagesDir = join(stateDir, 'messages');
  const uploadsDir = join(stateDir, 'uploads');
  const forksDir = join(stateDir, 'forks'); // transcripts cut at a message, for a fork to start from
  // Model and effort switches and side questions go to a session's mod as files; it writes back what came of them.
  const commandsDir = join(stateDir, 'commands'), resultsDir = join(stateDir, 'command-results');
  const asksDir = join(stateDir, 'btw'), asideAnswersDir = join(stateDir, 'asides');
  for (const dir of [stateDir, pendingDir, answersDir, modsDir, messagesDir, uploadsDir, commandsDir, resultsDir, asksDir, asideAnswersDir]) mkdirSync(dir, { recursive: true });
  const pendingAsides = new Map(); // session → [{ id, question, at }] asked and not answered yet
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
  const prs = new Map(); // repo → { open, merged } pull requests
  const directDeploys = new Map(); // repo → the newest deploy an agent ran itself ({ at, ok, by, summary }), kept while the collector runs
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

  const freshRecord = () => ({ path: null, lookedAt: 0, model: new SessionModel(), childModels: new Map(), childPaths: new Map(), metaSeen: new Set() });
  function sessionRecord(sessionId, now) {
    let rec = sessions.get(sessionId);
    if (rec?.path && !existsSync(rec.path)) { // moved (Claude Code moves it when the session enters a worktree): read afresh where it went
      tail.forget(rec.path);
      rec = null;
    }
    if (!rec) {
      rec = freshRecord();
      sessions.set(sessionId, rec);
    }
    if (!rec.path && now - rec.lookedAt > 10_000) {
      rec.lookedAt = now;
      rec.path = findTranscript(sessionId);
    }
    return rec;
  }

  // After a restart only the tail of each transcript is read. The file calls in the part it
  // skipped are found in the background, one transcript at a time, so the session's documents,
  // explorer marks and field close-ups keep its earlier files.
  const backfilled = new Set();
  let backfills = Promise.resolve();
  let stopped = false;
  function queueBackfill(model, path) {
    if (backfilled.has(path)) return;
    const start = tail.startOf(path);
    if (start === undefined) return;
    backfilled.add(path);
    if (start === 0) return;
    backfills = backfills.then(async () => {
      const earlier = await earlierHistory(path, start);
      if (stopped) return;
      model.addEarlierFiles(earlier.files);
      model.addEarlierSaid(earlier.said);
      model.addEarlierTasks(earlier.tasks);
      model.addEarlierBackground(earlier.background);
      scheduleLight();
    }).catch(err => log(`backfill of ${path} failed: ${err?.stack ?? err}`));
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
      queueBackfill(rec.childModels.get(child.id), path);
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

  const ownFolder = a => Boolean(a.cwd) && a.cwd !== home && a.cwd !== '/';

  function queueResolve(agents) {
    if (isResolving) return;
    const paths = new Set();
    for (const a of agents) {
      for (const t of a.touching) if (resolver.needsRefresh(t.path)) paths.add(t.path);
      if (ownFolder(a) && resolver.needsRefresh(a.cwd)) paths.add(a.cwd);
    }
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
      try { procs = await readProcs(); markOk('ps'); } catch (err) { markFail('ps', err); }
    }
    const bases = computeBases();
    const { bySession: offers, expired } = readPending(pendingDir, now);
    const beacons = readBeacons(modsDir, now);
    const settingResults = readReplies(resultsDir, now, { perSession: 1 }), asideAnswers = readReplies(asideAnswersDir, now, { perSession: 5 });
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
      queueBackfill(rec.model, rec.path);
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
        base, model: rec?.model ?? null, registry: base.registry, proc, command: base.pid ? procs.get(base.pid)?.command : undefined, cpuHistory: cpuHist.get(base.id) ?? [],
        childModels: rec?.childModels, offer: offers.get(base.id), beacon: beacons.get(base.id), repoOf: p => resolver.lookup(p), now, cfg, home,
        asides: asidesOf(base.id, asideAnswers.get(base.id) ?? [], now), setting: settingOf(settingResults.get(base.id)?.[0], now),
        shells: base.pid && base.kind !== 'codex' ? shellsOf(procs, base.pid, now, idx) : undefined,
      });
      agents.push(applySince(agent, prevAgents.get(agent.id), now));
      if (rec) { // deploys it ran itself (a script over ssh, rsync…), its subagents' too
        const known = [...repoInfo.keys(), ...Object.keys(cfg.deployRepos)];
        for (const m of [rec.model, ...(rec.childModels?.values() ?? [])]) noteDirectDeploys(directDeploys, { calls: m.calls, by: agent.name, lookup: p => resolver.lookup(p), known, folder: agent.cwd });
      }
    }
    const liveIds = new Set(agents.map(a => a.id));
    for (const id of [...cpuHist.keys()]) if (!liveIds.has(id)) cpuHist.delete(id);

    queueResolve(agents);
    const collisions = findCollisions(agents, now, cfg.collisionWindowMin * 60_000);
    snapshot = {
      generatedAt: now,
      settings: { modToasts: cfg.modToasts, permissionDashboardSec: cfg.permissionDashboardSec, memoryAlertGb: cfg.memoryAlertGb, cpuAlertPct: cfg.cpuAlertPct },
      collector: selfStats(),
      machine: { totalMemMb: Math.round(totalmem() / 1_048_576), cpuCount: cpus().length },
      sources: { ...sources },
      counts: countStates(agents, collisions),
      agents: sortAgents(agents),
      repos: reposFor(agents, { deployRepos: cfg.deployRepos, repoInfo, deploys, directs: directDeploys, prs, lookup: p => resolver.lookup(p), home }),
      plan: planUsage(planReadings(beacons, agents), now),
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
      try { deploys.set(path, await deployStatusOf(repo)); } catch (err) { failed = err; }
    }
    if (failed) markFail('gh', failed); else markOk('gh');
  }

  // Pull requests of the repos on the dashboard (its origin on GitHub, or deployRepos' name for it);
  // a worktree's are its main checkout's.
  async function pollPullRequests() {
    let failed = null, asked = 0;
    for (const r of snapshot?.repos ?? []) {
      if (r.worktree) continue;
      try {
        const slug = cfg.deployRepos[r.path] ?? await githubSlugOf(r.path);
        if (!slug) { prs.delete(r.path); continue; }
        asked++;
        prs.set(r.path, await pullRequestsOf(slug));
      } catch (err) { failed = err; }
    }
    if (failed) markFail('prs', failed); else if (asked) markOk('prs');
  }

  function startTimers() {
    for (const t of timers.splice(0)) clearInterval(t);
    timers.push(setInterval(() => schedule(true), cfg.pollMs));
    timers.push(setInterval(() => void pollAgents(), cfg.agentsCliPollMs));
    timers.push(setInterval(() => void pollGit(), cfg.gitPollMs));
    timers.push(setInterval(() => void pollDeploys(), cfg.deployPollMs));
    timers.push(setInterval(() => void pollPullRequests(), cfg.prPollMs));
    timers.push(setInterval(() => { pruneUploads(uploadsDir, Date.now()); pruneForks(forksDir, Date.now()); }, 3_600_000));
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

  /** A subagent's card, opened: the prompt it was given, its result once done, and its latest steps and words (newest first). */
  function getSubagent(id) {
    const [sessionId, childId] = id.split(':');
    const rec = sessions.get(sessionId);
    const child = childId ? rec?.model.children.get(childId) : undefined;
    if (child?.kind !== 'subagent') return null;
    return { prompt: child.prompt ?? null, result: child.result ?? null, feed: rec.childModels.get(childId)?.history(40) ?? [] };
  }

  // The conversation dialog's whole conversations: the last three opened, each dropped after ten minutes unused.
  const conversations = new Map(); // transcript path → Conversation, least recently used first
  /** A session's (or subagent's) messages from the `from`-th on, oldest first; null if it has no transcript. */
  async function getConversation(id, from) {
    const [sessionId, childId] = id.split(':');
    const rec = sessions.get(sessionId);
    const path = childId ? rec?.childPaths.get(childId) : rec?.path;
    if (!path) return null;
    const now = Date.now();
    for (const [p, c] of conversations) if (now - c.usedAt > 600_000) conversations.delete(p);
    const convo = conversations.get(path) ?? new Conversation(path);
    conversations.delete(path);
    conversations.set(path, convo);
    while (conversations.size > 3) conversations.delete(conversations.keys().next().value);
    convo.usedAt = now;
    await convo.update();
    return convo.messages(from);
  }

  /**
   * Your own messages to a session, newest first, for ↑ in its message box: as you typed them (no
   * attachment notes), without slash commands (a message doesn't run one), a repeat in a row once.
   */
  async function getPrompts(id) {
    if (id.includes(':')) return null;
    const convo = await getConversation(id, 0);
    if (!convo) return null;
    const typed = [];
    for (const m of convo.items) {
      const text = m.kind === 'prompt' ? typedPart(m.body).trim() : '';
      if (text && !text.startsWith('/') && text !== typed.at(-1)) typed.push(text);
    }
    return { prompts: typed.reverse().slice(0, 200) };
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

  /** The folder a file of the agent's may be shown from: its memory's, its scratchpad, or its working folder; else null. */
  function fileRoot(agentId, path) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent || typeof path !== 'string') return null;
    if (agent.kind !== 'codex' && memoryOf(agent).some(m => m.path === path)) return dirname(path);
    const scratchRoot = agent.kind === 'codex' ? null : scratchpadOf(agentId, scratchBase, agent.cwd);
    if (scratchRoot && path.startsWith(`${scratchRoot}/`)) return scratchRoot;
    if (browsable(agent) && path.startsWith(`${agent.cwd}/`)) return agent.cwd;
    return null;
  }
  const OUTSIDE = { status: 403, error: "That file is outside the agent's folder." };

  // ---- Files that aren't text: their bytes through short-lived links, documents read for the reader ----
  // An <img>, <video> or the PDF viewer can't send the page's token, so a file's bytes are reached
  // through a link that is random, lasts ticketMs, and opens one file, or (for a page's preview)
  // whatever the same rules allow in the agent's folder, so the page loads what sits beside it.
  const RAW_MAX = 200 * 1024 * 1024;
  const tickets = new Map(); // id → { root, file (one file) | null (the folder's), until }
  async function fileTicket(agentId, path, { folder = false } = {}) {
    const root = fileRoot(agentId, path);
    if (!root) return OUTSIDE;
    const ok = await checkFolderFile(root, path);
    if (ok.error) return ok;
    if (ok.size > RAW_MAX) return { status: 413, error: 'That file is too large to show here (200 MB at most).' };
    const now = Date.now();
    for (const [k, t] of tickets) if (t.until < now) tickets.delete(k);
    const id = randomBytes(16).toString('hex');
    tickets.set(id, { root, file: folder ? null : ok.real, until: now + ticketMs });
    const rel = folder ? relative(realpathSync(root), ok.real) : basename(ok.real);
    return { url: `/raw/${id}/${rel.split(sep).map(encodeURIComponent).join('/')}`, type: contentTypeOf(ok.real), size: ok.size };
  }
  /** What a link opens: { real, type, size } of the file, or { status, error }. `rel` is the path after the link's id, decoded. */
  async function rawFile(id, rel) {
    const t = tickets.get(id);
    if (!t || t.until < Date.now()) { tickets.delete(id); return { status: 404, error: 'That link has expired: open the file again.' }; }
    const abs = resolve(t.root, rel), inside = relative(t.root, abs);
    if (!t.file && (!inside || inside.startsWith('..') || isAbsolute(inside))) return OUTSIDE; // said before whether it exists
    const ok = t.file ? { real: t.file } : await checkFolderFile(t.root, abs);
    if (ok.error) return ok;
    try {
      const size = statSync(ok.real).size;
      return size > RAW_MAX ? { status: 413, error: 'That file is too large to show here (200 MB at most).' } : { real: ok.real, type: contentTypeOf(ok.real), size };
    } catch {
      return { status: 404, error: 'That file no longer exists.' };
    }
  }
  /**
   * Files an agent names in its replies (a screenshot it took, a video it recorded, a plan it wrote), as
   * written: relative to its folder, under ~, or absolute. Each says whether the dashboard may show it
   * (the same rules as the explorer: inside its folder, scratchpad or memory; never ignored or secret
   * files) and how; a picture comes with a link for its thumbnail. 20 at a time.
   */
  const NAMED_KINDS = new Set(['image', 'pdf', 'video', 'audio', 'html', 'word', 'sheet', 'office']);
  async function namedFiles(agentId, asked) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent) return { status: 404, error: 'That agent was not found.' };
    const items = [];
    for (const raw of asked.slice(0, 20).map(String)) {
      const abs = raw.startsWith('~/') ? join(home, raw.slice(2)) : isAbsolute(raw) ? resolve(raw) : agent.cwd ? resolve(agent.cwd, raw) : null;
      const kind = !abs ? null : /\.(md|markdown|mdx)$/i.test(abs) ? 'markdown' : NAMED_KINDS.has(viewOf(abs)) ? viewOf(abs) : null;
      const root = kind ? fileRoot(agentId, abs) : null;
      const ok = root ? await checkFolderFile(root, abs) : null;
      if (!ok || ok.error) { items.push({ asked: raw, ok: false }); continue; }
      const link = kind === 'image' ? await fileTicket(agentId, abs) : null;
      items.push({ asked: raw, ok: true, kind, path: abs, ...(link?.url ? { url: link.url } : {}) });
    }
    return { items };
  }

  /**
   * The end of a background shell command's output: the file Claude Code writes it to, as its
   * transcript names it, and only inside the scratch folder ({ text, size, truncated } or { error }).
   */
  const OUTPUT_MAX = 64 * 1024;
  function shellOutput(agentId, pid) {
    const shell = snapshot?.agents.find(a => a.id === agentId)?.shells?.find(s => s.pid === pid);
    if (!shell) return { status: 404, error: 'That command is no longer running.' };
    const rec = sessions.get(agentId);
    const call = [rec?.model, ...(rec?.childModels?.values() ?? [])].filter(Boolean).flatMap(m => m.bashCalls()).find(c => c.id === shell.toolUseId);
    if (!shell.output || !call?.outputPath) return { status: 404, error: 'Only a background command writes its output where it can be read; this one hands it to the session when it ends.' };
    let real;
    try { real = realpathSync(call.outputPath); } catch { return { status: 404, error: 'Its output file is gone.' }; }
    let base = scratchBase;
    try { base = realpathSync(scratchBase); } catch { /* none */ }
    if (!real.startsWith(`${base}/`) || !real.endsWith('.output')) return { status: 403, error: 'That output file is outside the scratch folder.' };
    const size = statSync(real).size;
    const fd = openSync(real, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, OUTPUT_MAX));
      readSync(fd, buf, 0, buf.length, size - buf.length);
      const text = buf.toString('utf8');
      return { text: size > OUTPUT_MAX ? text.slice(text.indexOf('\n') + 1) : text, size, truncated: size > OUTPUT_MAX }; // from a whole line
    } finally {
      closeSync(fd);
    }
  }

  /** Folders to start a session in, suggested as you type (only in your home folder or on a drive). */
  const dirsFor = typed => listDirs(typed, { home, roots: folderRoots });
  let choosing = false; // Finder's folder window is open

  /** A document read for the reader: a sheet's tables, a Word document as a page and as text, or a first-page picture. */
  async function officeView(agentId, path) {
    const root = fileRoot(agentId, path);
    if (!root) return OUTSIDE;
    const ok = await checkFolderFile(root, path);
    if (ok.error) return ok;
    const view = viewOf(ok.real);
    if (ok.size > 50 * 1024 * 1024) return { status: 413, error: 'That document is too large to read here (50 MB at most).' };
    if (view === 'sheet' && /\.csv$/i.test(ok.real)) {
      const rows = parseCsv(readFileSync(ok.real, 'utf8'));
      return { view: 'sheet', sheets: [{ name: basename(ok.real), rows: rows.slice(0, 2000).map(r => r.slice(0, 100)), truncated: rows.length > 2000 || rows.some(r => r.length > 100) }] };
    }
    if (view === 'sheet') {
      const book = readXlsx(readFileSync(ok.real));
      return book.error ? { status: 415, error: book.error } : { view: 'sheet', sheets: book.sheets };
    }
    if (view === 'word') { // macOS's textutil: the document as a page, and as plain text to quote from
      const [html, text] = await Promise.all(['html', 'txt'].map(as => run('textutil', ['-convert', as, '-stdout', ok.real], { timeoutMs: 30_000 })));
      if (html.code !== 0) return { status: 415, error: `macOS could not read this document (${html.stderr.trim().split('\n')[0] || `exit ${html.code}`}).` };
      return { view: 'word', html: html.stdout, text: text.code === 0 ? text.stdout : '' };
    }
    if (view === 'office') {
      try {
        return { view: 'picture', picture: `data:image/png;base64,${(await quickLook(ok.real)).toString('base64')}` };
      } catch (err) {
        return { status: 415, error: `Quick Look could not make a picture of it (${err.message}).` };
      }
    }
    return { status: 415, error: 'This is not a document to read this way.' };
  }

  /** A file from the agent's folder or scratchpad, its memory, its conversation summary, or a document it opened. */
  async function readFile(agentId, path) {
    const agent = snapshot?.agents.find(a => a.id === agentId);
    if (!agent) return { status: 404, error: 'That agent was not found.' };
    if (typeof path !== 'string') return OUTSIDE;
    if (path === '@summary') {
      const transcript = sessions.get(agentId)?.path;
      const summary = transcript ? compactSummary(transcript) : null;
      return summary
        ? { doc: { path, text: summary.text, mtimeMs: summary.at, size: summary.text.length } }
        : { status: 404, error: "This session hasn't been compacted yet, so it still holds the whole conversation. Open Full transcript to read it." };
    }
    const folder = fileRoot(agentId, path);
    if (folder) return readFolderFile(folder, path);
    const doc = readDoc(agentId, path);
    return doc.doc ? doc : { status: 403, error: "That file is outside the agent's folder." };
  }

  /** The farm's field close-up: files agents touched in one repo on the dashboard, with git status. */
  async function repoTouched(repoPath) {
    const repo = snapshot?.repos.find(r => r.path === repoPath);
    if (!repo) return { status: 404, error: 'That repo is not on the dashboard.' };
    const touched = [...sessions].map(([id, rec]) => ({
      id,
      touched: [rec.model, ...rec.childModels.values()].flatMap(m => m?.touchedFiles() ?? []),
    }));
    const st = await run('git', ['-C', repoPath, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { env: GIT_ENV, timeoutMs: 10_000 });
    const status = st.code === 0 ? parsePorcelain(st.stdout, '') : {};
    const branch = repo.branch ?? ((await run('git', ['-C', repoPath, 'branch', '--show-current'], { env: GIT_ENV, timeoutMs: 5000 })).stdout.trim() || null);
    return { repo: repoPath, name: repo.name, branch, ...repoFiles({ repo: repoPath, sessions: touched, status, now: Date.now() }) };
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

  const sessionCache = new Map();
  const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
  /** Past sessions to resume (the last 30 days, or `all`) and the folders to start a new one in (only ones that still exist). */
  async function pastSessions({ all = false } = {}) {
    const live = new Set(snapshot?.agents.map(a => a.id) ?? []);
    const sessions = listSessions({ claudeDir, cache: sessionCache, maxAgeDays: all ? Infinity : 30 }).map(s => ({ ...s, live: live.has(s.id) }));
    return { terminal: cfg.terminal === 'iTerm' ? 'iTerm' : 'Terminal', projects: projectsOf(sessions).filter(p => isDir(p.cwd)), sessions };
  }
  // ---- The ⚙ Claude Code dialog: plugins (with what each costs in context), MCP servers, permission rules ----
  const homeDir = () => (isDir(home) ? home : undefined); // where the claude CLI runs from, when that folder exists
  const pluginDetails = new Map(); // id@version → parsed `claude plugin details`: they change only with the version
  let pluginIds = new Set(); // the plugins last listed: only these can be changed
  /** Installed plugins with their details (fetched four at a time, then kept), and your own skills. */
  async function claudePlugins() {
    const res = await run(claudeBin, ['plugin', 'list', '--json'], { cwd: homeDir(), timeoutMs: 30_000 });
    let list;
    try { list = JSON.parse(res.stdout); } catch { return { error: `claude plugin list did not answer: ${(res.stderr || res.stdout).trim().split('\n')[0] || `exit ${res.code}`}` }; }
    const plugins = (Array.isArray(list) ? list : []).filter(p => typeof p?.id === 'string').map(p => {
      const [name, marketplace = ''] = p.id.split('@');
      // a plugin loaded from a folder (@inline, like this dashboard's mod) is managed where it lives
      return { id: p.id, name, marketplace, version: String(p.version ?? ''), enabled: p.enabled === true, scope: p.scope ?? null, lastUpdated: p.lastUpdated ?? null, managed: marketplace !== 'inline' };
    });
    pluginIds = new Set(plugins.filter(p => p.managed).map(p => p.id));
    const missing = plugins.filter(p => !pluginDetails.has(`${p.id}@${p.version}`));
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(missing.slice(i, i + 4).map(async p => {
        const r = await run(claudeBin, ['plugin', 'details', p.name], { cwd: homeDir(), timeoutMs: 30_000 });
        if (r.code === 0) pluginDetails.set(`${p.id}@${p.version}`, parsePluginDetails(r.stdout));
      }));
    }
    return { plugins: plugins.map(p => ({ ...p, details: pluginDetails.get(`${p.id}@${p.version}`) ?? null })), skills: readOwnSkills(home) };
  }
  // `claude mcp list` starts every server to check it (15 s or more): one run at a time, its answer kept for 2 minutes.
  let mcpChecked = null, mcpRunning = null;
  async function claudeMcp({ fresh = false } = {}) {
    if (!fresh && mcpChecked && Date.now() - mcpChecked.at < 120_000) return mcpChecked;
    mcpRunning ??= (async () => {
      const res = await run(claudeBin, ['mcp', 'list'], { cwd: homeDir(), timeoutMs: 120_000 });
      let config = null;
      try { config = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')); } catch { /* no per-project servers to show */ }
      const servers = parseMcpList(res.stdout);
      mcpChecked = res.code !== 0 && !servers.length
        ? { error: `claude mcp list did not answer: ${(res.stderr || res.stdout).trim().split('\n')[0] || `exit ${res.code}`}`, at: Date.now() }
        : { servers, projects: projectServersOf(config), at: Date.now() };
      return mcpChecked;
    })().finally(() => { mcpRunning = null; });
    return mcpRunning;
  }
  /** The settings files that hold permission rules: yours, then each project's on the dashboard (only those that exist are read). */
  function rulesFiles() {
    const files = [{ path: join(claudeDir, 'settings.json'), label: 'You, everywhere' }, { path: join(claudeDir, 'settings.local.json'), label: 'Your home folder, just you' }];
    const folders = new Set([...(snapshot?.repos ?? []).map(r => r.path), ...(snapshot?.agents ?? []).map(a => resolver.lookup(a.cwd)?.path ?? a.cwd)].filter(Boolean));
    for (const dir of [...folders].sort()) {
      if (dir === home) continue;
      const name = basename(dir);
      files.push({ path: join(dir, '.claude', 'settings.json'), label: `${name}, shared` }, { path: join(dir, '.claude', 'settings.local.json'), label: `${name}, just you` });
    }
    return files;
  }
  const claudeRules = () => ({ files: readRules(rulesFiles()) });

  const openTerminal = async command => {
    const res = await launch(terminalScript(cfg.terminal, command));
    const app = cfg.terminal === 'iTerm' ? 'iTerm' : 'Terminal';
    if (res.code === 0) return { ok: true, terminal: app };
    if (/-1743|not authori[sz]ed/i.test(res.stderr)) return { ok: false, error: `macOS stopped the tracker from opening ${app}. Allow it in System Settings › Privacy & Security › Automation, then try again.` };
    return { ok: false, error: res.stderr.trim().slice(0, 200) || 'The terminal did not open.' };
  };

  /**
   * Ends a running session: checks the process is claude, SIGTERM (Claude shuts down cleanly), waits
   * for it to stop, then closes its iTerm session or Terminal window, found by its tty.
   */
  async function endSession(agent) {
    if (!agent) return { ok: false, error: 'That session was not found.' };
    if (agent.kind !== 'interactive' || !Number.isInteger(agent.pid)) return { ok: false, error: 'Only a session running in a terminal can be ended from here.' };
    const command = await sessionProcs.commandOf(agent.pid);
    if (!/(^|\/|\s)claude(\s|$)/.test(command ?? '')) return { ok: false, error: "That session's process is not Claude Code any more." };
    const tty = await sessionProcs.ttyOf(agent.pid);
    sessionProcs.kill(agent.pid, 'SIGTERM');
    const until = Date.now() + endWaitMs;
    while (sessionProcs.alive(agent.pid) && Date.now() < until) await new Promise(r => setTimeout(r, 150));
    if (sessionProcs.alive(agent.pid)) return { ok: false, error: "The session didn't stop. Close it in its terminal (/exit)." };
    let closedWindow = false;
    if (tty) for (const app of [cfg.terminal === 'iTerm' ? 'iTerm' : 'Terminal', cfg.terminal === 'iTerm' ? 'Terminal' : 'iTerm']) {
      const res = await launch(closeTerminalScript(app, `/dev/${tty}`)).catch(() => ({ code: 1, stdout: '' }));
      if (res.code === 0 && res.stdout.trim() === 'closed') { closedWindow = true; break; }
    }
    schedule(true);
    return { ok: true, closedWindow };
  }
  const validMode = mode => mode === undefined || Object.hasOwn(MODE_FLAGS, mode);
  const validStart = b => (b?.model === undefined || MODELS.includes(b.model)) && (b?.effort === undefined || EFFORTS.includes(b.effort));
  const ASIDE_WAIT_MS = 3 * 60_000;
  /** A session's side questions, newest first: answered ones, and the ones still being answered (given up on after 3 minutes). */
  function asidesOf(id, answered, now) {
    const done = new Set(answered.map(a => a.id));
    const waiting = (pendingAsides.get(id) ?? []).filter(p => !done.has(p.id) && now - p.at < ASIDE_WAIT_MS);
    if (waiting.length) pendingAsides.set(id, waiting); else pendingAsides.delete(id);
    const clip = (t, n) => (typeof t === 'string' ? t.slice(0, n) : undefined);
    return [...waiting.map(p => ({ ...p, pending: true })), ...answered.map(a => ({ id: a.id, question: clip(a.question, 2000), answer: clip(a.text, 8000), reason: clip(a.reason, 300), at: a.at, answeredAt: a.answeredAt }))]
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 5);
  }
  /** The last model or effort switch asked from the dashboard, for 10 minutes: what Claude Code said of it. */
  function settingOf(r, now) {
    if (!r || now - (r.at ?? 0) > 600_000) return undefined;
    return { command: r.command, args: r.args, ok: r.ok === true, text: typeof r.text === 'string' ? r.text.slice(0, 300) : '', at: r.at };
  }

  const actions = {
    /** Ends a session and closes its terminal window. */
    async end(body) {
      return endSession(snapshot?.agents.find(a => a.id === body?.agentId));
    },
    /** Ends a session and resumes it in a new terminal window in another permission mode; the conversation carries on. */
    async restart(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!validMode(body?.mode)) return { ok: false, error: 'That is not a permission mode.' };
      if (!agent || !SESSION_ID.test(agent.id) || !agent.cwd || !isDir(agent.cwd)) return { ok: false, error: 'That session cannot be resumed from here.' };
      const ended = await endSession(agent);
      if (!ended.ok) return ended;
      return openTerminal(claudeCommand(agent.cwd, agent.id, body.mode ?? 'default'));
    },
    /**
     * Switches a running session's model or effort, or compacts it: its mod runs /model, /effort or
     * /compact there, as if you typed it (after the current turn). Claude Code saves a model or effort
     * as your default for new sessions. Compacting needs mod 0.6.0. A stop cancels the running turn
     * at once, as Esc does (mod 0.7.0).
     */
    async setting(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!agent || agent.kind === 'codex') return { ok: false, error: 'That session was not found.' };
      if (!agent.mod?.live) return { ok: false, error: "That session isn't listening for the dashboard yet. Send it anything in its terminal once, or start a new session." };
      if (!modAtLeast(agent.mod.version, '0.5.0')) return { ok: false, error: `That session runs an older tracker mod (${agent.mod.version}). Run /reload-plugins in it (or resume it), then try again.` };
      let request;
      if (body.model !== undefined) {
        if (!MODELS.includes(body.model)) return { ok: false, error: 'That is not a model to switch to.' };
        request = { command: 'model', args: body.model };
      } else if (body.effort !== undefined) {
        if (!EFFORTS.includes(body.effort)) return { ok: false, error: 'That is not an effort level.' };
        request = { command: 'effort', args: body.effort };
      } else if (body.compact !== undefined) {
        if (typeof body.compact !== 'string' || body.compact.length > 500) return { ok: false, error: 'Say what to keep in a line (500 characters at most), or nothing.' };
        if (!modAtLeast(agent.mod.version, '0.6.0')) return { ok: false, error: `That session runs an older tracker mod (${agent.mod.version}). Run /reload-plugins in it (or resume it), then try again.` };
        request = { command: 'compact', args: body.compact.replace(/\s+/g, ' ').trim() }; // /compact takes one line
      } else if (body.reload === true) { // after plugins changed: /reload-plugins (mod 0.6.1)
        if (!modAtLeast(agent.mod.version, '0.6.1')) return { ok: false, error: `That session runs an older tracker mod (${agent.mod.version}). Run /reload-plugins in it yourself.` };
        request = { command: 'reload-plugins', args: '' };
      } else if (body.stop === true) { // Esc: the running turn is cancelled at once (mod 0.7.0)
        if (!modAtLeast(agent.mod.version, '0.7.0')) return { ok: false, error: `That session runs an older tracker mod (${agent.mod.version}). Run /reload-plugins in it (or press Esc in its terminal).` };
        request = { command: 'stop', args: '' };
      } else return { ok: false, error: 'Pick a model or an effort level.' };
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const file = writeRequestFile(commandsDir, agent.id, { ...request, id, at: Date.now() }, id);
      return confirmDelivery(file, { timeoutMs: deliveryTimeoutMs, failure: request.command === 'stop' ? "The session didn't pick it up. Press Esc in its terminal." : `The session didn't pick it up. Type /${request.command} ${request.args} in its terminal.` });
    },
    /** A side question (/btw): answered from the session's conversation without adding to it, even while it works. */
    async aside(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!agent || agent.kind === 'codex') return { ok: false, error: 'That session was not found.' };
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question) return { ok: false, error: 'Type a question first.' };
      if (question.length > 2000) return { ok: false, error: 'That question is too long (2,000 characters at most).' };
      if (!agent.mod?.live) return { ok: false, error: "That session isn't listening for the dashboard yet. Send it anything in its terminal once, or start a new session." };
      if (!modAtLeast(agent.mod.version, '0.5.0')) return { ok: false, error: `That session runs an older tracker mod (${agent.mod.version}). Run /reload-plugins in it (or resume it), then try again.` };
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at = Date.now();
      const file = writeRequestFile(asksDir, agent.id, { id, question, at }, id);
      const delivered = await confirmDelivery(file, { timeoutMs: deliveryTimeoutMs, failure: "The session didn't pick up the question. Ask it with /btw in its terminal." });
      if (!delivered.ok) return delivered;
      pendingAsides.set(agent.id, [...(pendingAsides.get(agent.id) ?? []), { id, question, at }]);
      await schedule(false); // the page shows it asked straight away
      return { ok: true, id };
    },
    /** Opens a terminal window running claude in a listed folder, or resuming a past session that is not running, in a permission mode. */
    async start(body) {
      if (!validMode(body?.mode)) return { ok: false, error: 'That is not a permission mode.' };
      if (!validStart(body)) return { ok: false, error: 'That is not a model or an effort level to start with.' };
      const known = await pastSessions();
      let cwd, resume;
      if (body?.resume !== undefined) {
        const s = typeof body.resume === 'string' && SESSION_ID.test(body.resume) ? known.sessions.find(x => x.id === body.resume) : undefined;
        if (!s) return { ok: false, error: 'That session was not found.' };
        if (s.live) return { ok: false, error: 'That session is already running.' };
        if (!s.cwd || !isDir(s.cwd)) return { ok: false, error: 'The folder that session ran in no longer exists.' };
        ({ cwd } = s);
        resume = s.id;
      } else { // a folder you worked in, or any other of yours (checked at its real place)
        cwd = known.projects.find(p => p.cwd === body?.cwd)?.cwd;
        if (!cwd) {
          const at = await startPlace(body?.cwd, { home, roots: folderRoots });
          if (at.error) return { ok: false, error: at.error };
          cwd = at.path;
        }
      }
      return openTerminal(claudeCommand(cwd, resume, body?.mode ?? 'default', { model: body?.model ?? 'default', effort: body?.effort }));
    },
    /**
     * Forks a session's conversation at one of its messages (`at`, its transcript row) into a new
     * session in a new terminal window: up to and including a reply of Claude's, or up to a message of
     * yours, which then waits in the new prompt box. The original session is left as it is.
     */
    async fork(body) {
      if (!validMode(body?.mode)) return { ok: false, error: 'That is not a permission mode.' };
      if (!validStart(body)) return { ok: false, error: 'That is not a model or an effort level to start with.' };
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      const path = agent && agent.kind !== 'codex' ? sessions.get(agent.id)?.path : undefined;
      if (!path) return { ok: false, error: 'That session has no conversation to fork.' };
      if (!agent.cwd || !isDir(agent.cwd)) return { ok: false, error: 'The folder that session ran in no longer exists.' };
      if (typeof body.at !== 'string' || !/^[\w-]{1,64}$/.test(body.at)) return { ok: false, error: 'Pick a message to fork from.' };
      pruneForks(forksDir, Date.now());
      const cut = await cutTranscript(path, body.at, forksDir, basename(path, '.jsonl')); // the copy is named as the transcript
      if (cut.error) return { ok: false, error: cut.error };
      return openTerminal(forkCommand(agent.cwd, cut.file, body.mode ?? 'default', { model: body.model ?? 'default', effort: body.effort, name: `${agent.name} (fork)`.slice(0, 80), prefillFile: cut.prefillFile }));
    },
    /**
     * Restores a session to before one of your messages, as /rewind does: its conversation (the row
     * /rewind writes, added to its transcript; nothing is removed), its code (the files Claude edited
     * since, put back from Claude Code's own snapshots), or both. A running session is ended first;
     * then it is resumed in a new terminal window, with your message back in its prompt box.
     */
    async restore(body) {
      const what = body?.what ?? 'both';
      if (!['both', 'conversation', 'code'].includes(what)) return { ok: false, error: 'Restore the conversation, the code, or both.' };
      if (!validMode(body?.mode)) return { ok: false, error: 'That is not a permission mode.' };
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      const path = agent && agent.kind !== 'codex' && SESSION_ID.test(agent.id) ? sessions.get(agent.id)?.path : undefined;
      if (!path) return { ok: false, error: 'That session has no conversation to restore.' };
      if (!agent.cwd || !isDir(agent.cwd)) return { ok: false, error: 'The folder that session ran in no longer exists.' };
      const running = Number.isInteger(agent.pid) && sessionProcs.alive(agent.pid);
      if (running && agent.kind !== 'interactive') return { ok: false, error: 'Only a session running in a terminal can be restored from here.' };
      if (typeof body.at !== 'string' || !/^[\w-]{1,64}$/.test(body.at)) return { ok: false, error: 'Pick one of your messages to go back to.' };
      const point = await restorePoint(path, body.at);
      if (point.error) return { ok: false, error: point.error };
      if (running) {
        const ended = await endSession(agent);
        if (!ended.ok) return ended;
      }
      const resume = prefillFile => openTerminal(claudeCommand(agent.cwd, agent.id, body.mode ?? 'default', { prefillFile }));
      let files = null; // put back, none to put back, or not asked
      if (what !== 'conversation') {
        const r = await run(claudeBin, ['--resume', agent.id, '--rewind-files', body.at], { cwd: agent.cwd, timeoutMs: 60_000, env: { CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1' } });
        const said = (r.stdout || r.stderr).trim().split('\n').filter(Boolean).at(-1) ?? `exit ${r.code}`;
        files = r.code === 0;
        if (!files && !(what === 'both' && /No file checkpoint/i.test(said))) { // nothing changed: it goes on as it was
          const opened = await resume();
          return { ok: false, error: `Its files could not be restored (${said}). ${opened.ok ? 'It was resumed as it was, in a new window.' : `It could not be resumed either: ${opened.error}`}` };
        }
      }
      let prefillFile;
      if (what !== 'code') {
        appendRewind(path, { leafUuid: point.leafUuid, sessionId: agent.id });
        if (point.prompt) {
          mkdirSync(forksDir, { recursive: true, mode: 0o700 });
          prefillFile = join(mkdtempSync(join(forksDir, 'r-')), 'prompt.txt');
          writeFileSync(prefillFile, point.prompt, { mode: 0o600 });
        }
      }
      const opened = await resume(prefillFile);
      return opened.ok ? { ...opened, files } : opened;
    },
    async message(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!agent || agent.kind === 'codex') return { ok: false, error: 'That session was not found.' };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const checked = checkFiles(body.files);
      if (checked.error) return { ok: false, error: checked.error };
      const dirs = checkFolders(body.folders); // attached by their paths
      if (dirs.error) return { ok: false, error: dirs.error };
      if (!text && !checked.files.length && !dirs.folders.length) return { ok: false, error: 'Type a message first.' };
      if (text.length > 20_000) return { ok: false, error: 'That message is too long (20,000 characters at most).' };
      if (!agent.mod?.live) return { ok: false, error: "That session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session." };
      const saved = saveFiles(uploadsDir, agent.id, checked.files);
      const file = writeMessageFile(messagesDir, agent.id, withAttachments(text, saved, dirs.folders));
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
      if (!['allow', 'deny', 'always'].includes(body.decision)) return { ok: false, error: 'Choose Allow, Always allow or Deny.' };
      const agent = snapshot?.agents.find(a => a.id === body.agentId);
      if (body.decision === 'always' && !modAtLeast(agent?.mod?.version, '0.6.0')) return { ok: false, error: `That session runs an older tracker mod (${agent?.mod?.version}). Run /reload-plugins in it (or resume it) for Always allow.` };
      return deliver(ask.toolUseId, { decision: body.decision });
    },
    /** Opens Finder's folder window (one at a time), at `start` if that is a folder, else at home: { ok, path } or { ok: false, cancelled | error }. */
    async chooseFolder(body) {
      if (choosing) return { ok: false, error: 'A folder window is already open: pick a folder there first (it may be behind this one).' };
      const start = typeof body?.start === 'string' && isAbsolute(body.start) && isDir(body.start) ? body.start : home;
      const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 120) : 'Choose a folder';
      choosing = true;
      try {
        const got = await chooseFolder({ start, prompt });
        if (got.path) return { ok: true, path: got.path.length > 1 ? got.path.replace(/\/+$/, '') : got.path, home }; // home: the page shows it as ~
        return got.cancelled ? { ok: false, cancelled: true } : { ok: false, error: got.error ?? 'No folder was picked.' };
      } finally {
        choosing = false;
      }
    },
    /**
     * Stops a shell command a session runs (its Bash tool's), with everything it started: SIGTERM to its
     * process group, SIGKILL if it is still there a moment later. Checked again in ps first: never the
     * session itself, its MCP servers, or anything that is not one of its shell commands.
     */
    async stopShell(body) {
      const agent = snapshot?.agents.find(a => a.id === body?.agentId);
      if (!agent?.pid || agent.kind === 'codex') return { ok: false, error: 'That session was not found.' };
      const pid = Number(body.pid);
      let procs;
      try { procs = await readProcs(); } catch { return { ok: false, error: 'The process list could not be read.' }; }
      if (!Number.isInteger(pid) || !isShellCommand(procs.get(pid), agent.pid)) return { ok: false, error: 'That command is no longer running (or is not one of its shell commands).' };
      try {
        sessionProcs.killGroup(pid, 'SIGTERM');
      } catch (err) {
        return { ok: false, error: `It could not be stopped (${err.code ?? err.message}).` };
      }
      setTimeout(() => { try { if (sessionProcs.groupAlive(pid)) sessionProcs.killGroup(pid, 'SIGKILL'); } catch { /* gone already */ } }, stopWaitMs).unref?.();
      return { ok: true };
    },
    /** Makes a folder to start a session in (and any missing above it), only in your home folder or on a drive. */
    async mkdir(body) {
      return makeDir(body?.path, { home, roots: folderRoots });
    },
    /** Shows a file of the agent's in Finder (open -R): only reveals it, never opens or runs it. */
    async reveal(body) {
      const root = fileRoot(body?.agentId, body?.path);
      if (!root) return { ok: false, error: OUTSIDE.error };
      const ok = await checkFolderFile(root, body.path);
      if (ok.error) return { ok: false, error: ok.error };
      const r = await revealFile(ok.real);
      return r.code === 0 ? { ok: true } : { ok: false, error: 'Finder could not show it.' };
    },
    /** Turns an installed plugin on or off, updates or uninstalls it (claude plugin …). */
    async plugin(body) {
      if (!['enable', 'disable', 'update', 'uninstall'].includes(body?.op)) return { ok: false, error: 'Enable, disable, update or uninstall.' };
      if (!pluginIds.size) await claudePlugins();
      if (!pluginIds.has(body.id)) return { ok: false, error: 'That plugin is not one to change from here.' };
      const res = await run(claudeBin, ['plugin', body.op, body.id], { cwd: homeDir(), timeoutMs: 180_000 });
      for (const key of pluginDetails.keys()) if (key.startsWith(`${body.id}@`)) pluginDetails.delete(key);
      const said = (res.stdout || res.stderr).trim().split('\n').filter(Boolean).at(-1) ?? '';
      return res.code === 0 ? { ok: true, text: said } : { ok: false, error: said || `claude plugin ${body.op} failed (exit ${res.code}).` };
    },
    /** Has every listening session (mod 0.6.1 or newer) run /reload-plugins, so plugin changes take effect in it. */
    async reload() {
      const live = (snapshot?.agents ?? []).filter(a => a.kind !== 'codex' && a.mod?.live);
      const able = live.filter(a => modAtLeast(a.mod.version, '0.6.1'));
      for (const a of able) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        writeRequestFile(commandsDir, a.id, { command: 'reload-plugins', args: '', id, at: Date.now() }, id);
      }
      return { ok: true, sessions: able.length, older: live.length - able.length };
    },
    /** An MCP server: sign in (claude mcp login, in a terminal window), or remove one you configured. */
    async mcp(body) {
      const checked = mcpChecked ?? await claudeMcp();
      if (body?.op === 'login') {
        if (!checked.servers?.some(s => s.name === body.name)) return { ok: false, error: 'That server is not in the list.' };
        return openTerminal(`cd ~ && exec claude mcp login ${shellQuote(body.name)}`);
      }
      if (body?.op !== 'remove') return { ok: false, error: 'Sign in or remove.' };
      const local = body.project !== undefined && checked.projects?.some(p => p.project === body.project && p.names.includes(body.name));
      const user = body.project === undefined && checked.servers?.some(s => s.name === body.name && s.group === 'yours');
      if (!local && !user) return { ok: false, error: "Only a server you configured can be removed here (a plugin's comes and goes with the plugin)." };
      const res = await run(claudeBin, ['mcp', 'remove', body.name, '-s', local ? 'local' : 'user'], { cwd: local ? body.project : homeDir(), timeoutMs: 30_000 });
      mcpChecked = null;
      return res.code === 0 ? { ok: true } : { ok: false, error: (res.stderr || res.stdout).trim().split('\n')[0] || 'claude mcp remove failed.' };
    },
    /** Removes one permission rule (or extra folder) from one of the settings files listed. */
    async rule(body) {
      if (!rulesFiles().some(f => f.path === body?.path)) return { ok: false, error: 'That is not one of the settings files listed.' };
      const r = removeRule(body.path, body.list, body.value);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    /** After Always allow…: one of Claude Code's own options for the call (by its place in its list), or null to leave it to the terminal. */
    async always(body) {
      const ask = askFor(body?.agentId, body?.toolUseId, 'always');
      if (!ask || ask.expiresAt <= Date.now()) return { ok: false, error: "Claude Code's options for that call are no longer waiting." };
      if (body.option !== null && !ask.options.some(o => o.option === body.option)) return { ok: false, error: 'Pick one of the options shown.' };
      return deliver(ask.toolUseId, { option: body.option });
    },
    async open(id) {
      const agent = ID_RE.test(id) ? snapshot?.agents.find(a => a.id === id || a.cliId === id) : undefined;
      if (!agent) return { ok: false, error: 'unknown agent' };
      if (agent.kind !== 'background' || !agent.cliId || !ID_RE.test(agent.cliId)) return { ok: false, error: 'only background sessions can be opened from here' };
      return openTerminal(`claude attach ${agent.cliId}`); // cliId is [A-Za-z0-9-] only
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

  const worldsDir = cfg.worldsDir ? String(cfg.worldsDir).replace(/^~(?=\/|$)/, home) : join(home, '.agentville', 'worlds');
  server = createTrackerServer({
    port: portOverride ?? cfg.port, token, webFile: join(root, 'web', 'index.html'),
    worlds: makeWorlds({ builtinDir: join(root, 'web', 'worlds'), userDir: worldsDir }),
    getSnapshot: () => snapshot,
    getFeed: (id, limit) => modelFor(id)?.history(limit) ?? null,
    getConversation, getPrompts, getSubagent, claudePlugins, claudeMcp, claudeRules, fileTicket, rawFile, officeView, shellOutput, namedFiles,
    getTranscriptHtml, getDoc: readDoc, listFiles, readFile, repoTouched, actions, pastSessions, listDirs: dirsFor, log,
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
  pruneForks(forksDir, Date.now());
  void pollGit();
  void pollDeploys();
  timers.push(setTimeout(() => void pollPullRequests(), 8000)); // once the first snapshot lists the repos
  log(`collector started on 127.0.0.1:${port}`);

  async function stop() {
    stopped = true;
    for (const t of timers.splice(0)) clearInterval(t);
    clearTimeout(lightTimer);
    clearTimeout(configTimer);
    for (const w of watchers) w.close();
    await chain;
    await backfills;
    await server.close();
  }

  return { port, getSnapshot: () => snapshot, reloadConfig, actions, pastSessions, listDirs: dirsFor, shellOutput, namedFiles, getConversation, getPrompts, claudePlugins, claudeMcp, claudeRules, fileTicket, rawFile, officeView, readDoc, listFiles, readFile, repoTouched, stop };
}
