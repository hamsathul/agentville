# Agentville on Windows

Agentville runs on Windows 10/11 as well as macOS. It picks the platform by itself (`process.platform`) and checks its
dependencies before it starts. This page says how to install it, step by step, and, honestly, what differs and what has and
has not been checked on a real Windows PC.

## Install

Every command here is for **PowerShell** (Start → type *PowerShell*); none needs an administrator. `bin\agent-tracker.cmd` works
from cmd.exe as well. It runs its PowerShell script with a one-time `-ExecutionPolicy Bypass`, so you don't need to change
PowerShell's execution policy.

### 1. What you need first

- **Windows 10 or 11**, with Windows PowerShell 5.1 (it ships with Windows).
- **Node.js 22 or newer.**
- **Git**, to get the code (the explorer also uses it for each repository's status).
- **Claude Code**, signed in (run `claude` once). The dashboard starts without it and shows your sessions, but cannot start,
  resume or fork one, and the ✨ Helper is off. The mod needs a build with plugin mods; it is tested on 2.1.293.
- Optional: the **GitHub CLI** `gh` (pull requests, deploy badges) and **Windows Terminal** (sessions open in a tab; without
  it they open in a plain console window; Windows 11 has it already).

With winget (part of Windows 11 and of an up-to-date Windows 10):

```powershell
winget install OpenJS.NodeJS.LTS            # Node.js
winget install Git.Git                      # Git
irm https://claude.ai/install.ps1 | iex     # Claude Code (Anthropic's installer; or: winget install Anthropic.ClaudeCode)
winget install GitHub.cli                   # optional
winget install Microsoft.WindowsTerminal    # optional; Windows 11 has it
```

Then **open a new PowerShell window**, so it sees the new PATH, and check: `node --version` (v22 or later), `git --version`,
`claude --version`.

Claude Code's own installer puts `claude.exe` in `%USERPROFILE%\.local\bin`; npm's install (`claude.cmd`) and winget's work
too. Agentville looks for it on your PATH. If it is somewhere else, give its full path: `setx TRACKER_CLAUDE_BIN <full path>`,
then a new window (and `bin\agent-tracker.cmd restart` once the service is installed).

### 2. Get the code

Clone it **under your user folder**, for example `C:\Users\you\tools\agentville`. A folder made elsewhere (`C:\tools`) lets
every other person who signs in to the PC change its files, and `bin\run-collector.ps1` runs at your logon. The check in the
next step warns when Agentville is outside your user folder. There is nothing to build and no `npm install`.

```powershell
git clone https://github.com/hamsathul/agentville.git $env:USERPROFILE\tools\agentville
cd $env:USERPROFILE\tools\agentville
```

### 3. Check

```powershell
node collector\index.mjs --check
```

It names anything missing, each with the feature lost without it and the fix, and exits 1 if a required thing is missing.
Required are Node 22+ and Windows PowerShell 5+. Optional are Claude Code (it runs `claude --version`), Windows Terminal,
git, gh and Claude's own folder; it also says whether Agentville is in your user folder. A check that cannot run counts as
missing; it is never reported as fine. A normal start runs the same check, writes any warning to `logs\collector.log`, and
refuses to start only when a required thing is missing.

The same check feeds the **System** entry in the dashboard header: the operating system and its version, the Node version and
the Claude Code version. A part that could not be read is left out, never guessed.

### 4. Start the service

`bin\agent-tracker.cmd` is the Windows twin of the `agent-tracker` command. `install` registers a per-user scheduled task named
**Agentville**, which runs at logon at normal rights (no elevation) and starts now; nothing is installed system-wide.

```powershell
bin\agent-tracker.cmd install     # registers the task and starts it (install -DryRun prints what it would register)
bin\agent-tracker.cmd status      # "task Agentville: state = Running" and "http ok on :7777"
bin\agent-tracker.cmd open        # opens http://localhost:7777
```

The dashboard already shows your sessions, their activity and their repos. The other commands are `start`, `stop`,
`restart`, `logs` and `uninstall`.

The task runs `bin\run-collector.ps1`, which finds Node, adds the folders claude, git and gh usually live in (your
`.local\bin`, npm's folder, Git's and the GitHub CLI's) to the **end** of PATH, and runs the collector. The collector writes
its own log, `logs\collector.log`; what Node prints (the start-up report, a crash) goes to `logs\task.log`. `logs` shows the
end of both.

To try it without the task, run it in a window instead: `node collector\index.mjs` (Ctrl+C stops it), or
`node collector\index.mjs --exit-after 60` for a run that ends itself after 60 seconds.

### 5. Load the mod in Claude Code (recommended)

The mod lets the dashboard answer, message and steer a session. It also reports the session's cost, plan usage and working
line. Claude Code's settings file is `%USERPROFILE%\.claude\settings.json` (`notepad $env:USERPROFILE\.claude\settings.json`;
create it if it isn't there). Add the `mod` folder of your clone. JSON needs a backslash doubled, so write the path with `/`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/you/tools/agentville/mod" } }
```

If the file already has an `"env"`, add the `"CLAUDE_CODE_PLUGIN_DIRS"` line inside it. In the clone folder,
`(Resolve-Path mod).Path -replace '\\', '/'` prints the path to paste.

New sessions load it. In a session that is already running, type `/reload-plugins`. A session with the mod shows
**📡 dashboard answers on** on the dashboard, and `/tracker` opens its pane. On Windows the mod needs 0.9.2 or newer.

### 6. Optional: pull requests, deploys and settings

- `gh auth login` once: the dashboard then shows open pull requests (with their checks) for every repo whose `origin` is on
  GitHub, and the latest GitHub Actions run for the repos you list in `deployRepos`.
- `copy config.example.json config.json`, then edit it; it is re-read when you save it. The settings are in the README's
  [Configuration](../README.md#configuration).

### First run

- **Notifications** show as Windows toasts, sent through Windows PowerShell. If none appear, turn on notifications for
  **Windows PowerShell** in Settings → System → Notifications, and check Do not disturb (Focus assist on Windows 10). The
  page's bell asks the browser separately, the first time you switch it on.
- **＋ Session**, Resume and Fork open a Windows Terminal tab (or a console window without it) running `claude` in the folder
  you chose.

### Update and uninstall

```powershell
cd $env:USERPROFILE\tools\agentville; git pull; bin\agent-tracker.cmd restart   # update; then /reload-plugins in open sessions
bin\agent-tracker.cmd uninstall                                                   # remove the task
```

To remove it completely, also delete the `CLAUDE_CODE_PLUGIN_DIRS` entry from `%USERPROFILE%\.claude\settings.json` and the
clone folder.

### If it doesn't work

| Problem | Try |
| --- | --- |
| `status` says "http not answering" | `bin\agent-tracker.cmd logs`: the end of `logs\collector.log` and `logs\task.log`. A required thing missing is named there, with the fix (also `node collector\index.mjs --check`) |
| `status` says "service not registered" | `bin\agent-tracker.cmd install` (run from the clone folder) |
| ＋ Session, Resume or Fork fails, and the log says Claude Code was not found | The task looks on your PATH, then in `.local\bin`, npm's folder, Git's and the GitHub CLI's. Elsewhere: `setx TRACKER_CLAUDE_BIN <its full path>`, then `bin\agent-tracker.cmd restart` |
| The collector won't start, and its log says "failed to start" with an `icacls` error (or "could not make … private") | Its folder is on a drive without access lists (FAT, exFAT, some network drives), where the token can't be kept private. Move Agentville under your user folder on the system drive |
| `--check` says Agentville is outside your user folder | Others who sign in to the PC may be able to change its files, and `bin\run-collector.ps1` runs at your logon: move it under `C:\Users\<you>` |
| Answers from the dashboard do nothing in a session | The mod needs 0.9.2 there: `/reload-plugins` in that session |
| A notification never shows | Notifications for Windows PowerShell are off, or Do not disturb is on (see First run) |

## How the mod works on Windows

The mod claims requests with `cmd.exe /c move`, removes files with `cmd.exe /c del` (only files, never a folder) and opens the
browser with `cmd.exe /c start`. It hands them paths with backslashes (cmd's own commands read a `/` inside a word as a
switch), refuses any path that cmd.exe would read as syntax or as a separator (`& | < > ^ % ! " , ; =`), and opens only a
`http://localhost` address. It waits for a dashboard answer with a small Windows PowerShell loop that stops at a set time, the
paths in its environment and never in its text; the loop is a program of its own, because a wait inside the hook would count
against the hook's 10 seconds. cmd.exe and PowerShell are named by their full path in System32, and run in the mod's own
folder. `collector/test/mod-wait.test.mjs` runs the wait, the move and the delete for real on Windows CI. This needs mod
0.9.2 (`/reload-plugins` in a session that is already open).

## What differs from macOS

| | macOS | Windows |
| --- | --- | --- |
| Service | launchd | Scheduled Task at logon |
| Notifications | `osascript` | a toast through the Windows runtime API (no module to install) |
| Folder picker | Finder's window | the Windows folder dialog |
| New/resume/fork session | Terminal.app or iTerm | Windows Terminal tab, else a console window |
| Ending a session | SIGTERM, then closes its window by tty | ends the process at once; the window is not closed for you (there is no tty) |
| Stopping a shell command | its process group | its whole process tree, once |
| Word files | `textutil` | read in JavaScript: `.docx`, `.odt`, `.rtf` |
| Presentations, Pages, Keynote | first-page picture (Quick Look) | **not available** |
| Old `.doc` | `textutil` | **not available** (open it in Word or save as `.docx`) |
| Files kept private | mode 0600/0700 | an owner-only ACL set with `icacls` (checked after) |
| Pickable folders | home and `/Volumes` | home and the *other* drives (not the system drive) |
| Finding a program | PATH | PATH only: never the working folder (see below) |
| Showing a file in the file manager | any name | not a name with a comma (Explorer splits its command line at commas) |

## How programs are found

Windows looks for a program named without a folder in the working folder first, and a session's folder is any repository: a
`git.exe` or `claude.exe` in one would run when the dashboard runs git there. So the collector finds every program it runs on
PATH, never in the working folder and never through a relative PATH entry, and does not run one it cannot find there.

npm installs `claude` as `claude.cmd`, a script Node will not start by itself. The collector and the launcher read what it
points at and start that directly (Node and Claude Code's `cli.js`), so no argument ever passes through cmd.exe. Any other
`.cmd` still goes through cmd.exe, and an argument holding anything cmd.exe reads as syntax is refused.

## How a session is started (no shell text)

On a Mac the dashboard pastes a shell line into Terminal. On Windows the folder, the arguments and the prefill file go into a
JSON file in an owner-only folder (`state\launch`), and a small Node program (`collector/platform/launch-claude.mjs`) starts
`claude`, named by its full path, with an argument list. Only the paths of Node, the launcher and that file are ever on a
command line, so nothing a session holds can become a command. (Windows PowerShell 5.1 mangles arguments handed to a program,
which is why the launcher is Node.) The launcher deletes the file when it reads it.

With more than one Claude account, the file may also carry `CLAUDE_CONFIG_DIR`: a folder to set, or `null` to remove it for the
first account. It is the only variable a launch file can change; the launcher refuses anything else.

## Private files

The `state` folder is made owner-only at every start, before the token is made in it: what is in it answers permission prompts
and sends messages to sessions. Owner-only means one entry for you and no inherited ones, set with `icacls` and read back; your
account is granted first, so a step that fails never locks you out. A token found that is not owner-only is made so again at
every start. On a drive without ACLs (FAT, exFAT, some network drives) this cannot be done, and the collector refuses to start
there rather than leave the token readable.

## Tests

`npm test` runs the whole suite. On Windows some tests are **skipped, with the reason printed**: creating a *file* symlink
needs Developer Mode or administrator rights, so the tests that prove a link to a file is refused do not run on a normal
account. Links to folders are tested as junctions. Tests never open a terminal window: the real opener refuses under `node --test`.

Text files are checked out with LF on every system (`.gitattributes`): Git for Windows would otherwise write CRLF, and a test that
reads the guide would see a different file than it does on a Mac.

CI runs the suite on `windows-latest` as well as on macOS. The mod's own tests cannot start a program, so
`collector/test/mod-wait.test.mjs` takes its wait scripts from `mod/hooks/os.ts` and runs this system's one for real.

## Not checked

- Nobody has followed the install steps above on a fresh PC yet. Claude Code's install command is the one in its own setup
  guide (2026-10-12).
- On a Mac the merged code passes `npm test`, `npm run test:ui` and `claude plugin test mod`, and runs as the login service
  (since 2026-10-12).
- The folder dialog, the terminal launcher on screen, `install` and the scheduled task were not run on a real PC; they are
  covered by tests that stand in for the system, plus the real parser for the PowerShell scripts. The task's script
  (`run-collector.ps1`) and `logs` run for real on Windows CI, with a stand-in collector.
- The mod has been tested in Claude Code's plugin test harness (`claude plugin test mod`), not inside a live session.
- The CPU figure is the share of one core between two reads, so the first read after start shows 0.
- A name with a double quote passed to `claude --name` is passed intact by the launcher, but is untested against `claude.exe` itself.
