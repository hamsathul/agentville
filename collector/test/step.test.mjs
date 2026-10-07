// What kind of step a tool call is: the farm draws a different tool for each kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepOf } from '../derive/step.mjs';

test('tools map to the kind of work they do', () => {
  const cases = [
    ['Edit', 'edit'], ['MultiEdit', 'edit'], ['NotebookEdit', 'edit'], ['Write', 'write'], ['Read', 'read'], ['Skill', 'read'],
    ['Grep', 'search'], ['Glob', 'search'], ['WebSearch', 'web'], ['WebFetch', 'web'], ['mcp__claude-in-chrome__navigate', 'web'], ['mcp__playwright__browser_click', 'web'],
    ['Agent', 'agent'], ['Task', 'agent'], ['Workflow', 'agent'], ['TodoWrite', 'plan'], ['TaskCreate', 'plan'], ['EnterPlanMode', 'plan'],
    ['AskUserQuestion', 'ask'], ['Monitor', 'serve'], ['mcp__notion__search', 'other'], ['SomethingNew', 'other'], [undefined, 'other'],
  ];
  for (const [tool, step] of cases) assert.equal(stepOf(tool, {}), step, String(tool));
});

test('shell commands are read for what they do', () => {
  const cases = {
    test: ['npm test', 'cd app && npm run test:unit', 'pytest -q tests/', 'go test ./...', 'node --test collector/test', 'npx playwright test', 'make test', 'npm test 2>&1 | tail -5'],
    lint: ['npx eslint .', 'prettier --write src', 'ruff check .', 'node --check web/farm.js', 'tsc --noEmit', 'npm run typecheck'],
    build: ['npm run build', 'tsc -p .', 'cargo build --release', 'docker build -t app .', 'make'],
    install: ['npm install', 'npm i -D vitest', 'pip install -r requirements.txt', 'brew install gh', 'uv sync', 'rm -rf node_modules && npm ci'],
    commit: ['git add -A && git commit -m "Fix it"', 'git commit --amend --no-edit', 'git stash'],
    push: ['git push origin main', 'git add . && git commit -m x && git push', 'gh pr create --fill'],
    deploy: ['vercel --prod', 'gh workflow run deploy.yml', 'kubectl apply -f k8s/', 'ssh vps "docker compose up -d"', 'rsync -av dist/ host:/srv/app', 'npm publish'],
    pull: ['git pull --rebase', 'git clone https://github.com/x/y', 'git fetch origin', 'git merge main'],
    serve: ['npm run dev', 'python3 -m http.server 8000', 'docker compose up -d', 'tail -f logs/app.log', 'gh run watch 123', 'sleep 30'],
    delete: ['rm -rf dist', 'git clean -fd', 'find . -name "*.tmp" -delete'],
    web: ['curl -s https://api.github.com/repos/x/y', 'wget https://e.com/f.zip'],
    search: ['grep -rn foo src', 'rg TODO', 'find . -name "*.ts"', 'cat app.log | grep ERROR'],
    read: ['cat README.md', 'ls -la', 'git status', 'git log --oneline -5', 'cd repo && git diff', 'head -20 notes.txt', 'jq . package.json'],
    shell: ['echo hi', 'chmod +x run.sh', 'git checkout -b feature', ''],
  };
  for (const [step, commands] of Object.entries(cases)) for (const command of commands) assert.equal(stepOf('Bash', { command }), step, command);
});

test('an unclear command falls back to its description', () => {
  assert.equal(stepOf('Bash', { command: 'node scripts/e2e-ui.mjs', description: 'Run the browser tests' }), 'test');
  assert.equal(stepOf('Bash', { command: './ci.sh', description: 'Push the branch' }), 'push');
  assert.equal(stepOf('Bash', { command: 'python3 x.py', description: 'Rewrite the header' }), 'shell');
  assert.equal(stepOf('Bash', { command: 'git push', description: 'Run the tests first' }), 'push', 'the command wins when it is clear');
});

test('every step kind is listed', () => {
  assert.deepEqual([...STEPS].sort(), ['agent', 'ask', 'build', 'commit', 'delete', 'deploy', 'edit', 'install', 'lint', 'other', 'plan', 'pull', 'push', 'read', 'search', 'serve', 'shell', 'test', 'web', 'write']);
});
