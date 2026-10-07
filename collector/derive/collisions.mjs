/** Spec §7: ≥ 2 agents writing one repo inside the window, at least one working or waiting. */
export function findCollisions(agents, now, windowMs) {
  const byRepo = new Map();
  for (const agent of agents) {
    for (const t of agent.touching ?? []) {
      if (!t.repo || t.mode === 'read' || now - t.lastAt > windowMs) continue;
      if (!byRepo.has(t.repo)) byRepo.set(t.repo, new Map());
      const perAgent = byRepo.get(t.repo);
      const entry = perAgent.get(agent.id) ?? { agent, firstAt: Infinity, hasGit: false };
      entry.firstAt = Math.min(entry.firstAt, t.firstAt ?? t.lastAt);
      entry.hasGit ||= t.mode === 'git';
      perAgent.set(agent.id, entry);
    }
  }
  const out = [];
  for (const [repo, perAgent] of byRepo) {
    if (perAgent.size < 2) continue;
    const list = [...perAgent.values()];
    if (!list.some(e => e.agent.state === 'working' || e.agent.state === 'waiting')) continue;
    const hasGit = list.some(e => e.hasGit);
    const starts = list.map(e => e.firstAt).sort((a, b) => a - b);
    out.push({
      repo,
      agentIds: list.map(e => e.agent.id).sort(),
      severity: hasGit ? 'high' : 'normal',
      since: starts[1],
      reason: `${list.length} agents writing${hasGit ? ' · git command' : ''}`,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.repo.localeCompare(b.repo) : a.severity === 'high' ? -1 : 1));
}
