# Agent Tracker

A live view of every AI coding agent working on your Mac: Claude Code sessions (interactive
and background), their subagents and background jobs, and Codex. It shows who is waiting on
you, what each agent is doing right now, which repos two agents are writing to at once, and
how much CPU and memory each one uses.

- **Dashboard** at <http://localhost:7777>, served only to this machine. Agents waiting on
  you are listed first, then agents working (each with a live tool ticker), then finished ones.
  Click an agent to see its activity feed, subagents, the repos it touched and its process tree.
- **Claude Code mod:** `/agents` opens a side pane, the status line shows
  `⚑ 1 waiting · 2 working`, and toasts appear when another agent needs you.
- **macOS notifications** when an agent needs you, finishes, collides with another agent in
  the same repo, or runs hot on CPU or memory. Each event notifies once.

Everything stays on your machine. The collector has no dependencies and listens on
`127.0.0.1` only.

## Requirements

- macOS (it uses launchd, `ps` and `osascript`)
- Node.js 22 or newer (nvm installs are found automatically)
- Claude Code; the mod needs a build with function-hook mods (tested on 2.1.291)
- Optional: `gh`, signed in, to show GitHub Actions deploy status for repos you list

## Install

```bash
git clone https://github.com/hamsathul/agent-tracker.git ~/tools/agent-tracker
cd ~/tools/agent-tracker
cp config.example.json config.json       # optional: edit thresholds, deployRepos, …
ln -sf "$PWD/bin/agent-tracker" ~/.local/bin/agent-tracker
agent-tracker install                    # launchd service; starts at login
agent-tracker open                       # opens the dashboard
```

To load the mod in every Claude Code session, add the mod folder to `~/.claude/settings.json`
(use your own clone path):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/agent-tracker/mod" } }
```

New sessions then have `/agents`. The mod reads `state/state.json`, which the collector writes
next to the `mod/` folder.

## Commands

`agent-tracker install | uninstall | start | stop | restart | status | open | logs`

## Configuration

`config.json` is re-read when you save it; a changed `port` needs `agent-tracker restart`.
Without a `config.json`, the defaults in `config.example.json` apply.

| Key | Meaning |
|---|---|
| `pollMs`, `agentsCliPollMs`, `gitPollMs`, `deployPollMs` | How often each source is read |
| `staleAfterHours` | Quiet this long and an agent counts as stale (default 24) |
| `collisionWindowMin` | How far back writes count towards a collision (default 30) |
| `permissionGuessSec` | A tool call with no result for this long, with an idle process, shows as "probably a permission prompt" |
| `memoryAlertGb`, `cpuAlertPct`, `cpuAlertSustainSec` | Resource alert thresholds |
| `notify` | Turn each notification type on or off: `waiting`, `collision`, `yourTurn`, `memory`, `cpu` |
| `modToasts` | Toasts inside Claude Code sessions |
| `deployRepos` | Checkout path → `owner/repo` whose latest GitHub Actions run is shown, e.g. `{ "/Users/me/code/api": "me/api" }` |

## How it works

`collector/` reads these sources:
- `~/.claude/sessions/*.json`, the live session registry
- `claude agents --json`, every 30 s
- transcript files under `~/.claude/projects/` (only new bytes; at most a bounded tail)
- `ps`
- `git`, with `GIT_OPTIONAL_LOCKS=0` so it never takes `index.lock` in a checkout another
  agent is committing to (it never runs `fetch`)
- `gh`

From these it works out each agent's state:

| State | Meaning |
|---|---|
| waiting | a pending question or plan approval, or probably a permission prompt |
| working | the agent is busy |
| your turn | it finished a turn and is waiting for your next prompt |
| stale | no activity for `staleAfterHours` |
| idle | nothing happening |

It also tracks which repos each agent is touching and flags collisions. The result goes to
`state/state.json` and is served as the dashboard, `/api/state` and a Server-Sent Events
stream. Action endpoints require a per-install token and a same-origin request.

## Known limits

- "Probably a permission prompt" is a guess: a tool call with no result for 20 s while the
  process is idle. A long, quiet network wait can trigger it.
- Background shell jobs and workflows show as `unknown` once started; their completion isn't
  tracked.
- claude.ai cloud sessions and Remote Control sessions on other machines aren't visible locally.

## Tests

```bash
npm test                    # collector + dashboard (node:test)
claude plugin test mod      # the Claude Code mod
```

## License

MIT
