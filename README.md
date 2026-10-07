# Agent Tracker

A live view of every AI coding agent working on your Mac: Claude Code sessions (interactive
and background), their subagents and background jobs, and Codex. It shows who is waiting on
you, what each agent is doing right now, which repos two agents are writing to at once, and
how much CPU and memory each one uses.

- **Dashboard** at <http://localhost:7777>, served only to this machine, laid out like an
  editor in three columns. **Left:** compact agent rows, waiting ones first, then working ones
  (each with a live tool ticker); idle and stale agents fold away, and repos sit below. The
  agents' memory and CPU are in the top bar, with your Claude plan's usage (the 5-hour and
  weekly limits, and when they reset, as Claude Code reports them). **Centre:** the agent you picked (the one at
  work, until you pick another) with its activity feed, charts, subagents, the repos it
  touched and its process tree. **Right:** an explorer of the agent's working folder, with git status letters (M, U, D) and a dot on
  files the agent edited or read. Repos are marked with their branch (and a ✗ when their
  last deploy failed), including several repos inside one folder. Above the folder, the
  explorer shows the session's **Scratchpad** (its working files under Claude Code's temp
  folder) and its **Memory**: the conversation summary it carries after a compaction, the
  CLAUDE.md files it loads, and the project's auto memory. Click a file to open it read-only
  in a tab: markdown is rendered, code gets line numbers.
  **Answer from the dashboard:** a waiting agent shows its question with clickable options (or
  an "Other" box), and a permission prompt shows the command with **Allow** / **Deny**.
  **Message any session** like a chat: type under "Now" and press Enter (Shift+Enter for a new line). It arrives
  as your own prompt; if the agent is busy, it is read when the current step ends. **Attach
  screenshots** by pasting (⌘V) or dropping them on the box, or with 📎: up to 6 images,
  10 MB each; the agent opens them with its Read tool.
  **Questions in replies:** when an agent ends its turn by asking something ("Should I push?"),
  the dashboard shows it as a question: an "asks you" chip, a card with the question (one-click
  **Yes** / **No…** for yes/no questions), a "?" on the farm's porch, and the tab title count.
  **Reply** on any of the agent's messages quotes it into your answer. The **Conversation**
  thread sits under the message box, newest first; **Show all** loads the session's whole
  history (or open the **Full transcript**).
  **Read and reply:** specs, plans and other markdown files the agent wrote or read are also
  listed under "Documents". In any open file, select a passage and **Quote** it (code quotes
  carry their line numbers), then reply; the agent gets it as a message about that file.
- **Pixel farm view** (☰ List | 🌾 Farm in the top bar): the same live data as a little farm.
  Every agent is a farmer and every repo a field. Each farmer has its own hat, hair and clothes;
  each field its own crop (the seed packet on its fence), soil and fence, and a pennant when it is
  on a branch other than main. A farmer that needs you walks to your porch and waves a red "!"; one whose turn it is brings a basket. Working farmers stand in the field
  of the repo they write to, holding a tool for their current step: an almanac when reading, a
  spyglass when searching, a magnifier over the crops for tests, a hammer for a build, a
  wheelbarrow for installs, a crate for a commit, a cart to market for a push (with a flag for a
  deploy), a lantern for a server, and more (ⓘ lists them all). Crops grow through six stages as
  the context fills, from seeds to ripe. Above each field,
  hay bales are uncommitted files, crates unpushed commits and a mailbox commits behind; the
  weather is the last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy
  script over ssh, rsync, vercel…), whichever is newer (rainbow, rain, windmill; a run GitHub never
  started for billing reasons shows no rain: "⏸ Actions didn't run") and a rope marks two agents in one repo.
  Hearts show context left, chickens are subagents and an Explore subagent is a dog. Click a
  farmer to open the sidebar beside the farm (or toggle it with ◨ Sidebar). Its tabs: **Agent**
  (answer its question or permission prompt, message it with screenshots, the conversation newest
  first), **Activity** (its tool steps), **Files** (its folder, scratchpad and memory) and **Diary**
  (who went where). Speech bubbles over the farmers show what each last said (its question when
  it waits on you); × hides one to a 💬 that shows it again, and the Bubbles switch hides or shows them all. The farm fits its frame; − / + (or ⌘/Ctrl + scroll, or a pinch) zooms it inside the frame, and you drag or scroll to move around. Click a field for a close-up of the files agents touched there.
  The farm is drawn in one palette, with shadows, textured ground and a pixel font for names
  and signs. The sky follows your clock (at night the windows and lanterns glow; the Sky
  switch holds it at day or night), farmers face where they walk, rain falls on a field whose
  deploy failed, and dust, splashes and chimney smoke move with the work. The silo's grain is
  your plan's weekly usage, the season follows its 5-hour limit (spring when fresh, winter when
  nearly used up), and the henhouse's eggs are subagents that finished lately. Follow keeps the
  farmer you picked in view.
  It pauses when hidden and follows the system's reduce-motion setting.
