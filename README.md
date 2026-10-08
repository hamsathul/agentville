

https://github.com/user-attachments/assets/19447978-d50a-4339-9f50-a84f6ed9ac64

# Agentville

**Agentville is a live dashboard for every AI coding agent on your Mac**: Claude Code sessions (interactive
and background), their subagents and background jobs, and Codex. See who is waiting on you, what
each agent is doing right now and what it costs. Answer, message and steer them from one page,
and watch them work as farmers on a pixel farm.

![The farm view: every agent a farmer, every repo a field](docs/farm.png)

<sub>The farm view, from a demo with made-up sessions. Every farmer is an agent and every field a
repo. Two farmers wait on your porch, one has finished, and the rest work in their fields with the
tool for their current step.</sub>

Everything runs on your machine. The collector is a small Node program with no dependencies.
It listens on `127.0.0.1` only and reads what Claude Code already writes to disk.

## Contents

- [What it can do](#what-it-can-do)
- [Requirements](#requirements)
- [Install](#install)
- [Using it](#using-it)
  - [The list view](#the-list-view)
  - [Answering and messaging agents](#answering-and-messaging-agents)
  - [Side questions (/btw)](#side-questions-btw)
  - [Model, effort and permission mode](#model-effort-and-permission-mode)
  - [Starting, resuming, ending and restarting sessions](#starting-resuming-ending-and-restarting-sessions)
  - [⚙ Claude Code: plugins, MCP servers and permission rules](#-claude-code-plugins-mcp-servers-and-permission-rules)
  - [Files, documents and quoting](#files-documents-and-quoting)
  - [The farm view](#the-farm-view)
  - [Notifications and the bell](#notifications-and-the-bell)
  - [Inside Claude Code: the mod](#inside-claude-code-the-mod)
- [Configuration](#configuration)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)
- [Development](#development)
- [License](#license)

## What it can do

**See everything at once**
- Every Claude Code session on the Mac (terminal and background) and Codex, sorted by what needs
  you: **waiting on you**, **working**, **your turn**, **idle** and **stale**.
- What each one is doing right now: the tool it is running, the working line its terminal shows
  (`✻ Slithering… (5m 31s · ↓ 28.5k tokens · thinking with xhigh effort)`) and its recent steps.
- Its subagents, background jobs, task list, model, effort, permission mode, context left and
  cost so far.
- Your plan's usage (the 5-hour and weekly limits, and when they reset), and the CPU and memory
  your agents use.
- Collisions: two agents writing to the same repo at the same time.
- Each repo's branch, uncommitted files, unpushed commits, last deploy (GitHub Actions or a
  deploy an agent ran itself) and open pull requests.

**Respond without switching windows**
- Answer an agent's question (with its options) or a permission prompt (**Allow** / **Deny**).
- Message any session like a chat, with screenshots, PDFs or other files; it arrives as your own prompt.
- Read a session's whole conversation, from its first message, in a dialog you can search.
- Ask a session a side question (`/btw`) without interrupting or adding to its conversation.

**Steer your sessions**
- Start a new session in any folder of yours (type it, browse to it, or create it) or in one you've
  worked in, or find a past one (search, filter by folder, model, branch or running, sort by
  activity, start, name, folder or length) and resume it, in the permission mode, model and effort
  you choose.
- Switch a running session's model or effort, compact it, restart it in another permission mode,
  or end it (its terminal window closes too).
- See the shell commands each session runs right now (how long, CPU, memory), follow a background
  one's output, and stop one with everything it started.

**Manage Claude Code itself**
- See every plugin and skill with what it costs in context (always-on tokens per session), turn
  plugins on or off, update or uninstall them, and have running sessions reload them.
- Check every MCP server (yours, claude.ai connectors, each plugin's), sign in where needed, and
  remove the ones you configured. Review and remove permission rules.

**Read what they wrote**
- Browse an agent's folder with git status, its scratchpad and its memory (CLAUDE.md, auto
  memory, the summary it keeps after a compaction).
- Open specs and plans it wrote, quote a passage and reply about it.
- See pictures, PDFs, video, audio, HTML pages (as the page itself), Word documents and
  spreadsheets as themselves, not as code.
- Ask an agent for a screenshot or a screen recording: the file its reply names shows under the
  reply, and one click opens it.

**Get told when it matters**
- macOS notifications when an agent needs you, finishes, collides with another or runs hot.
- A bell in the page, and a count in the tab title.
- Inside Claude Code: a `/tracker` pane, a status line and toasts.

**Watch it as a farm** (optional)
- A pixel farm where every agent is a farmer and every repo a field. Crops grow as context
  fills, weather shows the last deploy, a cart runs to town for each web call, each MCP server's
  cart drives to the farmer calling it, and you click
  the barn to start a session.

## Requirements

- **macOS.** The service runs under launchd, and the tracker uses `ps` and `osascript`.
- **Node.js 22 or newer.** An nvm install is found automatically.
- **Claude Code.** The mod needs a build with plugin mods; it is tested on 2.1.293.
- **Optional: the GitHub CLI (`gh`)**, signed in, for deploy status and pull requests.

## Install

### 1. Get the code and the command

Its command keeps the project's first name, `agent-tracker`.

```bash
git clone https://github.com/hamsathul/agentville.git ~/tools/agentville
cd ~/tools/agentville
mkdir -p ~/.local/bin
ln -sf "$PWD/bin/agent-tracker" ~/.local/bin/agent-tracker   # ~/.local/bin must be on your PATH
```

### 2. Start the service

```bash
agent-tracker install     # a launchd service: starts now and at every login
agent-tracker status      # "http ok on :7777"
agent-tracker open        # opens http://localhost:7777
```

The dashboard already shows your sessions, their activity and their repos.

### 3. Load the mod in Claude Code (recommended)

The mod lets the dashboard answer, message and steer a session. It also reports the session's
cost, plan usage and working line. Add the `mod` folder to `~/.claude/settings.json`, using your
own clone path:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/tools/agentville/mod" } }
```

New sessions load it. In a session that is already running, type `/reload-plugins`. A session
with the mod shows **📡 dashboard answers on** on the dashboard, and `/tracker` opens its pane.

### 4. Optional: deploys and pull requests

Install the GitHub CLI and sign in (`gh auth login`). The tracker then:
- shows open pull requests (with their checks) for every repo whose `origin` is on GitHub;
- shows the latest GitHub Actions run for the repos you list in `deployRepos` (see
  [Configuration](#configuration)).

A deploy an agent runs itself (a deploy script over ssh, `rsync`, `vercel --prod`…) shows without
`gh`.

### 5. Optional: settings

```bash
cp config.example.json config.json   # then edit; it is re-read when you save it
```

### First run: macOS permissions

- **Automation.** The first time you start, resume or end a session from the dashboard, macOS
  asks to let the tracker control Terminal (or iTerm). Allow it, or later under System Settings →
  Privacy & Security → Automation.
- **Notifications.** Allow notifications if macOS asks. The page's bell asks the browser
  separately, the first time you switch it on.

### Update and uninstall

```bash
cd ~/tools/agentville && git pull && agent-tracker restart   # update; then /reload-plugins in open sessions
agent-tracker uninstall                                          # remove the service
```

To remove it completely, also delete the `CLAUDE_CODE_PLUGIN_DIRS` entry from
`~/.claude/settings.json` and the clone folder.

## Using it

Open <http://localhost:7777>. **☰ List** and **🌾 Farm** at the top switch between the two
views; both show the same live data, updated every few seconds.

### The list view

The page is laid out like an editor, in three columns:

- **Left: the agents.** Waiting ones come first, then the working ones with a live ticker of
  their current tool. Idle and stale agents fold away. Your repos sit below, each with its branch,
  last deploy, pull requests and the agents in it.
- **Centre: the agent you picked** (the one at work until you pick another). It shows:
  - its state, folder and model (a switch with `/model` shows at once, before its next reply);
  - its controls: permission mode, model, effort, Restart in…, End session;
  - CPU, memory, context left and cost;
  - **Now**: its working line and current tool. When nothing is running it says since when it has
    been your turn and the first line of its last reply, or since when it has been idle or quiet;
  - **Commands running**: each shell command it (or a subagent) runs now, foreground or background,
    with how long it has run and its CPU and memory, everything it started included. **Output**
    shows a background one's output, followed while the dialog is open (a foreground one hands its
    output to the session when it ends). **■ Stop** asks first, then ends the command and everything
    it started. The session sees the command end;
  - the message box, side questions and the conversation, newest first, with the newest message
    framed in teal under a **Latest** tag (with your message, when it is right below it);
  - its activity, background jobs and workflows, the repos it touched and its process tree.
- **Its Subagents tab**, next to the agent's own while it has any, says how many, with a pulse
  while one is at work. Each subagent is a card: its type and task, running for how long or done
  in how long, how many steps, its step now (`🔧 Grep createOrder in src/`), and what it last said
  or its result. **▸** opens it to what it was asked, its steps and words (followed while it
  works) and its result; **⤢ Read** opens its whole transcript in the conversation dialog. A
  subagent that runs in the background stays *running* until Claude Code's notice says it finished.
- **Right: the explorer.** The agent's folder with git status letters (M, U, D) and a dot on files
  it edited or read, its **Scratchpad** and its **Memory**.

Along the top: your agents' memory and CPU, your plan's 5-hour and weekly usage, and four cards:
**Waiting on you**, **Working**, **Your turn** and **Collisions**. The tab title counts the agents
that need you, e.g. `(2) Agentville`, and the farmhouse in the tab gets a red light.

| State | Meaning |
|---|---|
| **waiting** | It needs you: a question, a plan to approve, or a permission prompt |
| **working** | It is busy |
| **your turn** | It finished its turn (if it asked you something, the question shows) |
| **idle** | Nothing happening |
| **stale** | No activity for a day (`staleAfterHours`) |

### Answering and messaging agents

These need the mod in that session.

- **Questions.** A waiting agent's question shows with its options, plus an "Other" box. Pick and
  send; the session carries on as if you had answered in its terminal.
- **Permission prompts.** These show the command with **Allow** / **Always allow…** / **Deny**. The
  dashboard has the first 15 seconds (`permissionDashboardSec`); then the terminal asks as usual.
  **Always allow…** brings up Claude Code's own options for that call, the terminal's "Yes, and…"
  ones (always allow a rule in this project, access to a folder, accept edits for this session…),
  for 8 seconds: pick one and the call runs with it kept, exactly as Claude Code keeps it. Pick
  none and the terminal asks. It needs mod 0.6.0 or newer.
  - Only sessions whose mode can ask you (Ask first, Accept edits, Plan) offer prompts here. In
    bypass, don't-ask and auto mode the mode decides on its own, so a call goes straight on (mod
    0.6.2; an older mod held such calls for the 15 seconds, and the farmer went to the porch).
    In auto mode, a call its classifier hands to you is answered in the terminal.
- **Questions in replies.** When an agent ends its turn by asking something ("Should I push?"),
  it gets an "asks you" chip and a card, with one-click **Yes** / **No…** for yes/no questions.
- **Messages.** Type in the box under **Now** and press Enter (Shift+Enter for a new line). It
  arrives as your own prompt; a busy agent reads it when its current step ends.
- **Attachments.** Paste (⌘V), drop on the box or use 📎 Attach: any file (screenshots, PDFs,
  Markdown, text…), up to 6 of 10 MB each. The agent opens them with its Read tool.
- **📁 Folder** attaches a folder, picked in Finder's folder window. Nothing is uploaded: the
  message carries the folder's path, and the agent looks in it with its own tools.
- **Reply** on any of the agent's messages to quote it into yours. **Show all** loads the
  session's whole history, and **Full transcript** opens it in a new tab.
- **⤢ Read all**, on the Conversation heading, opens the whole conversation in a dialog: every
  message from the first, oldest first, read from the transcript however long it is. **Search**
  highlights every match in place, with "1 of 12" and ↑ ↓ (Enter for older, Shift+Enter for
  newer); it starts at the newest. While the dialog is open, new messages appear at the bottom.
  You can reply from it too: it has the same message box, with 📎 Attach and 📁 Folder, sharing the side
  panel's draft and files.

### Side questions (/btw)

The **Side question** box asks the session something on the side, like `/btw` in its terminal.
It is answered from the conversation so far, with no tools, even while the session is busy, and
nothing is added to the conversation. The answer appears under the box.

Click the **Side question** heading to fold the whole section away, or to bring it back. Folded,
the heading shows how many side questions the session has. The choice holds for every session,
in the list and in the farm's sidebar, and is remembered.

### Model, effort and permission mode

Each terminal session's bar shows its **permission mode**, its **model** (e.g. *Opus 5.5*) and its
**effort**.

- **Model and effort.** Pick another and confirm. The session runs `/model` or `/effort` itself
  after its current turn, as if you had typed it, and what Claude Code replied shows in the bar.
  As when you type them, Claude Code saves the model, and an effort from *low* to *xhigh*, as your
  default for new sessions. *max* stays with that session.
- **Compact…** asks what the summary should keep (optional, one line), then the session runs
  `/compact` with it after its current turn: the conversation so far becomes a summary, freeing
  its context.
- **Restart in…** another permission mode (ask first, accept edits, plan, auto, or bypass
  permissions). The session ends and resumes straight away in a new terminal window, and the
  conversation carries on.

Switching and side questions need mod 0.5.0 or newer, and Compact 0.6.0. For a session started
before you updated, run `/reload-plugins` in it.

### Starting, resuming, ending and restarting sessions

- **＋ Session** starts Claude Code in any folder, or resumes a past session.
  - **New session in any folder**: type or paste a path (`~/code/new-app`), and the folders in it
    are suggested as you type. **Tab** completes a name as a terminal does; click a folder to go
    into it, or `..` to go up. Hidden folders are suggested once you type the dot.
  - **Browse…** opens Finder's own folder window instead, in front of the browser, with its **New
    Folder** button. The folder you pick fills the field. The first time, macOS may ask to let the
    tracker control System Events, which shows that window.
  - A folder that doesn't exist yet gets **Create it**, which makes it (and any missing folders
    above it) after asking.
  - Only folders in your home folder or on a mounted drive (`/Volumes/…`) can be used.
  - The first time Claude Code runs in a folder, it asks in the new window whether to trust it.
  - Below are the folders you have worked in, each with **＋ New**.
  - **Search** matches titles, messages, folders and git branches.
  - **Filters**: folder (it narrows the folders to start in too), the model it last ran on, its git
    branch, and running or not. Each choice says how many sessions it holds; **Clear filters**
    resets them.
  - **Sort** by last active, started, name, folder or length (the transcript's size).
  - **Range**: the last 30 days, or **All time**. The list says how many it shows of how many, and
    the sort and range are kept for next time.
  - Each past session shows its folder, branch, model, length, and when it started and was last
    active.
  - You pick the permission mode, model and effort. Model and effort apply to that session only
    (`--model`, `--effort`), not your defaults.
  - It opens a new Terminal or iTerm window (the `terminal` setting), and the window closes when
    Claude exits.
- **End session** stops Claude cleanly after you confirm and closes its terminal window. You can
  resume the conversation later.
- A stale background session can be **removed** (`claude rm`).

### ⚙ Claude Code: plugins, MCP servers and permission rules

The **⚙ Claude Code** button in the top bar opens your Claude Code setup in three tabs.

- **Plugins & skills.** Every installed plugin, the costliest first, with what it holds (skills,
  agents, hooks, MCP servers) and its **always-on** tokens, added to every session while it is
  on; the total for the plugins that are on heads the list. **More** shows each part's cost, every
  session and when used. **Turn on / Turn off**, **Update** and **Uninstall…** run `claude plugin …`.
  A change reaches a running session once it reloads its plugins: **Reload running sessions** has
  every session listening for the dashboard run `/reload-plugins` (mod 0.6.1). Your own skills
  (`~/.claude/skills`) are listed with what each costs when used. A plugin loaded from a folder
  (like this dashboard's mod) is managed where it lives.
- **MCP servers.** `claude mcp list` checks every server by starting it, so the tab takes about 15
  seconds; **Check again** checks afresh. Servers are grouped as yours, claude.ai connectors, each
  plugin's (they come and go with the plugin) and each project's own, with how each is:
  connected, needs sign-in, failed (with the error) or not configured. **Sign in** opens a terminal
  window running `claude mcp login`, which opens your browser. **Remove…** forgets a server you
  configured (`claude mcp remove`).
- **Permission rules.** The allow, ask and deny rules and extra folders in your settings and in
  each project's on the dashboard (`.claude/settings.json` shared, `settings.local.json` just
  you). **Remove…** takes one out of its file and leaves the rest as it was. New rules come from
  **Always allow…** on a permission prompt.

### Files, documents and quoting

- Click a file in the explorer to open it read-only in a tab. In the farm view it opens in a dialog
  over the farm instead, which stays (**Open in a tab** moves it to the list view).
- Each kind of file shows as itself:

  | File | Shown as |
  |---|---|
  | Markdown | rendered |
  | Code, including React (`.jsx`, `.tsx`) | text with line numbers |
  | Pictures (png, jpg, gif, webp, svg…) | the picture, fitted, on a checkerboard, with its size |
  | PDF | the browser's PDF viewer, with pages, zoom and search |
  | Video and audio | a player that seeks |
  | HTML | **Preview**: the page itself, with the CSS, scripts and pictures beside it, sealed off from the dashboard. Or **Source** |
  | Word (docx, doc, rtf, odt) | **Page**: its headings, lists and tables, read by macOS's `textutil`. Or **Text** |
  | Excel (xlsx) and CSV | tables with column letters and row numbers, a tab per sheet, values as Excel shows them |
  | PowerPoint, Keynote, Pages, Numbers… | a picture of the first page, made by Quick Look |
  | Anything else (zip, fonts…) | a note saying it can't be shown |

- **Show in Finder** reveals the file, to open it in its own app. It never opens or runs it.
- **Documents** lists the specs, plans and other markdown files the agent wrote or read, and the
  pictures, videos and PDFs (a screenshot it checked, say).
- **Files a reply names.** When an agent's reply names a picture, a video, a PDF or a document (a
  screenshot it took, a recording it made, a plan it wrote), it shows under the reply: a thumbnail
  for a picture, a chip for the rest. One click opens it in the file dialog, in the list view too.
  This works in the conversation dialog as well.
  - Only files the dashboard may show get one: inside the agent's folder, scratchpad or memory, and
    neither git-ignored nor secret-looking. The rest stay plain text.
  - So ask it to save them in its scratchpad: *"Take a screenshot of the login page and save it in
    your scratchpad"*, or *"Record 10 seconds of the app with `screencapture -v` into your
    scratchpad"*. Taking pictures of the screen needs Screen Recording permission for the terminal
    app the session runs in. The Chrome tool saves its GIFs to Downloads, which can't be shown.
- In a file with text (code, markdown, a page's Source, a document's Text, a sheet), select a
  passage and **Quote** it, then reply. Quotes from code keep their line numbers, and the agent
  gets your reply as a message about that file. The reply box is there for every kind.

### The farm view

The same live data, as a farm. It fills the window, and its controls sit around the edges like a
game's.

![The farm at night](docs/farm-night.png)

**The layout.** Along the top are the barn, the silo and your farmhouse, with **your porch** in
front of it. Below them are the fields, one raised bed per repo, in a fenced grid that grows to 18
beds. While you look, a field keeps its bed: a new repo takes a free one (a worktree right after
its repo, a project's repo beside the others), and nothing else moves. A repo that goes away
leaves its bed empty, held for it for a day. An empty bed is fallow ground, a patch of darker
grass, so the fields in use stand out. When the page opens, the fields move up into free beds in
the order they had, so empty rows close up. The yard down the left holds the henhouse, the meadow,
the pond and the shade tree, and a forest surrounds the farm.

**Names.** On the porch a farmer's tag is just its name, and neighbouring tags sit at two heights so
none covers another. A name that is too long is shortened in the middle (`inventor…agement`);
hover over it for the whole name.

**Reading the farm.** The **i** button opens the full legend, including every tool a farmer
can hold.

| You see | It means |
|---|---|
| A farmer on the porch waving a red **!** | It is waiting on you (a scroll: a plan to approve) |
| A farmer on the porch with a basket | Its turn ended (a **?** bubble: it asked you something) |
| A farmer in a field, holding a tool | It is working in that repo. The tool is its step: almanac = reading, spyglass = searching, hoe = editing, magnifier = tests, hammer = build, crate = commit, cart = push (with a flag: deploy)… |
| A thought cloud | It is thinking between steps |
| A chore board beside it | Its task list, ticked as items are done (its name says e.g. 3/7) |
| Hearts in its name | Context left. Crops grow as context fills, from seeds to ripe |
| **Harvest!** | Its conversation was compacted, so the field starts again from seed |
| A pin on its hat | Its model: purple Opus, blue Sonnet, green Haiku, orange Fable |
| Speed lines / a red-and-white scarf / a blueprint | Fast mode / bypass permissions / plan mode |
| A purse | What it has cost (gold from $50) |
| Chickens, a dog | Its subagents (the dog: an Explore subagent) |
| A pump by a bed | A background command still running |
| A farmer in a hammock | It will wake up by itself (`/loop`), with when |
| Under the shade tree / a scarecrow | Idle / stale |
| A cart on the road | A web call (a fetch or a search), labelled with where it goes |
| Carts at the lane's end, by the road to town | One for each MCP server your agents called in the last hour (Gmail, playwright, Chrome…). While an agent calls one, its cart drives to that farmer with the server's name and waits beside it until the call is done, and a few seconds more. With **Motion off** (or reduced motion) it simply stands there |
| A pigeon | One session messaging another |
| Hay / crates / a mailbox above a field | Uncommitted files / unpushed commits / commits behind |
| Rainbow / rain / windmill over a field | Last deploy passed / failed / running |
| Rope with orange flags | Two agents writing to the same repo |
| A blue pennant / a greenhouse | A branch other than main / a worktree, beside its repo |
| Stones round some beds, with a sign | One project's repos, side by side |
| The market stall | Open pull requests as crates, tagged by their checks. **Sold!** means one was merged |
| The silo's grain / the season | Your plan's weekly usage / its 5-hour limit (winter when nearly used up). The tag at the silo's foot gives the week's figure, amber from 70% and red from 90% |
| Eggs, hens in the run | Subagents that finished lately / more running than farmers can lead |

**Controls.**
- **Top left, the panel.** The money spent and harvests, then waiting on you, working, your turn
  and collisions (click one to open its first agent), then RAM, CPU and plan gauges and a
  **needs you** button. Click its title to fold it away.
- **Top right.** List, ＋ Session, ⚙ Claude Code, Sidebar and the theme.
- **Bottom.** Follow (keep the picked farmer in view), Resting (hide idle and stale farmers),
  Bubbles, Sky (live, day or night), Motion, Bell, Help, and zoom.
- **Mouse.** ⌘/Ctrl + scroll or a pinch zooms, drag moves around, and a minimap appears while you
  are zoomed in.

**Click things.** Click a farmer to open its sidebar, with Agent, Activity, Subagents (its
subagents' cards, as in the list), Files and Diary tabs, or a field for a close-up of the files
agents touched there. A file you open from the farm, from its Files tab or a close-up, opens in a
dialog over the farm, with Quote and the reply box as in the list. Click a building for the rest:

| Building | Opens |
|---|---|
| Barn | Start or resume a session (the new farmer walks out of its door) |
| Farmhouse | Who is on your porch, with a button to open each |
| Silo | Your plan's usage and when each limit resets |
| Henhouse | The subagents and how each is going |
| Notice board | Each project's CLAUDE.md and memory |
| Market stall | The pull requests, with links |

The light follows your clock: cloud shadows by day, and lit windows, lanterns and fireflies at
night. The farm pauses when its tab is hidden and follows the system's reduce-motion setting.

### Notifications and the bell

- **macOS notifications** come from the collector: an agent needs you, finished its turn,
  collides with another in the same repo, or runs hot on CPU or memory. Each event notifies
  once; turn types on or off with `notify`.
- **The bell** (the farm's Bell switch) chimes in the page whenever an agent starts waiting on
  you, in either view. When the page is in the background, it also sends a desktop notice.

### Inside Claude Code: the mod

In every session that loads it:
- `/tracker` opens a side pane listing all agents.
- The status line reads `⚑ 1 waiting · 2 working`.
- Toasts appear when another agent needs you.

The mod also does the dashboard's work inside the session:
- delivers your answers and messages;
- runs model and effort switches;
- answers side questions;
- reports the session's cost, plan usage and working line.

## Configuration

`config.json` sits next to `config.example.json` and is re-read when you save it. A changed
`port` needs `agent-tracker restart`. Without a `config.json`, the defaults apply.

| Key | Meaning (default) |
|---|---|
| `port` | The dashboard's port (7777) |
| `pollMs`, `agentsCliPollMs`, `gitPollMs`, `deployPollMs`, `prPollMs` | How often each source is read: sessions (3 s), `claude agents` (30 s), git (10 s), deploys (60 s), pull requests (2 min) |
| `staleAfterHours` | Quiet this long and an agent is stale (24) |
| `collisionWindowMin` | How far back writes count towards a collision (30) |
| `permissionDashboardSec` | How long a permission prompt is offered on the dashboard before the terminal asks (15; 0 = terminal only) |
| `permissionGuessSec` | A tool call with no result for this long, with an idle process, counts as "probably a permission prompt" (20) |
| `memoryAlertGb`, `cpuAlertPct`, `cpuAlertSustainSec` | When an agent counts as running hot (2 GB; 90% for 120 s) |
| `notify` | Each notification on or off: `waiting`, `collision`, `yourTurn`, `memory`, `cpu` |
| `modToasts` | Toasts inside Claude Code sessions (on) |
| `deployRepos` | Checkout path → `owner/repo` whose latest GitHub Actions run is shown, e.g. `{ "/Users/you/code/api": "you/api" }` |
| `terminal` | Where sessions open: `"Terminal"` or `"iTerm"` |

## Commands

| Command | Does |
|---|---|
| `agent-tracker install` | Installs and starts the launchd service (it starts at login) |
| `agent-tracker uninstall` | Stops and removes the service |
| `agent-tracker start` / `stop` / `restart` | Starts, stops or restarts the collector |
| `agent-tracker status` | Whether the service runs and the dashboard answers |
| `agent-tracker open` | Opens the dashboard |
| `agent-tracker logs` | The last lines of its logs |

## How it works

The **collector** (`collector/`) is a Node program run by launchd. Every few seconds it reads:
- `~/.claude/sessions/*.json`: the live session registry;
- `claude agents --json`: background sessions;
- the transcripts under `~/.claude/projects/` (only the new bytes of each);
- `ps`: processes, CPU and memory, and each session's start flags;
- `git` in each repo, with `GIT_OPTIONAL_LOCKS=0`, so it never takes `index.lock` from an agent
  that is committing (it never fetches);
- `gh`, for deploys and pull requests.

From these it works out each agent's state, current step, task list, subagents, touched files and
collisions. It writes the result to `state/state.json` and serves it as the dashboard, the
`/api/state` endpoint and a stream of server-sent events.

The **mod** (`mod/`) is a Claude Code plugin. It reads `state/state.json` for its pane, status
line and toasts, and writes a small check-in file every 2 seconds. When the dashboard asks for
something (an answer, a message, a model switch, a side question), the collector leaves a file
for that session's mod. The mod picks it up and does it inside the session.

The **dashboard** (`web/`) is plain HTML and JavaScript, served by the collector. The farm is a
canvas, with its text drawn as HTML on top so it stays crisp.

## Privacy and security

- Everything stays on your Mac. The collector listens on `127.0.0.1` only and sends nothing
  anywhere. The exception is `gh`, which asks GitHub about your own repos.
- File contents, folder listings, past sessions, whole conversations and field close-ups are
  served only with a per-install token that the page carries. Every action (answer, message,
  start, end, switch…) also needs a same-origin request.
- The explorer shows what git shows. Ignored files (`node_modules`, `.env`, build output) and
  files that look like secrets (`.env*`, keys) are neither listed nor served.
- **■ Stop** only ever stops a session's shell commands, never the session itself, its MCP
  servers or anything else: the collector checks again in `ps`, then sends SIGTERM to the command's
  own process group (SIGKILL 3 s later if anything is left). A background command's output is read
  only with the token, and only from the file Claude Code named for it in the scratch folder.
- Files a reply names are checked with the collector before anything shows: token only, the same
  rules as the explorer. A picture's thumbnail loads through a short-lived link, kept by your
  browser only while the link lasts.
- Folders to start a session in are listed only with the token, and only in your home folder or
  on a drive. Making one is an action (token and same origin). Each path is checked where it really
  is, so a `..` or a link can't lead out of those places.
- Pictures, PDFs, players and page previews load through links that are random, last 10 minutes
  and open one file (a page's preview: its folder, under the same rules). An `<img>` or a player
  can't send the token, so the link stands in for it.
- Those files are served with their real type and `nosniff`, so a browser never runs one as
  something else, and in a sandbox. A previewed page's scripts run in an origin of their own,
  without the dashboard, its token or its data, and can load the files beside it but not read
  them. A Word document's page shows with no scripts at all.
- Files you attach are kept under `state/uploads/` for 7 days. A folder you attach is sent as its
  path only.
- The ⚙ Claude Code dialog runs `claude plugin …` and `claude mcp …` for you, and removing a rule
  edits that one entry in its settings file. A server's full command line or URL is never shown,
  as either can carry a key: only its host or the command it runs.

## Troubleshooting

| Problem | Try |
|---|---|
| The dashboard doesn't load | `agent-tracker status`, then `agent-tracker logs`. Check that nothing else uses the port |
| A session shows "dashboard answers off" | Its mod isn't loaded. Check `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, then type anything in the session or `/reload-plugins` |
| "runs an older tracker mod" | `/reload-plugins` in that session, or resume it |
| No cost, plan usage or working line | These come from the mod (0.4.0 or newer; the working line from 0.5.0) in a running session |
| No pull requests or deploy weather | `gh auth status`. Pull requests need a GitHub `origin`; Actions runs need the repo in `deployRepos` |
| ＋ Session or End session does nothing | Allow the tracker to control Terminal or iTerm: System Settings → Privacy & Security → Automation |
| **Browse…** or **📁 Folder** opens no window | Allow the tracker to control System Events: System Settings → Privacy & Security → Automation. A window may also be open behind others: pick or cancel it there |
| The bell is silent | Click the page once (browsers block sound until you do), and allow notifications |

## Known limits

- Only sessions that load the mod can be answered, messaged or switched from the dashboard.
- "Probably a permission prompt" is a guess: a tool call with no result for 20 s while the process
  is idle. A long, quiet network wait can look the same. It is never made in bypass or don't-ask
  mode, where no prompt can show.
- Switching a session's model or effort from the dashboard also changes your default for new
  sessions, as typing `/model` or `/effort` does.
- "Thinking" on the farm comes from the mod's working line. Without the mod, it is a guess (working
  with no tool call open).
- A project is a folder holding sibling repos. Your home folder and catch-all folders like `~/code`
  or `~/tools` are never a project.
- Text files over 2 MB aren't shown. Pictures, PDFs, video and audio go up to 200 MB, documents
  and sheets up to 50 MB.
- Sheets show their first 2,000 rows and 100 columns, without colours, merged cells or charts, and
  a formula's last saved result. A Word page loses its layout (headers, footers, page breaks) and
  its pictures. Word pages and first-page pictures need macOS's `textutil` and Quick Look.
- The explorer lists at most 5,000 files, and stays off for an agent working in your home folder.
- "Documents" and the explorer's dots come from the agent's Write, Edit and Read tool calls (not
  shell commands).
- claude.ai cloud sessions and Remote Control sessions on other machines aren't visible locally.

## Development

```
collector/   the collector: sources/, transcript/, derive/, server.mjs; its tests in test/
web/         the dashboard: index.html, app.js, panels.js, farm.js…
mod/         the Claude Code mod: hooks/register.tsx; its tests in tests/
bin/         the agent-tracker command and the launchd entry point
launchd/     the service definition
scripts/     end-to-end checks and the demo video
docs/        screenshots
```

```bash
npm test                    # collector and dashboard (node:test)
npm run test:ui             # the dashboard and the farm in headless Chrome, on a fixture
claude plugin test mod      # the Claude Code mod
scripts/e2e-answer.sh       # answering and messaging real sessions
npm start                   # run the collector in the foreground (stop the service first)
npm run demo [out.mp4]      # record the demo video, made-up sessions only (Chrome, ffmpeg; ~4 min)
```

GitHub Actions runs `npm test` and `npm run test:ui` on every push to `main` and on pull requests.
The mod's tests need Claude Code, and `scripts/e2e-answer.sh` needs real sessions, so those two run
locally.

## License

MIT
