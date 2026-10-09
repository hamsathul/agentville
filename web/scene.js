// The scene: what every world draws, built on the page from each snapshot. Plain facts only (states,
// tools, context, deploys, the plan's limits); each world turns them into its own pictures (the farm
// into hats and crops). worlds.js hands it to the world's frame. Classic script, no dependencies.
// Version 1; docs/worlds.md describes every field.
(() => {
  'use strict';

  const VERSION = 1;
  // An agent's colour follows its id, never its place in the list, so colours don't jump. The farm's
  // shirts are these colours (web/worlds/farm keeps the same list), and the sidebar matches them.
  const SHIRT = ['#d9673a', '#4a7bd0', '#2fa57a', '#8a6fd8', '#d55181', '#c99a16', '#e05555', '#3c9c3c'];
  const hashOf = id => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  const colorIndex = id => hashOf(id) % SHIRT.length;
  const colorOf = id => SHIRT[colorIndex(id)];
  const isMain = b => /^(main|master)$/.test(b ?? '');

  /**
   * Messages between two farmers in the last 3 minutes, oldest first: { from, to, at, text }. Each
   * is seen once, from whichever side wrote it down; messages to a session's own helpers stay out.
   */
  function mailOf(agents, now) {
    const byName = new Map(agents.map(a => [a.name, a.id]));
    const out = [];
    for (const a of agents) for (const f of a.feed ?? []) {
      if (f.kind !== 'peer' || f.helper || now - f.at > 180_000) continue;
      const other = byName.get(f.other);
      if (!other || other === a.id) continue;
      const [from, to] = f.dir === 'out' ? [a.id, other] : [other, a.id];
      if (out.some(m => m.from === from && m.to === to && Math.abs(m.at - f.at) < 10_000)) continue;
      out.push({ from, to, at: f.at, text: f.text });
    }
    return out.sort((x, y) => x.at - y.at);
  }

  /** Share of the context window used: the list view's rule (1M window once past 200k). */
  function contextPct(tokens) {
    if (!tokens) return 0;
    return Math.min(1, tokens / (tokens > 200_000 ? 1_000_000 : 200_000));
  }

  /** The repo a farmer works in: its newest write, else its newest touch, else the repo holding its folder. */
  function fieldOf(agent, repos) {
    const known = new Set(repos.map(r => r.path));
    const newest = list => list.reduce((best, t) => (!best || t.lastAt > best.lastAt ? t : best), null);
    const touches = (agent.touching ?? []).filter(t => t.repo && known.has(t.repo));
    const pick = newest(touches.filter(t => t.mode === 'write' || t.mode === 'git')) ?? newest(touches);
    if (pick) return pick.repo;
    const cwd = agent.cwd || '';
    if (!cwd) return null;
    const holder = repos.filter(r => cwd === r.path || cwd.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    return holder?.path ?? null;
  }

  /** What a waiting farmer is asking, for its bubble and tooltip. */
  function askText(a) {
    if (a.ask?.kind === 'question') return a.ask.questions?.[0]?.question ?? a.stateReason ?? '';
    if (a.ask?.kind === 'permission' || a.ask?.kind === 'always') return `${a.ask.tool}: ${a.ask.summary}`;
    if (a.now?.tool === 'AskUserQuestion' && a.now.summary) return a.now.summary; // no offer from the mod: the transcript's question
    return a.stateReason ?? '';
  }

  /** A reply as plain text for a speech bubble: markdown markers and code blocks out, one line, clipped. */
  const spoken = (s, max = 160) => {
    const text = String(s ?? '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\*\*|__|`/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const firstLine = (s, max = 90) => {
    const line = String(s ?? '').split('\n')[0].trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  };

  /** The model's family, for the pin on a farmer's hat. */
  const familyOf = m => { const t = String(m ?? '').toLowerCase(); return ['opus', 'sonnet', 'haiku', 'fable'].find(f => t.includes(f)) ?? null; };

  /**
   * The MCP servers' carts: one for each server the agents called in the last hour (the latest six), by
   * name so each keeps its place in the row; one an agent is calling now goes to it (the latest caller).
   * A browser's tools (chrome, playwright) count too, though their step is the web.
   */
  function cartsOf(agents, now) {
    const last = new Map(), busy = new Map();
    for (const a of agents) {
      for (const m of a.mcp ?? []) if (m.at > now - 3_600_000 && m.at > (last.get(m.server) ?? 0)) last.set(m.server, m.at);
      const call = a.now;
      if (a.state !== 'working' || !String(call?.tool ?? '').startsWith('mcp__') || !call.service) continue;
      if (!last.has(call.service)) last.set(call.service, call.startedAt ?? now);
      if (!busy.has(call.service) || (call.startedAt ?? 0) > busy.get(call.service).at) busy.set(call.service, { id: a.id, at: call.startedAt ?? 0 });
    }
    return [...last].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([server]) => server)
      .sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }))
      .map(server => ({ server, busy: busy.get(server)?.id ?? null }));
  }

  // A project is the folder holding sibling repos (like shop/api and shop/web); a home folder or a
  // catch-all one like ~/code holds unrelated repos, so it is none. The farm's bed grid groups by it.
  const CATCH_ALL = new Set(['code', 'projects', 'repos', 'src', 'dev', 'work', 'tools', 'github', 'git', 'documents', 'desktop', 'downloads', 'workspace', 'workspaces', 'sites', 'apps', 'clients', 'tmp']);
  function projectOf(path) {
    const parts = String(path).split('/').filter(Boolean).slice(0, -1);
    return parts.length >= 3 && !CATCH_ALL.has(parts.at(-1).toLowerCase()) ? `/${parts.join('/')}` : null;
  }

  /**
   * A repo's last deploy as one object: the collector's newest (a direct deploy or an Actions run, with
   * its words), else its bare Actions run (`run: true`, no words), else none. A lastDeploy of null wins.
   */
  function deployOf(r) {
    if (r.lastDeploy !== undefined) {
      const d = r.lastDeploy;
      return d ? { state: d.state, label: d.label, detail: d.detail, url: d.url, source: d.source } : null;
    }
    const d = r.deploy;
    if (!d) return null;
    const state = d.status !== 'completed' ? 'running' : d.conclusion === 'success' ? 'ok' : d.conclusion === 'failure' ? 'failed' : 'other';
    return { state, label: null, detail: null, url: d.url ?? null, source: 'actions', run: true };
  }

  function toScene(snap, { cpuAlertPct = snap?.settings?.cpuAlertPct ?? 90 } = {}) {
    const repos = snap?.repos ?? [];
    const agents = snap?.agents ?? [];
    const kids = agents.map(a => a.children ?? []);
    const now = snap?.generatedAt ?? Date.now();
    const waiting = agents.filter(a => a.state === 'waiting'), cpuUsed = agents.reduce((t, a) => t + (a.proc?.cpu ?? 0), 0);
    const windows = (snap?.plan?.windows ?? []).map(w => ({ kind: w.kind, pct: w.reset ? 0 : w.percentUsed, resetsAt: w.resetsAt ?? null, reset: w.reset === true }));
    return {
      version: VERSION,
      generatedAt: now,
      private: false,
      plan: snap?.plan ? { windows, fiveHour: windows.find(w => w.kind === 'five_hour') ?? null, weekly: windows.find(w => w.kind === 'seven_day') ?? null } : null,
      // what the dashboard's top bar and count cards say, for a world's own panel (it fills the window)
      chrome: {
        counts: snap?.counts ?? null, asking: agents.filter(a => a.question).length, agents: agents.length,
        oldestWaiting: waiting.length ? Math.min(...waiting.map(a => a.stateSince || now)) : null,
        subagentsRunning: agents.filter(a => a.children?.some(c => c.kind === 'subagent' && c.state === 'running')).length,
        ram: { usedMb: agents.reduce((t, a) => t + (a.proc?.rssMb ?? 0), 0), totalMb: snap?.machine?.totalMemMb ?? null },
        cpu: { used: cpuUsed, cores: snap?.machine?.cpuCount ?? 1 },
        collector: snap?.collector ?? null,
        errors: Object.entries(snap?.sources ?? {}).filter(([, v]) => v && v.ok === false).map(([k, v]) => `${k}: ${String(v.error ?? 'failing').slice(0, 60)}`),
      },
      subagents: agents.flatMap(a => (a.children ?? []).filter(c => c.kind === 'subagent').map(c => ({ id: c.id, label: c.label ?? '', type: c.agentType ?? null, state: c.state, parent: a.name, startedAt: c.startedAt }))),
      // subagents that finished lately; running ones beyond the four an agent leads
      subagentCounts: {
        done: Math.min(6, kids.flat().filter(c => c.kind !== 'bgjob' && c.state === 'done').length),
        overflow: kids.reduce((t, k) => t + Math.max(0, k.filter(c => c.kind !== 'bgjob' && c.state === 'running').length - 4), 0),
      },
      mail: mailOf(agents, now),
      mcp: cartsOf(agents, now),
      repos: repos.map(r => {
        const project = projectOf(r.worktree && r.main ? r.main : r.path);
        return {
          key: r.path, name: r.name, branch: r.branch ?? null, onMain: isMain(r.branch), dirty: r.dirty ?? 0, ahead: r.ahead ?? 0, behind: r.behind ?? 0,
          deploy: deployOf(r),
          collision: (snap.collisions ?? []).find(c => c.repo === r.path)?.severity ?? null,
          worktree: r.worktree === true, main: r.main ?? null,
          project, projectName: project ? project.split('/').pop() : null,
          prs: r.prs ?? null,
        };
      }),
      agents: agents.map(a => ({
        id: a.id, name: a.name, kind: a.kind, cwd: a.cwd ?? null, state: a.state === 'yourTurn' ? 'turn' : a.state, repo: fieldOf(a, repos),
        tool: a.now?.tool ?? a.feed?.find(f => f.kind === 'tool')?.tool ?? null, summary: a.now?.summary ?? '',
        step: a.now?.step ?? a.feed?.find(f => f.kind === 'tool')?.step ?? null, // test, push, install… (the collector reads commands)
        contextPct: contextPct(a.contextTokens), hot: (a.proc?.cpu ?? 0) >= cpuAlertPct,
        ask: askText(a), askKind: a.ask?.kind ?? null, question: a.question ?? null, reply: firstLine(a.lastReply),
        said: spoken((a.feed ?? []).find(f => f.kind === 'reply')?.body ?? (a.feed ?? []).find(f => f.kind === 'reply')?.text),
        colorIndex: colorIndex(a.id), color: colorOf(a.id), cost: a.usage?.costUsd ?? null, mode: a.mode ?? null,
        kids: (a.children ?? []).filter(c => c.state === 'running' && c.kind !== 'bgjob').slice(0, 4).map(c => ({ id: c.id, dog: c.agentType === 'Explore' })),
        tasks: a.tasks ?? null, compactions: a.compactions ?? 0,
        thinking: a.kind !== 'codex' && a.state === 'working' && (a.turn?.mode ? a.turn.mode === 'thinking' : !a.now), // the working line says thinking (else: between tool calls)
        turn: a.state === 'working' ? a.turn ?? null : null, effort: a.effort ?? null,
        model: a.modelLabel ?? a.model ?? null, family: familyOf(a.modelLabel ?? a.model), fast: a.fast === true,
        planAsk: a.state === 'waiting' && a.now?.tool === 'ExitPlanMode', // a plan waiting for your approval
        service: a.now?.service ?? null, // where a web or connector call goes
        jobs: (a.children ?? []).filter(c => c.kind === 'bgjob' && c.state === 'running').length, // background commands running
        wakeAt: a.wakeAt ?? null, nap: Boolean(a.wakeAt > now && (a.state === 'yourTurn' || a.state === 'idle') && !a.question), // it comes back by itself (/loop)
      })),
    };
  }

  // Stand-ins for paths in a private scene: the same repo (or project) gets the same one while the page is open.
  const standIns = new Map(), counts = { r: 0, p: 0 };
  const standIn = (value, prefix) => {
    if (value == null) return null;
    const k = `${prefix}:${value}`;
    if (!standIns.has(k)) standIns.set(k, `${prefix}${++counts[prefix]}`);
    return standIns.get(k);
  };
  /**
   * The scene for a world that may not see what agents say: no words (questions, replies, summaries,
   * task, message and subagent text, pull requests' titles, deploys' words, branches, where calls go)
   * and no paths (repos and projects get stand-in ids). Names, states, tools, steps, numbers and colours stay.
   */
  function privateScene(s) {
    // A session's name can be its title (conversation text): a private scene names an agent by its folder instead, numbered when two share one.
    const used = new Set(), labels = new Map(), byName = new Map();
    for (const a of s.agents) {
      const base = String(a.cwd ?? '').split('/').filter(Boolean).pop() || (a.kind === 'codex' ? 'codex' : 'agent');
      let label = base;
      for (let n = 2; used.has(label); n++) label = `${base} ${n}`;
      used.add(label);
      labels.set(a.id, label);
      if (!byName.has(a.name)) byName.set(a.name, label);
    }
    return {
      ...s, private: true,
      chrome: { ...s.chrome, errors: [] },
      subagents: s.subagents.map(x => ({ ...x, label: '', parent: byName.get(x.parent) ?? null })),
      mail: s.mail.map(m => ({ ...m, text: '' })),
      repos: s.repos.map(r => ({
        ...r, key: standIn(r.key, 'r'), main: standIn(r.main, 'r'), branch: null, project: standIn(r.project, 'p'),
        deploy: r.deploy ? { state: r.deploy.state, label: null, detail: null, url: null, source: null, ...(r.deploy.run ? { run: true } : {}) } : null,
        prs: r.prs ? { open: (r.prs.open ?? []).map(p => ({ number: p.number, checks: p.checks, draft: p.draft })), merged: (r.prs.merged ?? []).map(p => ({ number: p.number, at: p.at })) } : null,
      })),
      agents: s.agents.map(a => ({
        ...a, name: labels.get(a.id), cwd: null, repo: standIn(a.repo, 'r'), summary: '', ask: '', question: null, reply: '', said: '', service: null,
        tasks: a.tasks ? { done: a.tasks.done, total: a.tasks.total } : null,
        turn: a.turn ? { word: a.turn.word ?? null, startedAt: a.turn.startedAt ?? null, outTokens: a.turn.outTokens ?? null, mode: a.turn.mode ?? null } : null,
      })),
    };
  }

  window.AgentvilleScene = { VERSION, toScene, privateScene, colorOf, fieldOf, contextPct, askText, mailOf, cartsOf, deployOf, projectOf };
})();
