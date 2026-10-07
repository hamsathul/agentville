// What kind of step a tool call is, in plain terms (a test run, a push, an install…). The farm draws
// a different tool for each kind. Shell commands are read for what they do; when a command says
// nothing clear, its description is read instead.

export const STEPS = ['edit', 'write', 'read', 'search', 'web', 'test', 'lint', 'build', 'install', 'commit', 'push', 'deploy', 'pull', 'serve', 'delete', 'agent', 'plan', 'ask', 'shell', 'other'];

const TOOLS = {
  Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', NotebookRead: 'read', Skill: 'read',
  Grep: 'search', Glob: 'search', LS: 'search', WebSearch: 'web', WebFetch: 'web',
  Agent: 'agent', Task: 'agent', Workflow: 'agent',
  TodoWrite: 'plan', TaskCreate: 'plan', TaskUpdate: 'plan', TaskList: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
  AskUserQuestion: 'ask', Monitor: 'serve', BashOutput: 'serve', TaskOutput: 'serve',
};

// A command word at the start of the line or after ; && || | ( or `$(`.
const cmd = words => new RegExp(`(?:^|[;&|(]\\s*|\\$\\(\\s*)(?:sudo\\s+)?(?:${words})(?=\\s|$)`);
const PM = '(?:npm|pnpm|yarn|bun)';

