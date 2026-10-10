# Agentville on Windows

Agentville runs on Windows 10/11 as well as macOS. It picks the platform by itself (`process.platform`) and checks its
dependencies before it starts. This page says how to run it, and, honestly, what differs and what has and has not been
checked on a real Windows PC.

## Requirements

- **Windows 10 or 11**, with Windows PowerShell 5.1 (it ships with Windows).
- **Node.js 22 or newer.**
- **Claude Code**, with `claude` on your PATH (or `TRACKER_CLAUDE_BIN` set to its full path).
- Optional: **Git** (repository status in the explorer), the **GitHub CLI** `gh` (pull requests, deploy badges),
  **Windows Terminal** (sessions open in a tab; without it they open in a plain console window).

## Check, then run

```powershell
node collector\index.mjs --check      # names anything missing, with the fix; exits 1 if a required thing is missing
node collector\index.mjs              # starts the dashboard on http://localhost:7777; refuses to start if --check would fail
node collector\index.mjs --exit-after 60   # a throwaway run that ends itself after 60 seconds
```

`--check` looks at: Node 22+, Claude Code (runs `claude --version`), PowerShell 5+, and (optional) Windows Terminal, git, gh,

The same check feeds the **System** entry in the dashboard header: the operating system and its version, the Node version and
the Claude Code version. A part that could not be read is left out, never guessed.
and Claude's own folder. A check that cannot run counts as missing; it is never reported as fine.

## Start at login (optional)

`bin\agent-tracker.cmd` is the Windows twin of the `agent-tracker` command. `install` registers a per-user scheduled task named
**Agentville**, which runs at logon at normal rights (no elevation); nothing is installed system-wide.

```powershell
bin\agent-tracker.cmd install -DryRun    # prints what it would register, registers nothing
bin\agent-tracker.cmd install            # registers the task and starts it
bin\agent-tracker.cmd status | open | logs | start | stop | restart | uninstall
```

## The Claude Code mod

Add the `mod` folder the same way as on a Mac, with your own path (either slash works):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/you/tools/agentville/mod" } }
```

On Windows the mod claims requests with `cmd.exe /c move`, removes files with `cmd.exe /c del` and opens the browser with
`cmd.exe /c start`. It refuses any path that cmd.exe would read as syntax (`& | < > ^ % ! "`), and it opens only a
`http://localhost` address. Waiting for a dashboard answer is polling, not a shell loop.

## What differs from macOS

| | macOS | Windows |
| --- | --- | --- |
| Service | launchd | Scheduled Task at logon |
| Notifications | `osascript` | a toast through the Windows runtime API (no module to install) |
| Folder picker | Finder's window | the Windows folder dialog |
| New/resume/fork session | Terminal.app or iTerm | Windows Terminal tab, else a console window |
| Ending a session | SIGTERM, then closes its window by tty | ends the process at once; the window is not closed for you (there is no tty) |
| Stopping a shell command | its process group | its whole process tree |
| Word files | `textutil` | read in JavaScript: `.docx`, `.odt`, `.rtf` |
| Presentations, Pages, Keynote | first-page picture (Quick Look) | **not available** |
| Old `.doc` | `textutil` | **not available** (open it in Word or save as `.docx`) |
| Files kept private | mode 0600/0700 | an owner-only ACL set with `icacls` (checked after) |
| Pickable folders | home and `/Volumes` | home and the *other* drives (not the system drive) |

## How a session is started (no shell text)

On a Mac the dashboard pastes a shell line into Terminal. On Windows the folder, the arguments and the prefill file go into a
JSON file in an owner-only folder, and a small Node program (`collector/platform/launch-claude.mjs`) starts `claude` with an
argument list. Only the paths of Node, the launcher and that file are ever on a command line, so nothing a session holds can
become a command. (Windows PowerShell 5.1 mangles arguments handed to a program, which is why the launcher is Node.)

With more than one Claude account, the file may also carry `CLAUDE_CONFIG_DIR`: a folder to set, or `null` to remove it for the
first account. It is the only variable a launch file can change; the launcher refuses anything else.

## Tests

`npm test` runs the whole suite. On Windows some tests are **skipped, with the reason printed**: creating a *file* symlink
needs Developer Mode or administrator rights, so the tests that prove a link to a file is refused do not run on a normal
account. Links to folders are tested as junctions. Tests never open a terminal window: the real opener refuses under `node --test`.

Text files are checked out with LF on every system (`.gitattributes`): Git for Windows would otherwise write CRLF, and a test that
reads the guide would see a different file than it does on a Mac.

## Not checked

- Nothing here has been run on a Mac since the Windows work; the Mac code paths are covered only by the existing tests.
- The folder dialog, the terminal launcher on screen and `install` were not run for real; they are covered by tests that stand in for the system, plus the real parser for the PowerShell scripts.
- The mod has been tested in Claude Code's plugin test harness (`claude plugin test mod`), not inside a live session.
- The CPU figure is the share of one core between two reads, so the first read after start shows 0.
- A name with a double quote passed to `claude --name` is passed intact by the launcher, but is untested against `claude.exe` itself.
