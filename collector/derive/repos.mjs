import { lastDeployOf } from './deploys.mjs';

/**
 * The repos the dashboard lists (the repo rail and the farm's fields), busiest first. A repo is
 * listed while an agent writes to it or works in its folder; the repo an agent works in stays while
 * the agent is around, even when it touched nothing lately, so fields don't come and go. A stale
 * agent (a day without activity) no longer keeps one, so a project you closed goes away.
 */
export function reposFor(agents, { deployRepos = {}, repoInfo = new Map(), deploys = new Map(), directs = new Map(), lookup, home }) {
  const map = new Map();
  const ensure = path => {
    if (!map.has(path)) map.set(path, { ...(repoInfo.get(path) ?? { path, name: path.split('/').pop() }), deploy: deploys.get(path), lastDeploy: lastDeployOf(deploys.get(path), directs.get(path)), agentIds: [] });
    return map.get(path);
  };
  const addAgent = (path, id) => {
    const r = ensure(path);
    if (!r.agentIds.includes(id)) r.agentIds.push(id);
  };
  for (const a of agents) {
    if (a.state === 'stale') continue;
    for (const t of a.touching ?? []) if (t.repo) addAgent(t.repo, a.id);
    const own = a.cwd && a.cwd !== home && a.cwd !== '/' ? lookup(a.cwd) : null;
    if (own) addAgent(own, a.id);
  }
  // A repo watched for deploys with nobody in it shows only while its deploy runs (a windmill).
  for (const path of Object.keys(deployRepos)) {
    if (!map.has(path) && lastDeployOf(deploys.get(path), directs.get(path))?.state === 'running') ensure(path);
  }
  return [...map.values()].sort((x, y) => y.agentIds.length - x.agentIds.length || x.name.localeCompare(y.name));
}