- **Start or resume sessions** (＋ Session in the top bar): start Claude Code in a folder you
  have worked in, or resume a session from the last 30 days by its title and last message. It
  opens a new Terminal or iTerm window (the `terminal` setting) running `claude` or
  `claude --resume <id>` there, in the permission mode you pick (ask first, accept edits, plan,
  auto, or bypass permissions with `--dangerously-skip-permissions`); sessions still running
  are marked and not offered. The window closes when Claude exits. The first time, macOS asks
  to let the tracker control that app.
- **Agents talking to each other:** when one session messages another (Claude Code's
  SendMessage between sessions), both conversations show the message (from or to whom), and on
  the farm a pigeon carries it from one farmer to the other, noted in the diary.
- **End or restart a session:** a terminal session's panel shows its permission mode (as of the
  last message you sent it), **End session** (after you confirm: Claude stops cleanly and its
  iTerm or Terminal window closes; the conversation can be resumed) and **Restart in…** another
  mode (it ends and resumes straight away in a new window, the conversation carrying on).
- **Claude Code mod:** `/tracker` opens a side pane, the status line shows
  `⚑ 1 waiting · 2 working`, and toasts appear when another agent needs you. The mod is also
  what lets the dashboard answer a session's questions and permission prompts and send it messages,
  and it reports the session's usage (`$.session.usage()`): its cost so far, shown on the agent,
  and the plan's limits, shown in the top bar. Sessions started before mod 0.4.0 show neither.
- **macOS notifications** when an agent needs you, finishes, collides with another agent in
  the same repo, or runs hot on CPU or memory. Each event notifies once.

Everything stays on your machine. The collector has no dependencies and listens on
`127.0.0.1` only.

## Requirements

- macOS (it uses launchd, `ps` and `osascript`)
- Node.js 22 or newer (nvm installs are found automatically)
- Claude Code; the mod needs a build with function-hook mods (tested on 2.1.291)
- Optional: `gh`, signed in, to show GitHub Actions deploy status for repos you list (a failed
  deploy links to its run and gives GitHub's reason, such as a billing stop)

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

New sessions then have `/tracker`. The mod reads `state/state.json`, which the collector writes
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
| `permissionDashboardSec` | How long a permission prompt is offered on the dashboard before the terminal shows it (default 15; 0 = terminal only) |
| `permissionGuessSec` | A tool call with no result for this long, with an idle process, shows as "probably a permission prompt" |
| `memoryAlertGb`, `cpuAlertPct`, `cpuAlertSustainSec` | Resource alert thresholds |
| `notify` | Turn each notification type on or off: `waiting`, `collision`, `yourTurn`, `memory`, `cpu` |
| `modToasts` | Toasts inside Claude Code sessions |
| `deployRepos` | Checkout path → `owner/repo` whose latest GitHub Actions run is shown, e.g. `{ "/Users/me/code/api": "me/api" }`. With no agent in it, such a repo is listed only while its deploy runs |
| `terminal` | Where ＋ Session opens: `"Terminal"` (default) or `"iTerm"` |

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

- The explorer shows what git shows: files git ignores (`node_modules`, `.env`, build output)
  are neither listed nor served, and nor are files that look like secrets (`.env*`, keys). In
  a folder that isn't a repo, dependency and hidden folders are skipped. It stays off for an
  agent working in your home folder. Files over 2 MB and binary files aren't shown; at most
  5,000 files are listed.
- Screenshots are saved under `state/uploads/` (kept for 7 days) and the message names them
  for the agent to open: a plugin's prompt can't carry an image itself.
- "Documents" and the explorer's dots come from the agent's Write, Edit and Read tool calls
  (not shell commands). After the collector restarts, a long session's list starts from its
  recent history.
- Only sessions that load the mod can be answered or messaged from the dashboard. While a permission prompt
  is offered there, the terminal shows a spinner; after `permissionDashboardSec` it shows the
  normal prompt.
- "Probably a permission prompt" is a guess: a tool call with no result for 20 s while the
  process is idle. A long, quiet network wait can trigger it.
- Background shell jobs and workflows show as `unknown` once started; their completion isn't
  tracked.
- claude.ai cloud sessions and Remote Control sessions on other machines aren't visible locally.

## Tests

```bash
npm test                    # collector + dashboard (node:test)
npm run test:ui             # the dashboard and the farm in headless Chrome, on a fixture
claude plugin test mod      # the Claude Code mod
scripts/e2e-answer.sh       # answering, messaging (with a screenshot, and to a busy session), the reader
```

GitHub Actions runs `npm test` and `npm run test:ui` on every push to `main` and on pull
requests. The mod's tests need a Claude Code build with mods, and `scripts/e2e-answer.sh`
needs real sessions, so those two run locally.

## License

MIT
