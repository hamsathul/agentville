# Agentville on Windows

Agentville runs on Windows 10/11 as well as macOS. It picks the platform by itself (`process.platform`) and checks its
dependencies before it starts. This page says how to run it, and, honestly, what differs and what has and has not been
checked on a real Windows PC.

## Requirements

- **Windows 10 or 11**, with Windows PowerShell 5.1 (it ships with Windows).
- **Node.js 22 or newer.**
- **Claude Code**: the native install (`claude.exe`, in `%USERPROFILE%\.local\bin`) or npm's (`claude.cmd`), on your PATH,
  or `TRACKER_CLAUDE_BIN` set to its full path. The dashboard starts without it and shows your sessions, but cannot start,
  resume or fork one, and the helper is off.
- Optional: **Git** (repository status in the explorer), the **GitHub CLI** `gh` (pull requests, deploy badges),
  **Windows Terminal** (sessions open in a tab; without it they open in a plain console window).

## Get the code

Clone it **under your user folder**, for example `C:\Users\you\tools\agentville`. A folder made elsewhere (`C:\tools`) lets
every other person who signs in to the PC change its files, and `bin\run-collector.ps1` runs at your logon; the check below
warns when Agentville is outside your user folder.

```powershell
git clone https://github.com/hamsathul/agentville.git $env:USERPROFILE\tools\agentville
cd $env:USERPROFILE\tools\agentville
```

## Check, then run

```powershell
node collector\index.mjs --check      # names anything missing, with the fix; exits 1 if a required thing is missing
node collector\index.mjs              # starts the dashboard on http://localhost:7777; refuses only if a required thing is missing
node collector\index.mjs --exit-after 60   # a throwaway run that ends itself after 60 seconds
```

`--check` looks at what is required (Node 22+ and Windows PowerShell 5+) and what is optional, each with the feature lost
without it: Claude Code (it runs `claude --version`), Windows Terminal, git, gh, Claude's own folder, and whether Agentville
is in your user folder. A check that cannot run counts as missing; it is never reported as fine. A normal start runs the same
check, writes any warning to `logs\collector.log`, and refuses to start only when a required thing is missing.

The same check feeds the **System** entry in the dashboard header: the operating system and its version, the Node version and
the Claude Code version. A part that could not be read is left out, never guessed.

## Start at login (optional)

`bin\agent-tracker.cmd` is the Windows twin of the `agent-tracker` command. `install` registers a per-user scheduled task named
**Agentville**, which runs at logon at normal rights (no elevation); nothing is installed system-wide.

```powershell
bin\agent-tracker.cmd install -DryRun    # prints what it would register, registers nothing
bin\agent-tracker.cmd install            # registers the task and starts it
bin\agent-tracker.cmd status | open | logs | start | stop | restart | uninstall
```

The task runs `bin\run-collector.ps1`, which finds Node, adds the folders claude, git and gh usually live in (your
`.local\bin`, npm's folder, Git's and the GitHub CLI's) to the **end** of PATH, and runs the collector.

## The Claude Code mod

Add the `mod` folder the same way as on a Mac, with your own path (either slash works):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/you/tools/agentville/mod" } }
```

On Windows the mod claims requests with `cmd.exe /c move`, removes files with `cmd.exe /c del` (only files, never a folder)
and opens the browser with `cmd.exe /c start`. It refuses any path that cmd.exe would read as syntax or as a separator
(`& | < > ^ % ! " , ; =`), and it opens only a `http://localhost` address. It waits for a dashboard answer with a small
Windows PowerShell loop, the paths in its environment and never in its text; the loop is a program of its own, because a wait
inside the hook would count against the hook's 10 seconds. Every program the mod starts runs in the mod's own folder.

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

- On a Mac the merged code passes `npm test`, `npm run test:ui` and `claude plugin test mod` (2026-10-12); it has not been run
  as the login service on a Mac yet.
- The folder dialog, the terminal launcher on screen and `install` were not run for real; they are covered by tests that stand in for the system, plus the real parser for the PowerShell scripts.
- The mod has been tested in Claude Code's plugin test harness (`claude plugin test mod`), not inside a live session.
- The CPU figure is the share of one core between two reads, so the first read after start shows 0.
- A name with a double quote passed to `claude --name` is passed intact by the launcher, but is untested against `claude.exe` itself.