// Commands that ship code themselves. "deploy" only counts as a script or task name, never as part
// of a host, folder or log file name.
const SHIPS = [
  /\b(?:vercel|netlify)\b.*(?:--prod|\bdeploy\b)|\bvercel\s+--prod\b/, /\b(?:fly|flyctl|firebase|serverless|sam|cdk|wrangler)\s+deploy\b/,
  /\bkubectl\s+(?:apply|rollout|set\s+image)\b|\bhelm\s+(?:upgrade|install)\b|\bterraform\s+apply\b/, /\bdocker\s+push\b/,
  new RegExp(`\\b(?:${PM}|cargo|twine)\\s+publish\\b`),
  /(?:^|[\s;&|('"/])(?:\.\/)?[\w.-]*deploy[\w.-]*\.sh\b/, new RegExp(`\\b${PM}\\s+(?:run\\s+)?deploy\\b`), /\bmake\s+deploy\b/,
  /\b(?:rsync|scp)\b[^|;&]*\s[\w.@-]+:/, // copying to a server
];
// Run on a server (over ssh), these ship too: bringing containers up, restarting services.
const SHIPS_ON_SERVER = [/\bdocker[\s-]compose\s+up\b|\bdocker-compose\s+up\b/, /\bpm2\s+(?:restart|reload|start)\b/, /\bsystemctl\s+(?:restart|reload|start)\b/, /\bdocker\s+(?:run|restart)\b/];
const ASKS_CI = /\bgh\s+workflow\s+run\b/; // a deploy too, but CI does it: its run says how it went
const SSH = cmd('ssh');
const shipsItself = c => SHIPS.some(p => p.test(c)) || (SSH.test(c) && SHIPS_ON_SERVER.some(p => p.test(c)));

// After deploys, first match wins: shipping beats packing, packing beats checking, and so on.
// Over ssh the rest of the line is the command run on the server, so it is read the same way.
const SHELL = [
  ['push', [/\bgit\s+push\b/, /\bgh\s+pr\s+(?:create|merge)\b/]],
  ['commit', [/\bgit\s+(?:commit|add|stash|tag)\b/]],
  ['pull', [/\bgit\s+(?:pull|fetch|clone|merge|rebase|cherry-pick)\b/]],
  ['test', [new RegExp(`\\b${PM}\\s+(?:run\\s+)?test\\b`), cmd('jest|vitest|mocha|pytest|rspec|phpunit'), /\bnpx\s+(?:jest|vitest|mocha)\b/, /\b(?:cypress\s+run|playwright\s+test)\b/, /\bnode\s+--test\b/,
    /\b(?:go|cargo|swift|dotnet|mix|deno)\s+test\b/, /\bmake\s+(?:test|check)\b/, /\bpython3?\s+-m\s+(?:pytest|unittest)\b/]],
  ['lint', [/\b(?:eslint|prettier|ruff|black|flake8|pylint|mypy|stylelint|biome|rubocop|golangci-lint|gofmt|swiftlint|shellcheck)\b/, new RegExp(`\\b${PM}\\s+(?:run\\s+)?(?:lint|format|fmt|typecheck|check)\\b`),
    /\btsc\b.*--noEmit\b/i, /\bnode\s+--check\b/, /\bcargo\s+(?:fmt|clippy|check)\b/]],
  ['install', [new RegExp(`\\b${PM}\\s+(?:install|i|ci|add)\\b`), /\bpip3?\s+install\b/, /\b(?:uv|poetry)\s+(?:add|install|sync)\b/, /\bbrew\s+install\b/, /\bcargo\s+(?:add|install)\b/,
    /\bgo\s+(?:get|install)\b/, /\b(?:bundle|gem)\s+install\b/, /\bapt(?:-get)?\s+install\b/]],
  ['build', [new RegExp(`\\b${PM}\\s+(?:run\\s+)?build\\b`), cmd('make|cmake|ninja|gradle|gradlew|mvn|xcodebuild|webpack|tsc'), /\b(?:swift|go|cargo|vite|next)\s+build\b/, /\bdocker\s+(?:compose\s+)?build\b/]],
  ['serve', [new RegExp(`\\b${PM}\\s+(?:run\\s+)?(?:dev|start|serve|preview)\\b`), cmd('serve|http-server|live-server|nodemon|uvicorn|gunicorn'), /\bpython3?\s+-m\s+http\.server\b/,
    /\b(?:runserver|flask\s+run|rails\s+s(?:erver)?)\b/, /\bdocker\s+(?:run|compose\s+up)\b/, /\btail\s+-[fF]\b/, /\bgh\s+run\s+watch\b/, cmd('sleep|watch')]],
  ['delete', [cmd('rm|rmdir|trash'), /\bgit\s+(?:rm|clean)\b/, /\bfind\b.*\s-delete\b/]],
  ['web', [cmd('curl|wget|http|https|xh')]],
  ['search', [cmd('grep|egrep|rg|ag|ack|find|fd|locate')]],
  ['read', [cmd('cat|head|tail|less|more|ls|tree|wc|stat|file|du|bat|jq|yq|open'), /\bgit\s+(?:status|log|diff|show|blame|branch)\b/,
    /\b(?:psql|mysql|sqlite3|mongosh|redis-cli)\b/, /\bdocker(?:[\s-]compose)?\s+(?:logs|ps)\b/]],
];

// A description in plain words, for a command that says nothing clear.
const SAID = [
  ['test', /\btests?\b/i], ['deploy', /\bdeploy/i], ['push', /\bpush/i], ['commit', /\bcommit/i], ['pull', /\b(?:pull|fetch|clone)\b/i],
  ['install', /\binstall/i], ['build', /\bbuild/i], ['lint', /\b(?:lint|format|type-?check)/i], ['delete', /\b(?:delete|remove)\b/i],
  ['serve', /\b(?:watch|serve|server)\b/i], ['search', /\b(?:search|find)\b/i],
];

function shellStep(command) {
  const c = String(command ?? '');
  if (shipsItself(c) || ASKS_CI.test(c)) return 'deploy';
  for (const [step, patterns] of SHELL) if (patterns.some(p => p.test(c))) return step;
  return 'shell';
}

/** Whether a tool call ships code itself (a deploy script over ssh, rsync to a server, vercel --prod…), so how it ends is how the deploy went. */
export function isDirectDeploy(name, input) {
  return name === 'Bash' && shipsItself(String(input?.command ?? ''));
}

/** The kind of work a tool call is: one of STEPS. */
export function stepOf(name, input = {}) {
  if (name === 'Bash') {
    const step = shellStep(input?.command);
    if (step !== 'shell' || !input?.description) return step;
    return SAID.find(([, re]) => re.test(input.description))?.[0] ?? 'shell';
  }
  if (TOOLS[name]) return TOOLS[name];
  if (/^mcp__.*(?:chrome|playwright|browser|puppeteer)/i.test(name ?? '')) return 'web';
  return 'other';
}
