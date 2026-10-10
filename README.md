



https://github.com/user-attachments/assets/803b91f8-a0ca-4ba8-835b-b889cefef32f



# Agentville

**Agentville is a live dashboard for every AI coding agent on your Mac**: Claude Code sessions (interactive
and background), their subagents and background jobs, and Codex. See who is waiting on you, what
each agent is doing right now and what it costs. Answer, message and steer them from one page,
and watch them work as farmers on a pixel farm.

![The farm view: every agent a farmer, every repo a field](docs/farm.png)

<sub>The farm view, from a demo with made-up sessions. Every farmer is an agent and every field a
repo. Three farmers wait on your porch, one has finished, and the rest work in their fields with
the tool for their current step.</sub>

Everything runs on your machine. The collector is a small Node program with no dependencies.
It listens on `127.0.0.1` only and reads what Claude Code already writes to disk.

## Contents

- [What it can do](#what-it-can-do)
- [Requirements](#requirements)
- [Install](#install)
- [Using it](#using-it)
  - [The list view](#the-list-view)
  - [Answering and messaging agents](#answering-and-messaging-agents)
  - [📣 Broadcast: one message to several agents](#-broadcast-one-message-to-several-agents)
  - [Stopping a turn (■ Stop)](#stopping-a-turn--stop)
  - [Side questions (/btw)](#side-questions-btw)
  - [Notes for later](#notes-for-later)
  - [✨ Helper and suggested names](#-helper-and-suggested-names)
  - [Model, effort and permission mode](#model-effort-and-permission-mode)
  - [Starting, resuming, forking, ending and restarting sessions](#starting-resuming-forking-ending-and-restarting-sessions)
  - [Several Claude accounts](#several-claude-accounts)
    - [Setting up a second account](#setting-up-a-second-account)
  - [Going back to an earlier point (↺ Restore)](#going-back-to-an-earlier-point--restore)
  - [⚙ Claude Code: plugins, MCP servers and permission rules](#-claude-code-plugins-mcp-servers-and-permission-rules)
  - [Files, documents and quoting](#files-documents-and-quoting)
  - [Worlds](#worlds)
    - [The farm](#the-farm)
    - [The robot factory](#the-robot-factory)
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
  your agents use. With several Claude accounts, each one's plan, and which account every agent is on.
- Collisions: two agents writing to the same repo at the same time.
- Each repo's branch, uncommitted files, unpushed commits, last deploy (GitHub Actions or a
  deploy an agent ran itself) and open pull requests.

**Respond without switching windows**
- Answer an agent's question (with its options) or a permission prompt (**Allow** / **Deny**), or
  cancel its questions as Esc does and tell it what you want instead.
- Message any session like a chat, with screenshots, PDFs or other files; it arrives as your own prompt.
  What you send a working session waits until its turn ends, where you can remove, edit or send it
  early.
  ↑ in the box brings back what you sent it before, as in its terminal.
- Broadcast one message to several sessions at once: all of them, or the ones you tick.
- Read a session's whole conversation, from its first message, in a dialog you can search.
- Ask a session a side question (`/btw`) without interrupting or adding to its conversation.
- Keep notes on a session: things you may want to tell it later, or not. Put one in the message
  box to edit, or send it as it is. Notes stay after the session ends, and a fork gets a copy.

**Steer your sessions**
- Stop a session in the middle of its turn, as Esc does in its terminal: it stops what it was doing
  and waits for you.
- Fork a conversation from any message into a new session: from one of Claude's replies, or from
  just before one of your messages, which then waits in the new session's prompt box for you to change.
- Restore a session to before one of your messages, as `/rewind` does: its conversation, its code
  (the files Claude edited since), or both.
- Name a session with one click: a small Claude model (Haiku) suggests a short name from what it is
  working on, through your own Claude Code, only after you switch the ✨ Helper on. With its Animal
  lines ticked, Haiku also writes what the farm's animals say about what is happening.
- Start a new session in any folder of yours (type it, browse to it, or create it) or in one you've
  worked in, or find a past one (search, filter by folder, model, branch, account or running, sort by
  activity, start, name, folder or length) and resume it, in the permission mode, model and effort
  you choose, and on the Claude account you choose when you have several.
- Switch a running session's model or effort, compact it, restart it in another permission mode
  or move it to another of your Claude accounts, or end it (its terminal window closes too).
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

**Watch it as a farm, a robot factory, or a world of your own** (optional)
- Choose how the dashboard draws your agents: the farm, the robot factory, or a world of your own.
- A pixel farm where every agent is a farmer and every repo a field. Crops grow as context
  fills, weather shows the last deploy, the season follows your 5-hour limit (or hold one with the
  **Season** switch), a cart runs to town for each web call, each MCP server's cart drives to the
  farmer calling it, and you click the barn to start a session.
- A sidebar beside the farm for any agent: pick one from a list or step through them, answer the
  others that need you from their cards without leaving the one you are on (Allow, Yes, an option),
  and chat with it, the newest message by one box for a message, a side question or a note.
- Animals on the farm, just for fun: cows, goats, a sheepdog, an ostrich, a lion, a tiger and a duck
  family on the pond. Click one to pet or feed it, and a farmer walks over to do it. Now and then they
  get up to something (a goat steals a hat), react to deploys and merges, and huddle in winter.
- A bright robot factory, the second world, showing everything the farm shows: every agent a robot
  put together from parts picked by its id, every repo an assembly bay where a robot is built as the
  context fills. Drones are subagents and web calls, AGVs drive to the robot calling an MCP server,
  messages shoot through pneumatic tubes, and the floor heats up with your 5-hour limit (or hold a
  level with the **Heat** switch). A robot dog, a robot vacuum and a cat live there just for fun.
- The farm and the factory are worlds: each runs in a sandboxed frame of its own, with no access to
  the token, and asks the page for the little it needs ([docs/worlds.md](docs/worlds.md)). A world
  from your own folder sees no words or paths until you tick **Can see what agents say** for it.
- Make your own world, or have Claude make one: `npm run new-world`, the test page, `check-world`
  and `world-shots`, with a guide written for Claude Code to follow ([docs/worlds.md](docs/worlds.md)).
  The test page shows any world playing a tour of made-up snapshots, each situation at its own
  address for a screenshot, with no token and no real data; `npm run check-world` plays the same
  tour headless and names the file and line of what breaks; `npm run world-shots` takes a picture of
  every stop. A world draws its people, what they hold and its animals with the kits that come with
  it.

## Requirements

- **macOS.** The service runs under launchd, and the tracker uses `ps` and `osascript`.
- **Or Windows 10/11** with Windows PowerShell 5.1. It detects the platform, checks its dependencies and refuses to start with a clear message if one is missing: see [docs/windows.md](docs/windows.md).
- **Node.js 22 or newer.** An nvm install is found automatically. `npm run check-world` needs
  22.13 or later (or 23.5 or later), to run a world contained.
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

Open <http://localhost:7777>. **☰ List** at the top and the button beside it switch between the
two views: the list, and the world you chose (**🌾 Farm** until you choose another); the small **▾**
after them opens the list of worlds from either view. Both show the
same live data, updated every few seconds. A world fills the window, so it has its own **List**
button to come back; where one might not (any world of yours, and a built-in one that draws itself),
the page adds **World ▾** and **☰ List** in a corner.

### The list view

The page is laid out like an editor, in three columns:

- **Left: the agents.** Waiting ones come first, then the working ones with a live ticker of
  their current tool. Idle and stale agents fold away. Your repos sit below, each with its branch,
  last deploy, pull requests and the agents in it.
- **Centre: the agent you picked** (the one at work until you pick another). It shows:
  - its state, folder and model (a switch with `/model` shows at once, before its next reply);
  - its controls: permission mode, model, effort, Restart in…, End session;
  - CPU, memory, context left and cost;
  - **Now**: its working line and current tool, with **■ Stop** to end the turn as Esc does. When
    nothing is running it says since when it has been your turn and the first line of its last
    reply, or since when it has been idle or quiet;
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

Along the top: your agents' memory and CPU, your plan's 5-hour and weekly usage (a block for each
account when you have several Claude accounts: see [Several Claude accounts](#several-claude-accounts)), and four cards:
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
  - **✕ Cancel** dismisses all its questions and stops the turn, as Esc does in the terminal. The
    session reads that you interrupted it; then send what you want instead from the message box. It
    needs mod 0.7.0, like **■ Stop**.
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
  arrives as your own prompt.
- **Messages to a working session wait.** Sent while it is busy (working, or waiting on you in the
  middle of a turn), a message goes into **Waiting to send** under the box instead, until the turn
  ends. There, each one has **✕** (don't send it), **Edit** (change it in place) and **⚡ Send now**
  (send it at once: Claude Code hands it to Claude at its next step, so it can steer the turn).
  When the turn ends, the first one goes out, and the next waits until that turn ends too; tick
  **Send together** to send all of them as one message instead. A session that is gone for two
  minutes with messages still waiting gets them as notes on it (a very long one is cut to a note's
  4,000 characters). (Prompts you type in
  the session's terminal while it works go into Claude Code's own queue, which the dashboard can't
  see or change.)
- **↑ / ↓ recall what you sent**, as in the session's terminal. With the cursor on the box's first
  line, ↑ brings back your last message to that session, then the one before. ↓ on the last line
  goes forward again, and past the newest gives back what you were typing.
  - It recalls what you typed in the session's terminal or sent from the dashboard, read from its
    transcript.
  - Slash commands aren't recalled, as a message doesn't run them. Neither are files: a message
    comes back as its text.
- **Attachments.** Paste (⌘V), drop on the box or use 📎 Attach: any file (screenshots, PDFs,
  Markdown, text…), up to 6 of 10 MB each. The agent opens them with its Read tool.
- **📁 Folder** attaches a folder, picked in Finder's folder window. Nothing is uploaded: the
  message carries the folder's path, and the agent looks in it with its own tools.
- **Reply** on any of the agent's messages to quote it into yours. **Show all** loads the
  session's whole history, and **Full transcript** opens it in a new tab.
- **⤢ Read all**, on the Conversation heading, opens the whole conversation in a dialog: every
  message from the first, oldest first, read from the transcript however long it is. **Search**
  highlights every match in place, with "1 of 12" and ↑ ↓ (Enter for older, Shift+Enter for
  newer); it starts at the newest. While the dialog is open, new messages appear at the bottom,
  and it goes down to each one as it comes, unless you are searching.
  You can reply from it too: it has the same message box, with 📎 Attach and 📁 Folder, sharing the side
  panel's draft and files.

### 📣 Broadcast: one message to several agents

**📣 Broadcast** (in the list view's top bar, and in the farm's Menu) sends one message to every
agent you tick:
- The list has every agent, those that need you first. Tick them one by one, or pick **All**, **Need
  you**, **Working**, **Your turn & idle** or **None**.
- Each one gets it as your own message, as its own message box would send it: a busy one's copy waits
  for its turn to end, under its message box, where you can remove, edit or send it now (see
  "Messages to a working session wait"). The line under the box says which wait.
- A session that isn't listening for the dashboard yet (send it anything in its terminal once), and
  Codex, can't be ticked; the list says why.
- **⌘↩** sends (a plain ↩ is a new line, so one key can't reach several agents by accident). Under the
  box, a line for each says whether it was sent.
- It is text only: send files and folders from an agent's own box.

### Stopping a turn (■ Stop)

While a session works, its working line under **Now** has **■ Stop**. It ends the turn at once, as
Esc does in its terminal:
- The model stops, and a shell command it was running in the foreground ends. The session waits
  for you, and the dashboard shows it as *your turn*.
- The conversation stays. The session reads that it was interrupted, as after Esc, so you can tell
  it what to do instead.
- A message you sent while it worked isn't lost: it becomes the session's next prompt. That's the
  way to stop it and steer it at once.
- A command the model put in the background on purpose keeps running. Stop that one under
  **Commands running** (in the farm's sidebar, open **N commands running** under Now), whose
  **■ Stop** ends a single command.
- There is no confirm, as Esc has none. It takes up to 2 seconds, since the mod checks for
  requests every 2 seconds.

It needs mod 0.7.0 or newer. For a session started before you updated, run `/reload-plugins` in
it.

### Side questions (/btw)

The **Side question** box asks the session something on the side, like `/btw` in its terminal.
It is answered from the conversation so far, with no tools, even while the session is busy, and
nothing is added to the conversation. The answer appears under the box.

In the list, click the **Side question** heading to fold the whole section away, or to bring it
back. Folded, the heading shows how many side questions the session has. The choice holds for every
session, and is remembered. In the farm's sidebar, **Side question** is one of the message box's three
modes instead: pick it above the box, and the chat shows the side questions and their answers.

### Notes for later

**Notes**, under the message box, is where you keep what you may want to tell a session later:
a thought while it works, the next step, a question for when it is done. Nothing in a note goes to
the session until you use it.

- Write a note in the box and press **Add** (↩ adds, ⇧↩ starts a new line). Each note is its own
  card, in the order you wrote them. Click a note's text to edit it (↩ saves, Esc cancels).
- **↳ Use** puts the note at the end of the message box, to change before you send it. Once that
  message is sent, the note counts as used. If you clear the box instead, it stays unused.
- **Send now** sends the note as it is, as your own message, at once even if the session is busy (it
  reads it at its next step), and marks it used.
- A used note stays, crossed out, so you can see what you have already said. **Clear used** removes
  them all; **✕** deletes one.
- You can write notes for any session on the dashboard, even one that isn't listening for the
  dashboard yet; **↳ Use** and **Send now** wait until it is.
- Notes belong to the session and stay after it ends. Resume it, or restore it, and they are there
  again; a fork gets a copy. In **＋ Session**, a past session with notes you haven't used shows 📝
  and how many.
- A session holds up to 200 notes of up to 4,000 characters each.
- Like Side question, the heading folds the section away and, folded, says how many notes are unused.
  In the farm's sidebar, **Note** is one of the message box's modes: pick it to write notes in the
  box and see them above it, with **↳ Use** turning the box back into a message box.

### ✨ Helper and suggested names

The **✨ Helper** does small writing jobs for the dashboard with Haiku, a small, fast Claude
model. It is **off until you switch it on**, in **✨ Helper** in the list view's header (or with ✨
beside a session's name while it is off, in the list or the farm's sidebar), and does only what you
tick there. The farm's own buttons have no ✨ Helper yet: to change it from the farm, go to the list
view.

- **How it calls Haiku:** through the Agentville mod inside one of your open Claude Code
  sessions, with your sign-in, on your Claude plan. There is no API key, nothing is added to any
  conversation, and no new session starts. With no session open, nothing is called.
- **Name suggestions:**
  - When a new session (started after you switched the helper on) has replied once and still
    has Claude Code's own name (such as `agent-tracker-9c`), its sidebar offers one:
    **Name it `login-bug`?** ✓ Rename · ✎ Edit · ✕.
  - **✓ Rename** runs `/rename` in the session, as if you typed it. The dashboard, its terminal
    tab, ＋ Session and messages between sessions then use the new name. A session's name is
    also how other sessions address it.
  - **✎ Edit** lets you change the name first. **✕** keeps its name, and it isn't offered again.
  - **✨** beside any session's name asks for a name at any time.
- **What it sends:** the session reads its own first three messages and the start of Claude's
  first reply (about 2,000 characters) and sends them to Haiku itself, as it sends its whole
  conversation to its own model. The dashboard only ever sees the name.
- **Animal lines:** with it ticked, Haiku writes what the animals on screen say about what is
  happening ("not my fault (it was deploy-bot)" from the ostrich after a failed deploy).
  - **When:** a batch when something happens (a deploy fails or goes through, a harvest, a merge,
    someone new), at most once every 5 minutes, and one every 30 minutes for idle chatter; only
    while a dashboard shows a world with its animals (and for up to 10 minutes after). Ticking it
    again asks at once. Each batch is one call, counted in the daily limit.
  - **What it sends:** the dashboard's facts only: agent and repo names (the names the dashboard
    shows, which Claude Code may take from a conversation's title), each agent's state, a word for
    what it is doing (editing, running, searching…), how many are waiting or working, which kinds of
    animal are on screen, what just happened, and which built-in world it is (`farm` or `factory`,
    so the lines are in its words; your own worlds and the starter aren't named). Never code, file
    paths, commands, branches or anything else said in a conversation. One of your open sessions
    (idle ones first, taking turns) makes the call.
  - **What the animals say:** each fresh line once, before their own; what you click (Pet, Feed…)
    keeps its own line. A world of yours that can't see what agents say gets only the lines with no
    names in them.
  - It needs mod 0.9.0 in a session (`/reload-plugins`). While the robot dog or the robot vacuum
    is on screen (and 10 minutes after) it needs 0.9.1: older mods aren't asked, so no lines come
    until a session has it. ✨ Helper says when no session can run it.
- **A daily limit** (200 to start, 1 to 2,000) caps the calls. The dialog shows today's count and
  the last error, and says when today's limit is reached (it resets at midnight). **Switch off**
  asks for nothing more at once; a call already under way finishes, and its answer is dropped.
- Names need mod 0.8.0 in the session, animal lines 0.9.0 (0.9.1 for the robot dog and the robot
  vacuum). For a session started before you updated, run `/reload-plugins` in it.

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
  conversation carries on. With several Claude accounts it also offers **Move to another account**:
  the same, on the account you pick, in the mode the session is in (see
  [Several Claude accounts](#several-claude-accounts)).

Switching and side questions need mod 0.5.0 or newer, and Compact 0.6.0. For a session started
before you updated, run `/reload-plugins` in it.

### Starting, resuming, forking, ending and restarting sessions

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
    active, and 📝 with a count when it has notes you haven't used. A session resumed in another
    folder is listed once, as it is now.
  - You pick the permission mode, model and effort. Model and effort apply to that session only
    (`--model`, `--effort`), not your defaults.
  - With several Claude accounts, you also pick the **Account**: **As each last ran** (the default),
    or one for whatever you start or resume. Each choice shows how much of its limits it has used.
    Each past session and folder shows the account it last ran on, and the filters include
    **Account**.
  - It opens a new Terminal or iTerm window (the `terminal` setting), and the window closes when
    Claude exits.
- **⑂ Fork** on any message in the conversation (in the side panel or ⤢ Read all; it shows when you
  point at the message) starts a new session from the conversation at that point, in a new terminal
  window. The original session is left as it is and can keep working.
  - On one of Claude's replies, the new session has the conversation up to and including that reply.
  - On one of your messages, it has the conversation up to just before it, and your message waits in
    its prompt box, so you can change it and send it. That is how you try a different answer.
  - You pick the permission mode, model and effort, and the account when you have several; they start as the original session's.
  - The new session is named after the original, with "(fork)". It is a session of its own: resume
    it later from ＋ Session like any other.
  - It gets a copy of your notes on the original, which from then on are its own.
  - Forking from your very first message isn't possible: start a new session instead.
- **End session** stops Claude cleanly after you confirm and closes its terminal window. You can
  resume the conversation later.
- A stale background session can be **removed** (`claude rm`).

### Several Claude accounts

Claude Code keeps its login, settings and history in one config folder: `~/.claude`, or the folder
`CLAUDE_CONFIG_DIR` names. Give each Claude account its own folder and you can use them side by
side, each logged in, with no logging out and in. Agentville then shows them all, and lets you
start, resume or move a session on the account you pick.

#### Setting up a second account

The examples call the accounts `work` (the `~/.claude` you have now) and `home` (a new
`~/.claude-home`). Use your own names.

1. **An alias for each account**, in `~/.zshrc` (or `~/.bashrc`):

   ```bash
   alias claude-work='env -u CLAUDE_CONFIG_DIR claude'              # ~/.claude
   alias claude-home='CLAUDE_CONFIG_DIR="$HOME/.claude-home" claude' # ~/.claude-home
   ```

   Then `source ~/.zshrc`. Plain `claude` stays on `~/.claude`.

2. **Share what both should have.** Before its first start, link your instructions, settings,
   skills and commands into the new folder, so both accounts work the same way (in a folder that
   already has them, move those aside first). The settings carry the Agentville mod
   (`CLAUDE_CODE_PLUGIN_DIRS`), so the new account's sessions can be answered from the dashboard
   and report their limits:

   ```bash
   mkdir -p ~/.claude-home
   for f in CLAUDE.md settings.json settings.local.json skills commands agents; do
     [ -e ~/.claude/$f ] && ln -s ~/.claude/$f ~/.claude-home/$f
   done
   ```

   Don't link `.claude.json` (it holds the folder's login and its MCP servers) or `plugins`
   (plugins your organization syncs belong to its account).

3. **Share the history, to move conversations between accounts.** Link the new account's
   `projects` and `file-history` folders to yours, before it has made either:

   ```bash
   ln -s ~/.claude/projects ~/.claude-home/projects
   ln -s ~/.claude/file-history ~/.claude-home/file-history
   ```

   Every account then sees every conversation (Claude Code's own `/resume` list and project memory
   too), a conversation can go on under another account with the same id, and ↺ Restore still
   finds its checkpoints. Skip this to keep the accounts' work fully apart: then a session resumes
   only on the account that ran it.

4. **Log in.** Run `claude-home`, type `/login` and sign in with the other account. `/status` shows
   which account a session is on. From now on, each alias opens on its own account, and both can
   run at once.

5. **MCP servers and plugins**, if you want them in the new account too, are added there:

   ```bash
   CLAUDE_CONFIG_DIR="$HOME/.claude-home" claude mcp add -s user <name> -- <command…>
   CLAUDE_CONFIG_DIR="$HOME/.claude-home" claude plugin install <plugin>@<marketplace>
   ```

6. **Name them in Agentville** (optional), in `config.json`:
   `"accounts": { "~/.claude": "work", "~/.claude-home": "home" }`. Without names, `~/.claude` is
   `main` and the others go by their suffix (`home`). Agentville finds a new `~/.claude-<name>`
   folder with a login in it within a minute, and `config.json` is read again when you save it:
   no restart needed. The top bar then shows a block for each account.

Use the same path every time: the login is kept in the macOS keychain under the folder's exact
path, so `~/.claude-home/` with a slash, or another way to reach the same folder, asks you to log
in again. The aliases are for terminals. The VS Code extension and the desktop app sign in on their
own.

#### Using several accounts

- **Which accounts.** `~/.claude` is the first. Every `~/.claude-<name>` folder with a login in it
  is another. `config.json`'s `accounts` can add any other folder.
- **What you see.** The top bar shows a plan block for each account, with its email and how many
  sessions it has open on hover, or "Signed out" (checked again each minute until you log in).
  Every agent carries its account's tag. The farm gives the second account a silo of its own, left
  of the barn (see [The farm](#the-farm)).
- **Starting.** ＋ Session, ⑂ Fork and Restart in… let you pick the account, each choice with how
  much of its limits it has used. A new session starts on the account its folder's last session
  ran on, a resumed one on the account it last ran on, and a fork on the original's.
- **Moving a conversation.** **Restart in… → Move to another account** ends a running session and
  resumes it on the other account, in the same mode and under the same id. In ＋ Session, pick the
  account and press **Resume** on a past one. This needs the shared history of step 3: without
  it, ＋ Session greys out **Resume** for the accounts that can't see the conversation.
- **The mod in each account.** Each account reads its own `settings.json`. If you didn't link it
  (step 2), add the mod's `CLAUDE_CODE_PLUGIN_DIRS` to it too (see
  [Load the mod](#3-load-the-mod-in-claude-code-recommended)). Without it, the account's sessions
  can't be answered from the dashboard and its plan never shows.
- **How it knows.** A running session is on the account whose `sessions/` folder lists it. An
  ended one is on the account it last ran on, which Agentville remembers. One it never saw running
  counts as the first account whose history holds it.
- **What stays on the first account.** The ⚙ Claude Code dialog (plugins, MCP servers and
  permission rules) shows the first account's. The ✨ Helper calls Haiku through whichever open
  session it picks, so it counts against that session's account.

### Going back to an earlier point (↺ Restore)

**↺ Restore** on one of your messages (beside **⑂ Fork**, when you point at it) puts the same
session back to just before that message, as `/rewind` (Esc Esc) does in its terminal. Fork starts a
new session and leaves this one alone; Restore takes this one back.

- You pick what to put back: **Conversation and code** (the default), **Conversation only** or
  **Code only**, and the permission mode it resumes in (its own to start with).
- A running session ends first (its window closes, as with End session). Then it resumes, as
  itself, in a new terminal window at that point, with your message back in its prompt box to change
  and send.
- The conversation: the messages from yours on are no longer part of it. They aren't deleted: they
  stay in its transcript file, as after `/rewind`. The dashboard shows **↺ Restored to before
  “…”** where it went back.
- The code: the files Claude changed with its edit tools since that message are put back as they
  were, from the snapshots Claude Code keeps before each edit.
  - Changes made by shell commands (`git`, `rm`, builds) or by you aren't undone.
  - Later changes to those files are lost, another session's included: on a checkout shared with
    another session, think first, or restore the conversation only.
  - If there were no edits to put back, the conversation is still restored, and the notice says so.
- Restoring to before your very first message isn't possible: start a new session instead.

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

- **Show in Finder** reveals the file, to open it in its own app. It never opens or runs it. (The
  world list's **Open the worlds folder** opens Finder the same way, on your worlds folder.)
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

### Worlds

A world is a way to draw what the dashboard knows. Two come built in: **the farm** (the default;
[The farm](#the-farm)) and **the robot factory** ([The robot factory](#the-robot-factory)). **World**,
in a world's **Menu** (top right), opens the list of worlds: pick one. A world that might draw no
buttons of its own — any world of yours, and a built-in one that draws itself — gets a small
control from the page in a corner instead: **World ▾** for the list of worlds and **☰ List** for
the list view, so it can't leave you with no way back. In the list view, the button beside **☰
List** carries the name of the world you will see, and the **▾** after it opens the list of worlds
there too, so a world that keeps sending you back to the list view can't keep you from choosing
another. Each world
keeps its own zoom and settings, and the choice is kept in this browser. If the world you chose has
gone, or has something wrong with it, when you open the dashboard, it opens on the farm instead and
forgets the choice. A world you are looking at that a save breaks (an invalid `world.json`, say)
keeps the choice: a panel says what is wrong at once, and saving it mended brings it back. **Open the worlds
folder** in the list makes your folder if it is not there yet and shows it in Finder.

**Privacy mode.** A world from your folder gets a scene without words or paths: agents' states,
tools and numbers, but no summaries, questions, replies, task, message or subagent text, branch
names, deploy or pull request words, or folder paths, and no names at all: repos, projects and
agents are numbers (`repo 1`, `project 1`, `agent 1`, the same one while the page is open). The
names that stay are Claude Code's own and your tools': tool names (an MCP tool's server name among
them), the MCP servers called, and subagent types. A session's name can be its conversation's title, folder, repo and project names can name clients or
work, and a world can reach a host it names, so a private world gets numbers only. Nor can such a
world ask for files. Each of your worlds in the list has a **Can see what agents say** box; ticking it (per
browser) restarts that world with the full scene. Tick it only for a world you trust: a world can
send what it sees to other sites (see [Privacy and security](#privacy-and-security)), as the box's
tooltip says. The box is greyed out for a second after the list opens, and until a second passes
with no click or key in the list, so a world that opens the list can't catch a click meant for
something else. Built-in worlds always see everything.

![The list of worlds](docs/worlds.png)

**Your own worlds:** `npm run new-world -- <name>` copies the starter world into your worlds folder
under that name and says what to do next (it refuses a taken or invalid name, and leaves nothing
half-made). By hand: a world is a folder holding `world.json` and `world.js`. Yours go in
`~/.agentville/worlds/<name>/` (the name is lowercase letters, digits and dashes, up to 40), or in
the folder `worldsDir` names.
Built-in worlds can't be replaced: a world of yours named like one is just another world, listed
after it. A world with a problem (a `world.json` that can't be read, one made for a newer
Agentville, a missing `world.js`) is listed with what is wrong. Files are served only from inside
the world's own folder, so a link out of it is never followed. A world's folder may itself be a link
(to a world you develop elsewhere): it is followed, and its target becomes the world's folder,
unless that folder is your worlds folder, your home folder or one above either, however the link is
spelled. A folder with no `world.json` of its own serves nothing, and a broken link is listed with
an error. `worldsDir` is read at startup (a change needs a restart); one that is your home folder or
above it is ignored and the default is used. A world's names are shown as plain text, whatever they
hold. How to write one is in [docs/worlds.md](docs/worlds.md), a guide written for Claude Code to
follow as much as for you: ask Claude to make you a world and point it there. A plain starter world
(`web/worlds/starter/`, with a cat; [a picture](docs/starter.png)) is the template for your own; it
isn't in the list. A world can have animals
of its own (the `animals()` hook, from a library of fourteen creatures), and lists in its `world.json`
the shapes it already uses for data (`taken`), so its animals never look like them.

**Try a world on the test page:** `http://localhost:7777/worlds/test?world=farm` (or `?world=factory`,
`?world=starter`, or `?world=u/<folder>` for one of yours). It shows the world playing a tour of
made-up snapshots, one stop for each thing a world may show (every state, deploys, a compaction, a collision, the
limits, night, privacy mode…), and `&stop=<name>` holds one stop at its own address, for a
screenshot. The page has no token and no real data: requests get made-up answers, what the world
asks the page to do is listed rather than done (but a GitHub link still opens, and motion is applied
too), and the world's settings are kept in memory, so the
dashboard's own settings in this browser (the world you chose, each world's settings, the **Can see
what agents say** switches) are never read or written. The stop decides privacy mode, for every
world. The error strip and the "didn't start" panel show here as on the dashboard. It doesn't reload
when you save: reload the page. The stops are
listed in [docs/worlds.md](docs/worlds.md#the-test-page-and-the-tour).

**A picture of every stop:** `npm run world-shots -- <name>` (or `farm`, `factory`, `starter`) opens each stop
of the tour in headless Chrome, on a server of its own with made-up data, and saves a picture of
each in `.private/shots/` (`--stop <name>` for one stop, `--dir <folder>` for another place). The
clock is frozen, so the same world gives the same pictures, which makes a change easy to compare.
`new-world`, `check-world` and `world-shots` all take `--worlds <dir>`, to use a folder other than
your worlds folder. If one of yours has a built-in world's name, `check-world` and `world-shots` use the
built-in and say so; `u/<name>` reaches yours.

**Check a world without a browser:** `npm run check-world -- <name>` (or `farm`, `factory`, `starter`) plays the
same tour headless, a few frames a stop, and lists each exception with its stop, file and line, a
hook that never returns (cut off after 2 seconds; it never hangs), a `world.json` problem, creatures
that break the animals kit's rules (a kind in `taken`, a line over 40 characters, fewer than 2 or more
than 4 actions…, and gags or play the kit would drop: a step or role it doesn't know, a spot the
world's `spots()` doesn't have), and, as pointers rather than verdicts, the hooks left
to their defaults, the checklist items it draws the same in two states ("deploy failed" draws the
same as "deploy ok"), and outfit parts the people kit doesn't have. It exits 1 on a problem. It needs no server or token and
reads none of your sessions: only the world's `world.js` and `world.json`, the SDK and the tour (and
`config.json`, for where your worlds are). What it reports, and the checklist, are in
[docs/worlds.md](docs/worlds.md#check-world-and-the-checklist). It runs the world's code on your Mac, contained (it can
read only the SDK and the world's `world.js` and `world.json`, no other file of the world's, and can't
write or start programs), but the world can still reach the network: check only worlds you'd trust
([Privacy and security](#privacy-and-security)). A world whose `world.js` or `world.json` is a link out
of its folder isn't run.

**Your own worlds, open while you write them.** Saving a file in a world's folder (or in a built-in
world's) reloads that world on screen, keeping its zoom and where you were looking, so you can
write one with it open. Where you were looking is kept only until you reload the page; nothing about
it is stored in the browser. The dashboard learns of the change from the collector, which watches
the worlds' folders and sends only a world's name, never its files. A world folder that is a link
isn't watched (the watcher doesn't follow links): reload the page to see an edit to it. If your
worlds folder doesn't exist yet, the collector looks for it again every few seconds.

#### The farm

The same live data, as a farm. It fills the window, and its controls sit around the edges like a
game's.

![The farm at night](docs/farm-night.png)

**The layout.** Along the top are the barn, the silo and your farmhouse, with **your porch** in
front of it: a modern farmstead, with a black barn with a glass door, a black steel silo and a
timber house with glass walls, its deck your porch. At night their glass glows from inside. Below them are the fields, one raised bed per repo, in a fenced grid that grows to 18
beds. While you look, a field keeps its bed: a new repo takes a free one (a worktree right after
its repo, a project's repo beside the others), and nothing else moves. A repo that goes away
leaves its bed empty, held for it for a day. An empty bed is fallow ground, a patch of darker
grass, so the fields in use stand out. When the page opens, the fields move up into free beds in
the order they had, so empty rows close up. The yard down the left holds the henhouse, the meadow,
the pond and the shade tree, and a forest surrounds the farm.

**Names and bubbles.** On the porch a farmer's tag is just its name, and neighbouring tags sit at
two heights so none covers another. A name that is too long is shortened in the middle
(`inventor…agement`); hover over it for the whole name. A farmer's speech bubble sits just over its
name. When two bubbles would cover each other, one moves up with a line down to its farmer. If
there is no room above, as on a busy porch at the top of a small window, it moves to the side
instead and its line slants across to the name. Bubbles stay inside the farm, and at 100% they
keep clear of the panel and the buttons too.

**Animals.** Two cows, two goats, a sheepdog (with a red bandana, so it is never taken for the
Explore dog), an ostrich, a lion, a tiger and a duck family (a mallard pair and three ducklings) live
on the farm just for fun. They never stand for anything.
- They wander the whole farm, graze and nap: the yard, the lanes and the porch, the meadow, around
  the scarecrows, the barn and the market. They never walk on a crop bed (its crops, hay, crates and
  mailbox are the repo's state), into a building, onto the row where the tool carts park, into the
  hammocks or the henhouse and its run (its hens are subagents). The ducks keep to the pond.
- Their lines wrap onto two lines when they need to, so a full 40-character line fits its bubble.
- At night most sleep; the lion wanders. With **Motion** off they doze where they are.
- Now and then one says something in a small cream bubble with a dotted edge. It never covers a
  farmer's bubble or name: it moves aside or waits.
- Click one (or the pond, for the ducks) for its menu: Pet, Feed, Ride, Throw a stick, Give a fish,
  Feed bread… The menu says who will go: the nearest farmer that isn't waiting on you (a farmer whose
  turn has ended stays on your porch too); click a colour dot to send another. That farmer walks over,
  does it, and walks back. One at work goes only if it can be there and back in a few seconds, and one
  that starts waiting on you drops it at once. With no one free, or Motion off, you do it yourself, at
  once, in place.
- Feeding the ducks brings the whole family paddling over, and the littlest duckling gets there first.
- Each has its habits: the goats climb the woodpile and the rock, the ostrich runs in circles and
  hides its head, the lion yawns and stretches, the tiger chases its tail and pounces, the sheepdog
  fetches, rolls over and runs laps. A trough with a bucket, a woodpile and a rock appear in the yard
  with them.
- Now and then (every minute or two) they get up to something. A goat steals an idle farmer's hat and
  is chased for it; one nibbles the hat of a farmer working in the meadow, who keeps working. The ostrich
  runs off wearing the trough's bucket. The lion is startled by a chicken, a cow naps in the empty
  hammock (and gets out when a farmer needs it), and the tiger plays tag with the sheepdog. Only idle
  farmers are ever borrowed, never one waiting on you or napping in a hammock; one that starts waiting,
  or gets work, drops it at once and gets its hat back, and one you send to an animal yourself leaves
  the gag for you.
- They react: a failed deploy (rain on a field) scatters them and the ostrich hides, a good one (a
  rainbow) makes them hop, a harvest draws a few over, and the sheepdog runs to the stall when a pull
  request is merged and to meet a new farmer.
- A farmer idle for three minutes or more sometimes plays with one: throws the sheepdog a stick, pets a
  goat, naps by the lion. Two at most.
- In winter they huddle together, the goats wear scarves and the ducks slide on the frozen pond. They
  follow the season you see, so a winter held with the **Season** switch brings the scarves too.
- With ✨ Helper's **Animal lines** ticked, they also say lines Haiku wrote for what is happening
  (a failed deploy, farmers waiting on you, a merge), each once, before their own ("✨ Helper and
  suggested names").
- The **Animals** switch hides them all (and brings back the pond's white duck); it is remembered.
  With it off, or **Motion** off, whatever they were up to stops where it is.

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
| The silo's grain / the season | Your plan's weekly usage / its 5-hour limit (winter when nearly used up), unless the **Season** switch holds one: then the panel's season has a 📌 and your real 5-hour use beside it. The tag at the silo's foot gives the week's figure, amber from 70% and red from 90% |
| A second silo, left of the barn | With two Claude accounts: each has its silo, its name on the tag. The season follows the first account |
| Eggs, hens in the run | Subagents that finished lately / more running than farmers can lead |

**Controls.**
- **Top left, the panel.** The money spent and harvests, then waiting on you, working, your turn
  and collisions (click one to open its first agent), then RAM, CPU and plan gauges (each account's
  week and 5 hours when you have several) and a
  **needs you** button. Click its title to fold it away. At 100% the farm sits beside the panel,
  or below it when that leaves it bigger, so the panel never covers a silo or a building. In a
  narrow window (the sidebar open) the farm is smaller then: **+** zooms in.
- **Top right, Menu.** One button holds every other control. **Dashboard:** List, World (the list
  of worlds), ＋ Session, ⚙ Claude Code, Sidebar, 📣 Broadcast and the theme. **On the farm:** Follow
  (keep the picked farmer in view), Resting (hide idle and stale farmers), Bubbles, Animals, Sky
  (live, day or night), Season (live, then spring, summer, autumn or winter held) and Motion. Then
  Bell, Help and zoom. A switch or zoom leaves the menu open, to change several; a button that takes
  you elsewhere shuts it, as do Esc and a click on the farm. Nothing lies along the farm's foot.
- **Mouse.** ⌘/Ctrl + scroll or a pinch zooms, drag moves around, and a minimap appears while you
  are zoomed in.

**Click things.** Click a farmer to open it in the sidebar (below), or a field for a close-up of
the files agents touched there. Click a farmer's speech bubble to read its whole conversation over the farm
(⤢ Read all, with search and a message box), the farmer picked in the sidebar behind it. A bubble
waiting on you (a question or a permission prompt), or asking a question you can answer with a
button, opens the sidebar instead, where you answer it. A bubble's tooltip says which: "click to read the whole conversation", or "click to open it in the sidebar".
A file you open from the farm, from its Files tab or a close-up, opens in a
dialog over the farm, with Quote and the reply box as in the list. Click a building for the rest:

| Building | Opens |
|---|---|
| Barn | Start or resume a session (the new farmer walks out of its door) |
| Farmhouse | Who is on your porch, with a button to open each |
| Silo | Your plan's usage and when each limit resets (each account's, when you have several) |
| Henhouse | The subagents and how each is going |
| Notice board | Each project's CLAUDE.md and memory |
| Market stall | The pull requests, with links |

**The sidebar.** **Sidebar** (top right) opens one panel beside the farm, on the farmer you picked
(or the first one at work). Top to bottom:
- **Who.** The agent's name: click it for every agent, those that need you first, then working,
  your turn, idle and stale, with what each asks or is doing. Type to find one by name, folder or
  branch; ↑ ↓ and ↩ pick, Esc closes. **‹ ›** step through them in that order, the book opens the
  diary and the last button hides the sidebar. Under the name: its state, its permission mode when it is
  Bypass or Plan, its account, and **Session**; then its folder, branch, model and effort.
- **Who else needs you.** A red line names the other agents waiting on you, longest waiting
  first, with **Next ›** to open that one. Below it, a card for each, answered without leaving the
  agent you are on: **Allow** or **Deny** a command, pick one of a question's options, **Yes** to a
  yes or no question. **No…**, **Reply…** and questions with several parts open that agent instead.
  The line folds the cards away, and that is remembered. Like every action button, a card's
  buttons ignore clicks for a moment after a world swaps or raises part of the page.
- **Its own question** or permission prompt, on every tab. It takes at most 40% of the sidebar's
  height (a long one scrolls inside, and keeps its place as the page updates), so the chat always
  has room. **Fold** shrinks it to one line that says what it asks, to read the whole chat before
  you answer; a click on the line shows it again, and a new question always comes unfolded.
- **Chat, Activity, Subagents, Files.** **Chat** has **Now** (the working line with ■ Stop, its
  step, and its commands, folded until you open them), the conversation with the newest message at
  the bottom, and one box with three modes. **⤢ Read the whole conversation** sits in a bar above
  the chat, outside what scrolls, so it is always in view (with **Show less** beside it after Show
  all). The chat
  always goes to the newest message: when it opens, and whenever a new one comes, even if you had
  scrolled up to read (with nothing new, it stays where you are). The three modes are
  **Message**, **Side question** and **Note**. **Activity** has a filter: All, Commands, Edits,
  Reads or Failed. **Subagents** has a card for each, and **Files** is its folder.
- **Session** opens its settings: the model and effort (switched after its current turn), the
  permission mode or account to restart it in, then Compact, Copy the resume command, the full
  transcript and Show it in the list view, with **End session** set apart at the bottom.
- **The diary** covers the tabs, with **Back** to the tab you were on.

The light follows your clock: cloud shadows by day, and lit windows, lanterns and fireflies at
night. The season follows your plan's 5-hour limit: spring while it is fresh (blossom), then summer,
autumn (falling leaves), and winter (snow, a frozen pond) when it is nearly used up. The **Season**
switch holds one instead: each click moves it on (live, spring, summer, autumn, winter, then live
again), and it is remembered, as the sky is. It only holds the look: while a season is held, the
panel shows it with a 📌 and your real 5-hour use (for example "winter 📌 · 5-hour 42%"), and its
tooltip says it is held, not live, and what the live season would be.

The farm pauses when its tab is hidden, or while the list shows (it is kept as it was, diary
and all, for when you come back), and follows the system's reduce-motion setting.

#### The robot factory

The same live data as a bright, friendly workshop: every agent is a robot and every repo an
assembly bay. Choose **Robot factory** in the list of worlds (**World**). Everything the dashboard
knows has its picture here, and the panel, buttons, sidebar, zoom and clicks work as in any built-in
world, in the factory's own words.

![The robot factory: every agent a robot, every repo an assembly bay](docs/factory.png)

**The layout.** Along the back wall, under tall windows that show the sky by your clock, stand
the fabricator, the drone dock, a thermometer, **your desk**, the manuals shelf, the power-cell bank
and the loading dock, with a walkway in front of them. Below are the bays, one per repo, inside a
yellow and black safety line on a tiled floor, three across and up to 18, each keeping its place
while you look (a repo that goes away leaves its bay empty for a day). A project's bays share a
painted floor zone with a sign. Down the left side are the storage shelf, the charging pads, the open
table, the sleep pods and the AGV rank. The conveyor runs along the bottom, and pneumatic tubes
overhead come down to every bay.

**The robots.** Each is put together from parts picked by its agent's id: a head (a dome, a box, a
round one with an antenna, or a screen face), a body in the agent's colour in the list, and a drive
(wheels, two legs or treads). The same agent is always the same robot. Codex agents are the
slate-grey model line.

**Reading the factory.** The **Help** button opens the full legend, including every tool a robot can
hold.

| You see | It means |
|---|---|
| A robot queued at the left of your desk, waving a red **!**, its beacon blinking red (and the red beacon over the desk) | It is waiting on you (a blueprint on the desk: a plan to approve) |
| A robot at the right of your desk with a crate of finished parts | Its turn ended (a **?** bubble: it asked you something) |
| A robot at a bay, holding a tool | It is working in that repo. The tool is its step: datapad = reading, scanner = searching, welder = editing, part printer = a new file, multimeter = tests, wrench = build, stamped crate = commit, cart up a ramp = push, rocket crate = deploy… |
| A robot being built on a bay's bench | The context filling: the frame, then the wiring (30%), the plating (50%), the head (70%), and its eyes light up when it is nearly full (85%) |
| **Built!**, and the finished robot rolling off on the conveyor | Its conversation was compacted, so a new frame goes on the bench |
| A gear spinning over its head / a checklist screen beside it | It is thinking between steps / its task list (its name says e.g. 3/7) |
| The beacon on its head | Green working, red blinking waiting on you, amber your turn, blue idle |
| The light on its antenna | Its model: purple Opus, blue Sonnet, green Haiku, orange Fable |
| Speed lines / hazard stripes round its waist / smoke | Fast mode / bypass permissions / a hot CPU |
| A badge on its chest | What it has cost: copper from $1, silver from $10, gold from $50 |
| Mini drones by a robot | Its subagents (a scanner drone sweeping a beam: an Explore one) |
| Drones docked in the drone dock / circling over it, with **+N** | Subagents that finished lately / more running than their robots can lead |
| A delivery drone flying out of a window and back | A web call (a fetch or a search), labelled with where it goes |
| AGVs in the rank on the left | One for each MCP server your agents called in the last hour. While a robot calls one, its AGV drives over with the server's name and waits beside it until the call is done, and a few seconds more |
| A capsule shooting through the tubes | One session messaging another |
| Loose parts on the floor / boxed parts / a capsule at the bay's tube outlet | Uncommitted files / unpushed commits / commits behind |
| The stack light: green with a **SHIPPED** flash / red with sparks / amber with turning gears / a grey pause | Last deploy passed / failed / running / Actions didn't run |
| Hazard tape round a bay, pulsing | Two agents writing to the same repo (faster when it's serious) |
| A blue flag on a bay's sign / a glass clean room | A branch other than main / a worktree, beside its repo's bay |
| A part printer humming by a bench | A background command still running |
| A robot asleep in a sleep pod | It will wake up by itself (`/loop`), with when |
| On a charging pad, eyes shut / powered down and grey on the storage shelf | Idle / stale |
| Crates on the loading dock, tagged by their checks | Open pull requests. **Shipped!** means one was merged: its crate rolls out of the door |
| The power-cell bank's cells | Your plan's weekly usage: they drain as the week is used; its lamp turns amber from 70% and blinks red from 90% |
| A second power-cell bank, left of the fabricator | With two Claude accounts: each has its bank, its name and week on the tag at its foot. The floor heat follows the first account |
| The floor heat | Your plan's 5-hour limit (below) |

**Floor heat and the Heat switch.** The floor heats up with your plan's 5-hour limit, on the
thermometer by your desk and in the floor vents between the bays: cool while it is fresh (blue, the
vents' fans turning slowly), then warm (the fans faster), hot (the fans racing, a shimmer over the
vents) and steaming (steam from the vents, sparks off the machines) when it is nearly used up; a new
window cools it again. The **Heat** switch, in the Menu (**On the floor**), holds a level
instead: each click moves it on (live, cool, warm, hot, steaming, then live again), and it is
remembered, as the sky is. It only holds the look: while a level is held, the panel shows it with a
📌 and your real 5-hour use (for example "steaming 📌 · 5-hour 42%"), and its tooltip says it is held,
not live. With no reading of your plan yet, the floor is warm.

**Day and night.** The windows show the sky by your clock. At night the lights dim, and the desk
lamp, the screens, the stack lights, the fabricator's glow and welding sparks glow.

**Animals.** A robot dog, a robot vacuum and a cat live in the factory just for fun. They never stand
for anything, and there are no drones among them (every drone here is data).
- The dog trots about the walkway and the left side and rests now and then by the chargers; it
  rolls over, runs to the loading dock when a pull request ships and to meet a new robot, and sleeps at
  night with its standby light on. The vacuum roams the walkway and the left side too. The cat naps on
  the conveyor and ambles along it. None of them goes into the bays, the queue at your desk or the AGV
  rank.
- Click one (or the belt, for the cat) for its menu: Pet, Oil or Fetch the dog; Pet or Empty the
  vacuum; Pet or Feed the cat. The nearest robot that isn't waiting on you rolls over and does it.
- Now and then the vacuum chases the cat off the belt, wedges itself in the storage shelf's corner and
  beeps until a robot frees it. A robot idle for three minutes or more sometimes plays fetch with the
  dog or pats the vacuum.
- With ✨ Helper's **Animal lines** ticked, they say lines Haiku wrote, in the factory's words (the
  robot dog and the vacuum need mod 0.9.1: "✨ Helper and suggested names").
- The **Animals** switch hides them; it is remembered.

**Controls and clicks.** The panel is top left (the money spent and the robots built, the floor
heat, the counts and meters, **needs you**; at 100% the factory sits beside it or below it). Top
right, the **Menu** holds every other control, as on the farm: the dashboard's buttons (List, World,
＋ Session, ⚙ Claude Code, Sidebar, 📣 Broadcast, the theme), then **On the floor**: Follow, Resting
(hide the robots charging and those powered down), Bubbles, Animals, Sky, Heat and Motion; then Bell,
Help and zoom. Nothing lies along the factory's foot. Click a robot to open it
in the sidebar, a bay (or its sign) for a close-up of the files agents touched there, a speech bubble
for its conversation, and a building for the rest:

| Building | Opens |
|---|---|
| Fabricator | Start or resume a session (the new robot rolls out of its door) |
| Your desk | Who is waiting on you, with a button to open each |
| Power-cell bank | Your plan's usage and when each limit resets (each account's, when you have several) |
| Drone dock | The subagents and how each is going |
| Manuals shelf | Each project's CLAUDE.md and memory |
| Loading dock | The pull requests, with links |

The factory pauses when its tab is hidden, or while the list shows, and follows the system's
reduce-motion setting.

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
- stops a turn when you press **■ Stop**;
- runs model and effort switches, and renames (`/rename`);
- answers side questions;
- asks Haiku for a session's name when the ✨ Helper is on;
- reports the session's cost, plan usage and working line.

## Configuration

`config.json` sits next to `config.example.json` and is re-read when you save it. A changed
`port` or `worldsDir` needs `agent-tracker restart`. Without a `config.json`, the defaults apply.

| Key | Meaning (default) |
|---|---|
| `port` | The dashboard's port (7777) |
| `pollMs`, `agentsCliPollMs`, `gitPollMs`, `deployPollMs`, `prPollMs` | How often each source is read: sessions (3 s), `claude agents` (30 s), git (10 s), deploys (60 s), pull requests (2 min) |
| `staleAfterHours` | Quiet this long and an agent is stale (24) |
| `collisionWindowMin` | How far back writes count towards a collision (30) |
| `permissionDashboardSec` | How long a permission prompt is offered on the dashboard before the terminal asks (15; 0 = terminal only) |
| `permissionGuessSec` | A tool call with no result for this long, with an idle process, counts as "probably a permission prompt" (20) |
| `memoryAlertGb`, `cpuAlertPct`, `cpuAlertSustainSec` | When an agent counts as running hot (2 GB; 90% for 120 s) |
| `notify` | Each notification on or off: `waiting`, `collision`, `yourTurn`, `memory`, `cpu` (on Windows `memory` and `cpu` start off) |
| `notifyMaxPerMin` | Most pop-ups raised in one minute; the rest become one "N more alerts" pop-up (0 = no limit; 3 on Windows, 0 on macOS) |
| `modToasts` | Toasts inside Claude Code sessions (on) |
| `deployRepos` | Checkout path → `owner/repo` whose latest GitHub Actions run is shown, e.g. `{ "/Users/you/code/api": "you/api" }` |
| `worldsDir` | Your own worlds, a folder each; `null` means `~/.agentville/worlds` (a leading `~` is your home; a relative one is under your home) |
| `terminal` | Where sessions open: `"Terminal"` or `"iTerm"` |
| `accounts` | Your Claude accounts' names, folder → name, e.g. `{ "~/.claude": "work", "~/.claude-home": "home" }`; a folder named here is an account even if it isn't a `~/.claude-*` folder ([Several Claude accounts](#several-claude-accounts)) |

## Commands

| Command | Does |
|---|---|
| `agent-tracker install` | Installs and starts the launchd service (it starts at login) |
| `agent-tracker uninstall` | Stops and removes the service |
| `agent-tracker start` / `stop` / `restart` | Starts, stops or restarts the collector |
| `agent-tracker status` | Whether the service runs and the dashboard answers |
| `agent-tracker open` | Opens the dashboard |
| `agent-tracker logs` | The last lines of its logs |
| `npm run new-world -- <name>` | Makes a world of your own from the starter, in your worlds folder, and says what to do next ([docs/worlds.md](docs/worlds.md#making-a-world)) |
| `npm run world-shots -- <world>` | A picture of a world (`farm`, `factory`, `starter` or one of yours) at every stop of the test tour, in headless Chrome on made-up data, in `.private/shots/` (`--stop <name>` for one stop). Exits 1 if a stop didn't show |
| `npm run check-world -- <world>` | Runs the test tour headless against a world (`farm`, `factory`, `starter` or one of yours): its exceptions with file and line, a hook that never returns, creatures (and their gags) that break the animals kit's rules, and pointers to what it may draw the same ([docs/worlds.md](docs/worlds.md#check-world-and-the-checklist)). Exits 1 on a problem. It runs the world's code contained (it can read only the SDK and the world's `world.js` and `world.json`), but the world can still reach the network: check only worlds you'd trust ([Privacy and security](#privacy-and-security)) |

## How it works

The **collector** (`collector/`) is a Node program run by launchd. Every few seconds it reads:
- `~/.claude/sessions/*.json`: the live session registry;
- `claude agents --json`: background sessions;
- the transcripts under `~/.claude/projects/` (only the new bytes of each). When a session moves
  into a worktree, Claude Code moves its transcript to the worktree's folder, and the collector
  follows it there;
- with several Claude accounts, the same for each account's folder (`~/.claude-<name>`): its
  `sessions/` with `claude agents --json` run in its `CLAUDE_CONFIG_DIR`, and its `projects/`
  unless it is a link to one already read. Every minute it looks for accounts again, and it asks
  `claude auth status` whether each is signed in;
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
for that session's mod. The mod picks it up and does it inside the session. A fork needs no mod:
Claude Code resumes a copy of the transcript cut at the message as a new session (`--resume <copy>
--fork-session`), and a message of yours goes in its prompt box (`--prefill`). Nor does a restore:
once the session has ended, Claude Code puts its files back (`--rewind-files`), the collector adds
the line `/rewind` writes to the end of its transcript, and the session is resumed. A stop cancels the
running turn through Claude Code's plugin API, and the mod then writes the same
`[Request interrupted by user]` line Esc leaves in the conversation.

The **dashboard** (`web/`) is plain HTML and JavaScript, served by the collector. The farm is a
canvas, with its text drawn as HTML on top so it stays crisp. It is a world (`web/worlds/farm/`):
it runs in a sandboxed frame of its own, and the page (`web/worlds.js`) hands it the scene, a plain
account of what the dashboard shows, built from each snapshot (`web/scene.js`). What a world gets
and can do is in [docs/worlds.md](docs/worlds.md).

## Privacy and security

- Everything stays on your Mac. The collector listens on `127.0.0.1` only and sends nothing
  anywhere. The exception is `gh`, which asks GitHub about your own repos.
- The dashboard's own page and its API tell the browser never to show them inside a frame
  (`frame-ancestors 'none'`), so no other page, and no world, can load the dashboard with its token
  inside itself.
- The farm (like any world) runs in a sandboxed frame with no cookies, storage or token, and can't
  fetch, post or upload anything. It sees the scene, which is what the dashboard shows, and can only ask the page for the
  few things listed in [docs/worlds.md](docs/worlds.md), each checked against the scene: open an
  agent or one of its files, read an agent's or a repo's files (the page fetches them with the
  token), keep its own settings, press the top bar's buttons. Links from it open only to GitHub.
  The page takes each of those at most once a quarter second and four reads at a time, and keeps at
  most 64 settings (64 KB) for a world, so a misbehaving world can't flood the dashboard or fill your
  browser's storage. While the list view shows, a world can't make the page do anything.
- Your worlds' files are served without the token, like the farm's, to anything on this Mac that
  asks for them by path (so keep nothing secret in a world's folder), and never from outside the
  world's own folder. The list of their names and the folder's path needs the token. The collector
  reads the folder; it never fetches a world from anywhere.
- The world test page (`/worlds/test`) is served without the token and holds none: its snapshots
  and answers are made up in the page, it never asks the collector for your sessions or files (its
  content policy lets it fetch nothing at all), and it keeps a world's settings in memory, never in
  the browser. Like the dashboard, it refuses to be shown in a frame.
- `npm run check-world` runs a world's code on your Mac, on made-up snapshots, outside the sandboxed
  frame. It runs it contained, in a Node of its own (Node's permission model): it can read only the
  SDK and the world's `world.js` and `world.json` (no other file of the world's, so a link the world
  ships in its folder leads nowhere), can't write or start programs, and gets none of your
  environment, nor your terminal: what it prints, the world's words among it, is printed without
  control characters (as `world-shots` prints a world's), so a world can't steer your terminal. A
  world whose `world.js` or `world.json` is itself a link out of its folder is refused before
  anything runs. It can still reach the network, and Node's containment is a seat belt rather than a
  sandbox, so check only worlds you'd trust; look at any other world on the test page, in its frame.
  A Node too old to contain it (before 22.13, or 23.0 to 23.4) gets a one-line refusal, never an
  unconfined run.
- **Open the worlds folder** (an action: token and same origin) makes your worlds folder and shows
  it in Finder (`open -a Finder <folder>`); it only shows it, and runs nothing in it. The page keeps your
  choice of world in this browser (`tracker-world`), and nothing else about it leaves the page.
- **The threat model.** The sandbox protects your token and every action — a world can never act
  for you — but not the secrecy of what a world is shown. A world can't read the page, use its
  token, fetch, post or upload anything, make a frame load another page, or move the dashboard's
  page. But browsers let any page signal another machine in ways the page can't fully close, so a
  world can get out what it is shown:
  - **A connection hint to a host it names.** A world can make the browser reach out to a host of
    its choosing (a connection hint such as `preconnect`, or `dns-prefetch`), repeatedly and unseen.
    No request of yours goes with it, but the host name (looked up in DNS) and the choice of host
    carry what the world sees. This can't be closed from the page.
  - **WebRTC**, which reaches another machine directly and no CSP stops. The frame switches WebRTC
    off in the world's own page, which stops the straightforward use; a determined world can still
    get round it, so this is narrowed, not closed.
  - **Leaving its frame.** A frame can always load another page in its own place (setting its
    `location`). What can't be stopped is that one leaving request, whose address can carry whatever
    the world put in it, once. After that there is nothing: page-to-frame traffic rides a private
    channel (a `MessageChannel`) whose end lives in the frame's own page, so when a world navigates
    away that page — and the channel — is gone, and the page it lands on gets no scene and is not
    heard. The dashboard usually catches the leave and says so (the frame's `beforeunload` /
    `pagehide`, or its loading a second time); a world that erases those and keeps the new page from
    finishing its load can avoid the notice, but not the cut-off.

  So a world from your folder could get out what a private scene holds (its states, tools and
  numbers), and a world you let see what agents say could get out the words too. A test world in
  `scripts/e2e-ui.mjs` tries every way out in a real browser.
- **Add only worlds you trust.** Your worlds see no conversation text or paths until you tick **Can
  see what agents say** for one (kept per browser, as `tracker-world-cansee:<world>`); then they see
  what the dashboard shows. Tick it only for a world whose author you'd trust with the words. A
  world can never act for you: it can't answer, approve, message, start or stop anything. The most
  it can do is open a dialog, a file or a GitHub link for you to see, press one of the top bar's
  buttons, or switch the bell. And it can't move your click onto one of those: when a world's message
  changes or raises part of the page (swaps the sidebar's agent, opens a dialog or the reader), that
  area's action buttons ignore clicks for about a second — re-armed while you keep moving — so a world
  can't swap another agent's Allow (or a dialog) under a click you meant for what you were reading.
  They look quietly dimmed meanwhile. A way out is never held: closing or cancelling a dialog, the
  page's corner over a world, **☰ List**, the view toggle and its **▾**.
  The farm and other built-in worlds always see everything.
- File contents, folder listings, past sessions, whole conversations (and your messages in them,
  for ↑) and field close-ups are served only with a per-install token that the page carries. Every action (answer, message,
  start, end, switch…) also needs a same-origin request.
- The explorer shows what git shows. Ignored files (`node_modules`, `.env`, build output) and
  files that look like secrets (`.env*`, keys) are neither listed nor served.
- **■ Stop** on the working line goes through the session's own mod, as Esc would: no signal is
  sent to anything. **■ Stop** under Commands running only ever stops a session's shell commands,
  never the session itself, its MCP servers or anything else: the collector checks again in `ps`, then sends SIGTERM to the command's
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
- With several Claude accounts, `state/session-accounts.json` keeps which account folder each
  session last ran on (the 2,000 most recent). Your accounts' emails are read from their
  `.claude.json` and kept in the local snapshot (`state/state.json`, which the mod reads) to show on
  your own page; a world gets each account's name and plan, never
  its email (a private world gets `account 1`, `account 2`). Agentville never reads or touches the
  logins themselves: it starts `claude` with the account's `CLAUDE_CONFIG_DIR`, and asks
  `claude auth status` whether each is signed in.
- Messages waiting for a session's turn to end are kept under `state/held/` (the folder and its
  files readable only by you). Nothing in them reaches the session until one goes out, and the
  snapshot the page reads says only how many are waiting; the text is read with the token.
- Your notes on a session are kept under `state/notes/` (the folder and its files readable only by
  you) until you delete them. They never leave your Mac, and nothing in one reaches the session
  until you use or send it. The snapshot the page reads every few seconds carries only how many
  there are; the text is read with the token when the section shows.
- The ✨ Helper is off by default. Switched on, it calls Haiku only through `$.model.complete` in
  your own sessions' Claude Code, never with a key of its own. A request file carries no
  prompt (the mod's instruction for each job is fixed), and for a name the session sends its own
  first messages itself: the collector and the page see only the name. For animal lines the
  collector sends the facts listed in "✨ Helper and suggested names" (names, states, a step word,
  counts, events, the kinds of animal on screen, and `farm` or `factory` for those built-in worlds;
  never paths, commands, branches or conversation text), and the page reports which animals a world
  has (kinds and names; only the kinds reach Haiku) and, for the farm or the factory only, its key. The lines come back as plain text of 40 characters at
  most; a world of yours that can't see what agents say gets only those with no names, by the names
  it was sent (an agent gone since, or one renamed, too) and the names on the dashboard now. Its setting (with today's
  count) and what you chose for each session's name (renamed, edited, dismissed) are kept in
  `state/helper.json` and `state/names.json`, readable only by you. No world is told the helper's setting, a suggested name or a pending offer: a world gets only the fields in the scene (see [docs/worlds.md](docs/worlds.md)).
- **↺ Restore** is the one thing that writes to Claude Code's own files. Once the session has ended,
  it adds one line to the end of its transcript (the line `/rewind` writes; nothing is removed), and
  with code, Claude Code itself puts files back from its snapshots. Your message for the prompt box
  goes under `state/forks/`, as a fork's does.
- **⑂ Fork** only reads the session's transcript. The copy cut at your message, and the message for
  the new prompt box, are written under `state/forks/`, readable only by you, and removed after an
  hour. Claude Code makes the new session from the copy.
- The ⚙ Claude Code dialog runs `claude plugin …` and `claude mcp …` for you, and removing a rule
  edits that one entry in its settings file. A server's full command line or URL is never shown,
  as either can carry a key: only its host or the command it runs.

## Troubleshooting

| Problem | Try |
|---|---|
| The dashboard doesn't load | `agent-tracker status`, then `agent-tracker logs`. Check that nothing else uses the port |
| A message waits and never goes out | It goes out when the session's turn ends, through its mod: the mod must be listening (📡 dashboard answers on). Press **⚡ Send now** to send it at once. A red line on the list says when the session didn't take it; it is tried again when the session next moves |
| A session shows "dashboard answers off" | Its mod isn't loaded. Check `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (or, for another account, in that account's own `settings.json`), then type anything in the session or `/reload-plugins` |
| An account shows "No reading yet" | Its sessions report their limits through the mod: load the mod in that account too, then send a session on it a message |
| "runs an older tracker mod" | `/reload-plugins` in that session, or resume it |
| An idle farmer walks off to the animals, or has no hat | It is playing (idle three minutes or more) or a goat has its hat; it is the farm's fun, not the session. It comes back the moment it gets work or needs you. Switch **Animals** off to stop it all |
| **■ Stop** on the working line, or **✕ Cancel** on a question, is greyed out | Both need mod 0.7.0: `/reload-plugins` in that session. Until then, press Esc in its terminal |
| No cost, plan usage or working line | These come from the mod (0.4.0 or newer; the working line from 0.5.0) in a running session |
| An account shows "Signed out" | Start a session on it (its alias, or ＋ Session with that account) and run `/login` there |
| An account is missing | Its folder needs a login (`.claude.json` with your account) and must sit next to `~/.claude` as `~/.claude-<name>`, or be named in `config.json`'s `accounts` |
| **Resume** is greyed out for an account | That account doesn't share the session's history: link its `projects` and `file-history` folders ([Several Claude accounts](#several-claude-accounts)) |
| A second account asks you to log in again | Its folder is spelled differently from when you logged in (a trailing slash, or a link to it): use the same path every time |
| My world shows no bubbles and calls its repos `repo 1`, `repo 2`… (and its agents `agent 1`…) | It is in privacy mode: tick **Can see what agents say** for it in the list of worlds. Unticking later doesn't clear what the world saved while it could see; it gets its own saved settings back on start |
| No pull requests or deploy weather | `gh auth status`. Pull requests need a GitHub `origin`; Actions runs need the repo in `deployRepos` |
| ＋ Session or End session does nothing | Allow the tracker to control Terminal or iTerm: System Settings → Privacy & Security → Automation |
| **Browse…** or **📁 Folder** opens no window | Allow the tracker to control System Events: System Settings → Privacy & Security → Automation. A window may also be open behind others: pick or cancel it there |
| ↺ Restore says its files could not be restored | Claude Code's file snapshots may be off (`/config` → file checkpointing, or `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`). The session was resumed as it was; restore the conversation only |
| The bell is silent | Click the page once (browsers block sound until you do), and allow notifications |
| A world says it "didn't start" | A world has 5 seconds to start. Past that, a panel replaces the (empty) world and gives the first error it reported, if any. For a world you'd trust, run `npm run check-world -- <name>`: it names the file and line (it runs the world contained, reading only the SDK and the world's `world.js` and `world.json`, but the world can still reach the network; see [Privacy and security](#privacy-and-security)). Fix its `world.js` (or `world.json`) and save: it reloads by itself. Or press **Back to the farm**, **Show the list**, or **Try again** |
| A world "tried to leave the page and was stopped" | A world may only draw in its own frame; this one tried to go to another page (a link, `location`). The page stops it the moment it starts to leave. Fix the world and save: it reloads by itself. Or press **Back to the farm** or **Show the list** |
| My world looks wrong in one situation | Open the test page at that stop: `http://localhost:7777/worlds/test?world=u/<folder>&stop=…` (the stops are listed in [docs/worlds.md](docs/worlds.md#the-test-page-and-the-tour)). It has no live reload: reload the page after saving. Or take a picture of that stop: `npm run world-shots -- <folder> --stop …` |
| A red strip over a world | The world reported an error after it started. It keeps drawing; **×** hides the strip. The page's console has the same message |
| The farm stays empty, or says "not found" | The farm loads in a frame of its own from the collector (`/world/farm/`). After an update, restart the service (`agent-tracker restart`) and reload the page. The page's console says what a world reported, if anything |
| The animals never say anything new | Tick **Animal lines** in ✨ Helper (the helper on). A session with mod 0.9.0 must be open (0.9.1 for the robot dog and the robot vacuum; `/reload-plugins` in it), and a world with animals on screen. ✨ Helper shows the last error and today's count |
| **✨** says no name came, or the ✨ Helper shows a last error | No session is listening with mod 0.8.0 (`/reload-plugins` in it), today's limit is reached (it resets at midnight), or your organisation doesn't allow Haiku (the error says so) |

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
- **⑂ Fork** puts your message in the new prompt box with Claude Code's `--prefill` option, which its
  help doesn't list. If a Claude Code update drops it, the fork still opens, with an empty box.
- Codex sessions can't be forked or restored from the dashboard.
- **↺ Restore** uses Claude Code's `--rewind-files` and `--prefill` options, which its help doesn't
  list, and writes the line `/rewind` writes (as of Claude Code 2.1.295). A Claude Code update could
  change them.
- In a very long session, restoring to a message from far back restores the session, but the
  dashboard's conversation may still show the later messages.

## Development

```
collector/   the collector: sources/, transcript/, derive/, server.mjs; its tests in test/
web/         the dashboard: index.html, app.js, panels.js, scene.js, worlds.js…; worlds/ holds the
             farm (worlds/farm/), the robot factory (worlds/factory/), the starter (worlds/starter/),
             the test page and its tour (worlds/test/) and what every world's frame loads (worlds/sdk/)
mod/         the Claude Code mod: hooks/register.tsx; its tests in tests/
bin/         the agent-tracker command and the launchd entry point
launchd/     the service definition
scripts/     end-to-end checks, the world tools (new-world, check-world, world-shots) and the demo
             videos (their shared recorder in scripts/demo/)
docs/        screenshots, and worlds.md: the guide to making a world, and what a world gets and can do
```

```bash
npm test                    # collector and dashboard (node:test)
npm run test:ui             # the dashboard, the farm and other worlds in headless Chrome, on a fixture
                            # (a probe world among them tries every way out of its frame)
npm run kit-sheet           # redraw docs/kits.png, the picture of the people and props kits
npm run world-shots -- <world>  # a picture of a world at every stop of its test tour (.private/shots/)
npm run check-world -- <world>  # the test tour run headless against a world: exceptions, loops, creatures, pointers
claude plugin test mod      # the Claude Code mod
scripts/e2e-answer.sh       # answering and messaging real sessions
npm start                   # run the collector in the foreground (stop the service first)
npm run demo [out.mp4]      # record the demo video, made-up sessions only (Chrome, ffmpeg; ~8 min),
                            # a copy under 10 MB for GitHub (out-small.mp4), and one short video per
                            # chapter in out-chapters/ (01-the-farm.mp4, …);
                            # it follows docs/demo-script.md; STILLS=docs STILLS_ONLY=1 remakes the farm pictures
npm run demo:many [out.mp4] # a short video of sixteen made-up sessions: their terminal windows, then the
                            # farm (~80 s, and a copy under 10 MB)
```

GitHub Actions runs `npm test` and `npm run test:ui` on every push to `main` and on pull requests.
The mod's tests need Claude Code, and `scripts/e2e-answer.sh` needs real sessions, so those two run
locally.

## License

MIT
