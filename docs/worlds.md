# Worlds

A world is a way to draw what the dashboard knows. The farm is the first one. This page is the
reference for what a world gets from the dashboard and what it can do.

## What a world is

Each world runs in a sandboxed frame of its own, loaded from `/world/<key>/`. The frame has no token,
no cookies and no storage, and can't fetch, post or upload anything (see "What a world can't do", and
"The gaps" for what a frame can still do that the page can't fully close). It sees only the **scene**
(below), which the page builds from
each snapshot, and it reaches the page only through the **messages** below. The page checks every
message, and drops anything else.

A world is a folder holding `world.json` and `world.js`, and any files they use (pictures, sounds,
fonts, stylesheets), with `preview.png`, if you like, for the list of worlds. The collector serves
those files from inside the folder only, and only these kinds: `.js`, `.json`, `.css`, `.png`,
`.gif`, `.webp`, `.svg`, `.woff2`, `.mp3`, `.ogg` and `.wav`. The frame's page
(`web/worlds/sdk/frame.html`) loads, in order: `/base.css` (the dashboard's colours), the world
engine's styles (`/world/sdk/engine.css`), the bridge (`/world/sdk/bridge.js`), the brand mark
(`/brand.js`), the pixel kit (`/world/sdk/pixel.js`), the engine (`/world/sdk/engine.js`), then the
world's `world.js`. A world doesn't choose these: the frame always loads all of them. The world draws
into `<div id="farm">`, which fills the frame.

Keys: a built-in world is named by its folder in `web/worlds/` (the farm is `farm`). Names match
`^[a-z0-9][a-z0-9-]{0,39}$`, and `sdk`, `starter`, `test` and `u` are reserved. Your own worlds are
`u/<name>`; see below.

## Where worlds live

- **Built in:** `web/worlds/<name>/` in the install. The farm is first in the list, the other
  built-in worlds follow A to Z. They can't be replaced.
- **Yours:** `~/.agentville/worlds/<name>/`, or the folder `worldsDir` names in `config.json` (a
  leading `~` is your home). The folder name matches the rule above (lowercase letters, digits and
  dashes, up to 40, starting with a letter or digit). Yours are listed after the built-in ones, A to
  Z, and are served under `/world/u/<name>/`. A world of yours named `farm` is `u/farm`: it never
  replaces the farm.

The collector lists every world at `GET /api/worlds` (token only), with the folder it reads yours
from. Files of a world are served from inside its own folder only: `..`, hidden names and links
pointing out of the folder are refused with a plain 404, for yours as for the built-in ones. They
are served without the token, like the farm's, to anything on this Mac that asks for them by path,
so keep nothing secret in a world's folder.

A world's folder may itself be a link (a world you develop elsewhere): it is followed, and its
target becomes the world's folder, and must hold a `world.json` of its own (a folder without one
is listed as "world.json is missing." and serves nothing). A link to your worlds folder, to your
home folder, or to any folder above either (`/`, `/System/Volumes/Data` and so on) is refused
("This folder is a link to a folder that holds other things; link to the world's own folder."),
however the link is spelled: it is judged by which folder it is (device and inode), not by its
name, so capitals and firmlinks don't get around it. A broken link or a link loop is listed ("This
folder is a link to something that isn't there.") without hiding the other worlds. The folder's
name must match exactly: on a disk that ignores capitals, `Space` is not `u/space`.

`worldsDir` is read when the collector starts. A leading `~` is your home folder, a relative one
is under it (one that would land outside it, such as `../x`, is ignored), and an empty one means the
default. A `worldsDir` that is your home folder or above it (or `/`) is ignored too: the default
`~/.agentville/worlds` is used, and the collector's log says why.
A folder that has no name the rule allows is listed with an error and can't run. A world with any
error has no frame.

## world.json

The farm's:

```json
{
  "name": "Farm",
  "icon": "🌾",
  "description": "Every agent a farmer, every repo a field",
  "api": 1,
  "nouns": { "agent": "farmer", "agents": "farmers", "repo": "field", "repos": "fields", "start": "barn", "diary": "Farm diary" },
  "taken": ["chicken", "dog", "pigeon"]
}
```

| Field | Meaning |
|---|---|
| `name` | The world's name: in the list of worlds, on the view button, and as the frame's title |
| `icon` | One emoji, beside the name in the list and on the view button (`preview.png` in the folder, if there, takes its place in the list) |
| `description` | One line saying what the world shows, in the list |
| `api` | The version of this page the world was written for: `1` |
| `nouns` | What the world calls things: an agent and agents, a repo and repos, where a new session starts (`start`), and its diary (`diary`). The page uses `diary` as the title of the world's diary in its sidebar ("Diary" without one); the others are kept for the page's words to match, and an engine world gives its own to the engine (the `nouns` hook) |
| `taken` | The shapes this world already uses for data, as creature kinds: its animals may not take them (see "Creatures"). The farm's chickens are subagents, its dog is an Explore subagent and its pigeons carry mail, so its fun animals are never a chicken, a dog or a pigeon |

The page reads `world.json` through the same checks as any other file of the world: a link pointing
out of the folder is never followed (it counts as missing).

The rules, as checked (the first that fails is the error the list shows):

- The file is at most 64 KB ("world.json is too large (over 64 KB).").
- `name`: a string of 1 to 40 characters, not blank. A longer one is an error.
- `icon` (optional): a string of at most 8 characters, one emoji. Without one (or an empty one), 🧩.
- `description` (optional): a string of at most 140 characters. A longer one is an error (the list
  still shows the name and description, cut short to 40 and 140 characters).
- `api`: a whole number, 1 or more, and no more than the version this Agentville has (1).
- `nouns` (optional): an object; only `agent`, `agents`, `repo`, `repos`, `start` and `diary` are
  kept, each a string of at most 30 characters. Other keys are dropped.
- `taken` (optional): a list of at most 16 kind names, each lowercase letters, digits and dashes,
  starting with a letter (up to 24 characters).

What a world can show in the list instead of running:

| Error | Meaning |
|---|---|
| `world.json is missing.` | No `world.json` in the folder, or it is a link out of it (such a folder serves no files) |
| `world.json can't be read: …` | It isn't valid JSON |
| `world.json is not a JSON object.` | It is JSON, but not `{ … }` |
| `world.json needs a "name", up to 40 characters.` | `name` is missing, blank, not a string or too long |
| `world.json: "icon" is one emoji.` | `icon` isn't a string of up to 8 characters |
| `world.json: "description" is up to 140 characters.` | `description` isn't a string of up to 140 characters |
| `world.json needs "api": 1.` | `api` is missing or not a whole number of 1 or more |
| `This world needs a newer Agentville (…)` | `api` is higher than this Agentville knows |
| `world.json: "nouns" are short words.` | `nouns` isn't an object of strings up to 30 characters |
| `world.json: "taken" is a list of up to 16 short kind names (…)` | `taken` isn't a list of up to 16 kind names |
| `world.json is too large (over 64 KB).` | The file is bigger than 64 KB |
| `world.js is missing (or is a link out of the folder).` | No `world.js`, or it points outside the folder |
| `This folder is a link to something that isn't there.` | A broken link or a link loop |
| `This folder is a link to a folder that holds other things; link to the world's own folder.` | The link points at your worlds folder, above it or at your home folder |
| `A world's folder name is lowercase letters, digits and dashes (up to 40).` | The folder's name breaks the rule |

A world with a problem still has its name, icon and description shown if they are fine; it just
doesn't run.

## The scene (version 1)

The page builds the scene from each snapshot (`web/scene.js`) and sends it to the frame. It holds
plain facts only: states, tools, context, deploys, the plan's limits. Each world turns them into its
own pictures (the farm into hats, crops and weather).

```
{ version: 1, generatedAt, private: false,
  plan: { windows: [{ kind, pct, resetsAt, reset }], fiveHour: window|null, weekly: window|null } | null,
  chrome: { counts, asking, agents, oldestWaiting, subagentsRunning, ram, cpu, collector, errors },
  subagents: [{ id, label, type, state, parent, startedAt }],
  subagentCounts: { done, overflow },
  mail: [{ from, to, at, text }],
  mcp: [{ server, busy }],
  repos: [{ key, name, branch, onMain, dirty, ahead, behind, deploy, collision, worktree, main, project, projectName, prs }],
  agents: [{ id, name, kind, cwd, state, repo, tool, summary, step, contextPct, hot, ask, askKind, question, reply, said,
             colorIndex, color, cost, mode, kids, tasks, compactions, thinking, turn, effort, model, family, fast, planAsk,
             service, jobs, wakeAt, nap }] }
```

Times are milliseconds since 1970, as `Date.now()` gives them.

**The whole scene**

- `version`: `1`, the version this page describes.
- `generatedAt`: when the collector took the snapshot.
- `private`: `false` for the farm and any world you have allowed to see what agents say; `true` for one of
  your worlds that may not (see "Privacy mode": most words and all paths are removed).
- `plan`: the plan's usage limits, from the mod; `null` without a reading. `windows` lists every
  window: `kind` (`five_hour`, `seven_day`, …), `pct` (0–100 used; 0 once it has reset), `resetsAt`
  (when it resets, or `null`) and `reset` (it has reset since it was read). `fiveHour` and `weekly`
  are two of them by name, or `null`.
- `chrome`: what the dashboard's top bar and count cards say, for a world that draws its own panel
  (the farm fills the window, so it does). `counts`: agents per state (`waiting`, `working`,
  `yourTurn`, `idle`, `stale`) and `collisions`. `asking`: agents that asked you something. `agents`:
  how many agents. `oldestWaiting`: since when the longest-waiting agent waits, or `null`.
  `subagentsRunning`: agents with a subagent running. `ram`: `{ usedMb, totalMb }` (the agents' memory
  and the Mac's). `cpu`: `{ used, cores }` (the agents' CPU, in percent of one core, and the Mac's
  cores). `collector`: the tracker's own `{ pid, cpu, rssMb, claudeVersion }`. `errors`: sources that
  are failing, as short lines.
- `subagents`: every subagent: its `id`, `label` (its task), `type` (`Explore`…), `state` (`running`,
  `done`, `failed`…), `parent` (its agent's name) and `startedAt`.
- `subagentCounts`: `done` is how many subagents finished lately (up to 6); `overflow` is how many run
  beyond the four an agent leads.
- `mail`: messages one agent sent another in the last 3 minutes, oldest first: `from` and `to` (agent
  ids), `at` and `text`.
- `mcp`: the MCP servers agents called in the last hour (up to six, by name): `server`, and `busy`,
  the id of the agent calling it now, or `null`.

**Each repo** (`repos`)

- `key`: its folder, which is also its id (in a private scene: a stand-in, `r1`, `r2`…). `name`: the folder's name (private: `repo 1`…).
- `branch`: the branch it is on, or `null`; `onMain`: that branch is `main` or `master`.
- `dirty`: uncommitted files; `ahead` and `behind`: commits against its upstream.
- `deploy`: its last deploy, or `null`. From the collector: `{ state, label, detail, url, source }`,
  with `state` `running`, `ok`, `failed` or `blocked`, and its words. From a bare GitHub Actions run:
  `{ state: 'running' | 'ok' | 'failed' | 'other', label: null, detail: null, url, source: 'actions', run: true }`.
- `collision`: two agents writing in it at once: `'high'` (one of them used git), `'normal'`, or `null`.
- `worktree`: it is a git worktree; `main`: the folder of the repo it belongs to, or `null`.
- `project`: an id for grouping repos that sit side by side in one folder (that folder's path; in a private scene a stand-in, `p1`, `p2`…), or
  `null`; `projectName`: its label.
- `prs`: its pull requests, from `gh`, or `null`: `{ open: [{ number, title, url, draft, branch, checks }], merged: [{ number, title, url, at }] }`,
  with `checks` `ok`, `failed`, `running` or `null`.

**Each agent** (`agents`)

- `id`, `name` (private: `agent 1`…); `kind`: `interactive`, `background`, `codex`…; `cwd`: its folder, or `null`.
- `state`: `waiting` (on you: a question or a permission), `working`, `turn` (its turn ended),
  `idle` or `stale`.
- `repo`: the repo it works in (its newest write, else its newest touch, else the repo holding its
  folder): a repo's `key`, or `null`.
- `tool`: the tool it is calling now, or its last one; `summary`: what that call does, in a few words;
  `step`: the kind of work it is (`edit`, `read`, `search`, `test`, `build`, `commit`, `push`,
  `deploy`, `web`, `mcp`…), or `null`.
- `contextPct`: the share of its context window used, 0–1, on a 1M window once past 200k tokens.
- `hot`: its CPU is over the alert setting (`cpuAlertPct`, 90% by default).
- `ask`: the text of what it asks you, when waiting; `askKind`: `question`, `permission`, `always`
  or `null`; `planAsk`: it is a plan waiting for your approval.
- `question`: a question it ended its turn with, or `null`. `reply`: the first line of its last reply.
  `said`: its last reply as one plain line, up to 160 characters, for a speech bubble.
- `colorIndex` and `color`: its colour (one of eight, by its id, never by its place in the list), as
  the dashboard shows it.
- `cost`: what the session has cost so far in US dollars, or `null`. `mode`: its permission mode
  (`default`, `plan`, `acceptEdits`, `bypassPermissions`…), or `null`.
- `kids`: its running subagents, up to four: `{ id, dog }`, `dog: true` for an Explore one.
- `tasks`: its task list, `{ done, total, current?, items }`, or `null`. `compactions`: how many times
  its context was compacted.
- `thinking`: it is thinking now (from the mod's working line; without the mod, a guess: working with
  no tool call open). `turn`: while working, `{ startedAt, outTokens?, word?, mode? }` (the working
  line's word and mode), else `null`. `effort`: its effort setting, or `null`.
- `model`: its model's name, or `null`; `family`: `opus`, `sonnet`, `haiku`, `fable` or `null`;
  `fast`: fast mode is on.
- `service`: where a web or connector call goes (`Gmail`, `github.com`…), or `null`.
- `jobs`: background commands running.
- `wakeAt`: when it wakes up by itself, or `null`; `nap`: it is a session that will wake up by
  itself (`/loop`), resting until then.

## Privacy mode

A world from your folder (`u/<name>`) gets a private scene (`scene.private` is `true`) until you tick
**Can see what agents say** for it in the list of worlds (kept per browser, as
`tracker-world-cansee:u/<name>`, a name no world's `store` can reach). Built-in worlds always get the
whole scene (`private: false`). What a private scene removes or replaces:

- Agents: `name` is `agent N`, a number kept for that agent (by its `id`) while the page is open, so
  it doesn't change as agents come and go (a session's own name can be its title, which Claude Code
  makes from the conversation, and its folder can name a client). `subagents[].parent` is the
  parent's `agent N`. `summary`, `ask`, `reply` and
  `said` are `''`; `question`, `cwd` and `service` (a web host) are `null`; `tasks` is
  `{ done, total }`; `turn` is `{ word, startedAt, outTokens, mode }`; `repo` is a stand-in.
- Repos: `key` and `main` are stand-ins (`r1`, `r2`, … the same for the same repo while the page is
  open) and `name` is `repo N` to match (`r3` is `repo 3`); `project` is a stand-in (`p1`, …) and
  `projectName` is `project N` to match (`null` when there is no project); `branch` is `null` (`onMain` stays);
  `deploy` is `{ state, label: null, detail: null, url: null, source: null }` (and `run`, if there);
  `prs` is `{ open: [{ number, checks, draft }], merged: [{ number, at }] }`.
- `subagents[].label` and `mail[].text` are `''`; `chrome.errors` is `[]`.

Why numbers and no names: a world can reach a host it names (see "The gaps"), so what a private
scene holds could leave the machine. A session's name can be its conversation's title, and folder,
repo and project names can name clients or work, so none of them is in it. What stays: states, tools (including MCP server names in `tool` and `mcp`), steps, subagent
types, colours, counts, percentages, costs, the plan's windows and the repos' numbers. Requests
(`agentFiles`, `repoTouched`) are refused: the reply has `ok: false`, `status: 403` and an `error`
that says to switch on "Can see what agents say". `openDoc` is dropped; `pick` still works. Because
the repo keys are stand-ins, `repoTouched` could not name a real repo anyway. Ticking the box starts
the world again with the full scene; unticking starts it again private, but doesn't clear what the
world saved while it could see (it gets its own saved settings back on start). The box is greyed out
when the list opens, until a second passes with no tap or key in the list, and a change before then
is undone: a world can open the list (`nav: 'worlds'`) but not catch a click on the box.

## Messages

Every message is an object with a `type`. Each side checks the other's: the frame takes messages
from the page only, and the page from its current frame only.

All of it rides a private channel. When the frame says `loaded`, the page makes a `MessageChannel` and
hands one end to the bridge, inside `start` (the bridge listens first and stops the page's messages
there, so a world's own `message` listener never sees `start` or the port); from then on every
message both ways — `scene`,
`settings`, `select`, `reply`, and every frame-to-page message, `leaving` included — goes over that
port, and the page ignores any window message from the frame. The port lives only in the frame's realm,
so when a world navigates its frame away that realm dies with it: the page's scenes go into a dead port,
and a page the world lands on gets none of them and is not heard (see "When a world breaks" and "The
gaps").

**From the page to the frame**

| Message | What it is |
|---|---|
| `start { world, prefs, settings }` | Each time the frame loads, after it says `loaded`: the world's key, its saved settings (`{ name: value }`, strings) and the page's settings |
| `settings { settings }` | The page's settings, when they change (they are looked at every second): `{ still, theme, nav: { theme, side, live }, bell }`. `still`: stand still (reduced motion, or the world's own Motion switch). `theme`: `auto`, `light` or `dark`; the bridge sets it on the frame, so `base.css`'s colours follow the dashboard. `nav`: the state of the top bar's buttons (`live`: connected to the collector). `bell`: the page's bell is on |
| `scene { scene }` | Every snapshot, as the scene above (none while the page shows its list view). Until the world has drawn once after `start`, the bridge keeps only the newest and hands it over then |
| `select { id }` | The agent shown in the page's sidebar, or `null` |
| `reply { id, ok, status, data?, error? }` | The answer to a `request`: `{ ok: true, status, data }`; `{ ok: false, status, error }` for an error from the collector (its own words, if any); `status: 0` with the reason when the request itself failed; `status: 403` with why when the page refused it |

**From the frame to the page**

| Message | What the page does |
|---|---|
| `loaded { raw? }` | The world has registered: the page sends `start`, then the newest scene and the selection. `raw: true` (the bridge adds it for a world registered with `Agentville.raw`, not by the engine) is one of two things the page weighs for the corner control — see "Give a way back". The page builds a new frame for every load, and takes `loaded` once from each: an extra one is dropped, `raw` and all. Replies to an earlier frame's requests are not posted to the new one, and the paths they named are forgotten |
| `ready` | The world has started: the page stops waiting for it (see "When a world breaks") |
| `leaving` | Sent by the bridge itself (`beforeunload` / `pagehide`, captured at load through the page it first saw): the document is going away. The page stops the world at once, with a panel |
| `error { message, where }` | Shows it (300 and 120 characters at most): before `ready`, in the panel that replaces a world that doesn't start; after it, in a strip over the world. Also written to the page's console, each once (50 at most) |
| `pick { agentId, from? }` | Opens that agent in the sidebar. The id must be one of the scene's (any other is dropped). `from: 'say'` when it was picked by its speech bubble: then the page opens its whole conversation over the world instead, unless it waits on you or asks something answered with a button (that is done in the sidebar) |
| `openDoc { agentId, path }` | Opens the file in a reader over the world. Only a path in that agent's folder, in a repo of the scene, or one a reply to `agentFiles` named for that same agent; never one with `..`; 4096 characters at most |
| `openLink { url }` | Opens it in a new tab. Only `https://github.com/` links, 2048 characters at most |
| `startSession` | Opens Start or resume a session |
| `showRepos` | Shows the repos in the list view |
| `nav { what }` | Presses one of the top bar's buttons: `list`, `session`, `setup`, `side` or `theme` (`worlds` opens the list of worlds) |
| `bell { on }` | Turns the page's bell on or off (`on` must be `true` or `false`) |
| `motion { still }` | The world stood still, or moves again (`true` or `false`); the page keeps it for `settings` |
| `diary { entries }` | Shows the world's diary in the sidebar: at most 20 entries `{ at, state, who, text }`, in the order given (the farm puts the newest first), with `state` one of the agents' states and `at` a time. `who` is cut to 80 characters and `text` to 300, and both are shown as text, never as HTML. One bad entry drops the whole message. Drawn at most every quarter second: the newest entries are drawn when their turn comes |
| `store { key, value }` | Saves one of the world's settings in the page's storage, as `tracker-world:<world>:<key>`. Names match `^[a-z][a-z0-9-]{0,31}$`; values are strings of 16384 characters at most. A world keeps at most 64 settings, 64 KB in all (names and values, what it saved before included): a `store` past either is refused (the page says so once, in its console). `migrated` is the page's own |
| `request { id, kind, agentId? \| repo? }` | Reads one of two things with the token and answers with `reply`: `agentFiles` (an agent's files and memory; `agentId` must be in the scene) or `repoTouched` (the files agents touched in a repo; `repo` must be a repo's `key` in the scene). At most four are answered at a time, counting any still running for a frame this one replaced: a fifth is refused at once (the bridge keeps a world under that: see below). One the collector hasn't answered in 30 seconds is cut off (`status: 0`). One that can't be done is refused, and still answered |

The page takes each action (`pick`, `openDoc`, `openLink`, `startSession`, `showRepos`, `nav`,
`bell`, `motion`) at most once a quarter second: the first at once, the rest dropped, so a world can't
open a flood of dialogs, files or chimes. `bell` and `motion` are settings, so the newest of those is
taken when its turn comes instead, and the page and the world agree.
A world that is out of sight (the page is showing its list view, the frame kept loaded) can do none of them: those messages are dropped until it is shown again. `store`, `diary` and `request` still work.

The frame stays loaded while the dashboard shows its list: it is hidden (Chrome draws nothing in it
meanwhile), and a world keeps all it remembers. It gets no scenes while hidden, and the newest one when
it shows again.

### When a world breaks

A world that breaks never traps the person using it: the page puts a panel in its place, or a strip
over it. A world that runs has a way back too: see "Give a way back", below.

- **It must start within 5 seconds of its frame being built.** Starting means `ready`: call
  `Agentville.world(...)` or `Agentville.raw(...)` as `world.js` loads. A `world.js` that throws first,
  a missing file, a `world.json` that is briefly invalid mid-save (the frame loads a 404), or one that
  never registers: after 5 s the frame is replaced by a panel (`role="alert"`) saying
  "<name> didn't start" and the first error the bridge caught, if any (the first is the cause; what
  follows is usually fallout). Its buttons: **Back to the
  farm** (for the farm itself, **List**), **Show the list**, and **Try again**. Save the file and the
  world reloads on its own.
- **It must stay in its frame.** The moment its page starts to go away (you set `location`, follow a
  link, anything that navigates the frame), the bridge tells the page (`leaving`), before any page it
  goes to can run. The page removes the frame, hears nothing more from it, and shows a panel: "<name>
  tried to leave the page and was stopped." As a second layer, a second `load` of the same frame
  (the page builds a new frame for each load) stops it too. A world that erases its own listeners
  (`document.open()` wipes the ones the bridge set) and holds the page it goes to from finishing its
  load can slip past both, so the panel may not show; it is still cut off all the same — the channel's
  realm went with the old document, so the page it landed on gets no scene and nothing it posts is
  heard. What is still possible either way: the request that leaves is itself sent, once, with whatever
  the world put in its address.
- **Errors show with their message and line** (`world.js:12`), in the panel or the strip: the frame
  loads the SDK's and your world's scripts in CORS mode, so the browser doesn't hide them as "Script
  error." Scripts you add yourself (from your own `world.js`, by creating a `<script>` element) need
  `crossorigin="anonymous"` too, or their errors stay hidden.
- **An error after it started** (one the bridge caught in your `start`, `scene` or `select`, or one
  thrown in `start` itself) shows in a strip (`role="status"`, with a close button) over the world,
  which keeps running under it. The strip is redrawn only when its text changes, at most four times a
  second, and stays closed for a few seconds after ×.
- **Saving a world's files while its panel shows** reloads it, as it does for a world that runs.
- **A save that leaves the world showing listed with an error** (an invalid `world.json`, a
  `world.js` gone) puts the "didn't start" panel up at once, with that error, instead of building a
  frame that can't start. Your choice of world is kept: it is forgotten only when you open the
  dashboard and the world has gone or is broken, and then the farm shows.

The farm's settings from before worlds (`tracker-farm-zoom`, `tracker-farm-beds`, …) are copied
once into `tracker-world:farm:…`, the first time the farm starts, and never again.

## Running a world

The bridge (`web/worlds/sdk/bridge.js`) is the world's side of these messages. A world registers
itself, once, from its `world.js`:

```js
Agentville.raw({
  start({ el, opts, prefs }) { /* draw into el */ },
  scene(scene) { /* every snapshot */ },
  select(id) { /* the agent picked in the page's sidebar, or null (optional) */ },
});
```

`start` runs once, with `el` (the frame's `<div id="farm">`), `opts` and `prefs`. The world then
gets the newest scene and the selection once it has drawn a frame (half a second later in a hidden
tab), and each new one as it comes. The farm always drew its empty self first, and Chrome keeps
where a layer first lay to the fraction of a pixel: this keeps the farm looking exactly as it did.

`Agentville.send(message)` sends any of the messages above itself. A click on a link (`<a href>`)
in the world goes through the page as `openLink`. Script errors, scripts that fail to load and
errors thrown by `start`, `scene` or `select` reach the page as `error`, each once (20 at most). A
`world.js` that registers nothing is reported too.

**Give a way back.** While a world shows, the page hides its own top bar: the world fills the
window. So the **page itself** (not the frame) puts a small control in the top left corner over the
frame — **World ▾** opens the list of worlds (as `nav { what: 'worlds' }` does) and **☰ List** goes
to the list view (as `nav { what: 'list' }`) — whenever a world might draw none of its own. The
page decides who gets it, not the world's own report: **every world of yours** (`u/<name>`), engine
or not, and a **built-in** world only when it draws itself with `Agentville.raw`. Nothing the world
draws can cover it, and it goes with the frame (another world, a reload, a panel). It sits top left,
clear of the engine's HUD buttons (top right), so an engine world of yours shows both. Drawing your
own List and World buttons is optional for a raw world; a world that gives its own `hud` should keep
a List and a World button (`data-farm-nav="list"` and `data-farm-nav="worlds"`, as the farm's do),
since the page adds no corner to a built-in engine world. (The engine registers through the bridge as
`Agentville.raw(handlers, { engine: true })`, so the bridge marks only a plain `Agentville.raw` world
as `raw` in `loaded`; the page uses that only to decide a built-in world's corner.) The list view
has a way to the list of worlds of its own too: the **▾** beside its view toggle. A world that sends
you to the list view (`nav { what: 'list' }`, `showRepos`) can't act once it is out of sight, so it
can't keep you from choosing another world there.

`opts` holds the page's settings and the world's way out. Each function sends one message:

| In `opts` | What it is, or sends |
|---|---|
| `still` | Stand still: reduced motion, or the Motion switch |
| `navState()` | The top bar's state: `{ theme, side, live }` |
| `request(kind, args)` | `request`; returns a promise of the reply, `{ ok, status, data?, error? }`. Four at most go to the page at once; the rest wait their turn, in order |
| `onPickAgent(agentId, { from: 'say' }?)` | `pick` |
| `onOpenDoc(agentId, path)` | `openDoc` |
| `onShowRepos()` | `showRepos` |
| `onStartSession()` | `startSession` |
| `onNav(what)` | `nav` |
| `onBell(on)` | `bell` |
| `onMotion(still)` | `motion` |
| `onDiary(entries)` | `diary`, with the first 20 entries; the same diary twice is sent once |

`prefs.get(name)` and `prefs.set(name, value)` keep the world's own settings: the page stores them
(a frame has no storage) and hands them back in the next `start`. Values are strings. `bell` is the
page's own setting: `prefs.get('bell')` says `'on'` or `'off'`, and `set` leaves it alone (use
`onBell`). `view` (`"<scrollLeft>,<scrollTop>"`, where the engine's view was scrolled to) is the one
setting kept only for the page's life: the page holds it in memory, hands it back in `start` when
the frame reloads, and loses it when the page reloads. It is never written to the browser and does
not count toward the 64 settings or 64 KB.

## Reloading as you edit

The collector watches `web/worlds/` and your worlds folder. When files in a world change, the page
reloads that world's frame once the changes stop (about 0.2 s), as if it had just been opened: a
`start` again, the latest scene, the selection. Zoom and the `view` place come back. A change in
`sdk/` reloads whichever world is showing, and so does your worlds folder appearing. If the list is
open it is refreshed. A world folder that is a link isn't watched, because the watcher doesn't
follow links: reload the page to see an edit to it. Edits to a world that isn't showing reload
nothing.

## Hooks

A world drawn by the engine (`web/worlds/sdk/engine.js`, over the pixel kit in `pixel.js`) gives its
hooks to `Agentville.world(hooks)`, which fills in a default for each one it leaves out and runs the
world through the bridge. The frame has already loaded `bridge.js`, `brand.js`, `pixel.js` and
`engine.js` when your `world.js` runs.

```js
(() => {
  Agentville.world({ W: 400, slots(agent) { … }, drawChar(agent, body) { … }, bg(fill, season, ext) { … } });
})();
```

Wrap `world.js` in a function like this. The SDK's own top-level names share the frame's scope with
your script, so a top-level name of yours can collide with one of them, in two ways. The SDK's
`function` declarations (`makeGrid`, `withDefaults`, `engineScene`, `makePixelView`) are silently
replaced by a top-level `function` of yours with the same name — and the engine then calls yours
(your `engineScene` would take the place of the one that turns the scene into the engine's). Its
`const` and `let` names (`ACTIVE`, `px`, …) can't be declared again: that is a SyntaxError that stops
the world. Inside a function your names are your own, and the SDK's are still there to use.

### The four a world must give

A world without one of them stops with an error that names it.

- `W`: the world's width in world pixels (a number above 0).
- `slots(agent)`: where this agent stands. Either `{ group, cap, at(i) → [x, y], zone }` (room for
  `cap` agents of the same `group`; `at(i)` is the i-th spot; more than that are not drawn, and
  the count over is given to `labels` as `overflow[group]`), or, for agents standing in a field,
  `{ group: 'st:<key>', at(usedOffsets) → [x, y], zone }` (push the offset you took into
  `usedOffsets`; no cap).
- `drawChar(agent, body)`: draws the agent. `body` has `x`, `y`, `walk` (walking now), `face`, `lift`
  and `zone`.
- `bg(fill, season, ext)`: draws the ground. `fill(x, y, w, h, colour)` paints a rectangle; `ext` is
  `{ x0, x1, y0, y1 }`, the area to cover (it grows past the world's edges when the frame has room).
  It is redrawn when the season turns, the layout changes or the frame is resized.

### The optional ones, with their defaults

A hook you give always wins over its default.

| Hook | Arguments | Default |
|---|---|---|
| `corridors` | | `[W / 2]`: the x positions of the paths running down, which agents walk along. A non-empty array of numbers, else the world stops |
| `grid` | | a `makeGrid` result, or the config for one (below); by default 3 beds of 88 × 62 centred on W |
| `fromScene` | `(sceneV1)` | `engineScene` |
| `help` | `()` | the info dialog's HTML: a short key naming your `nouns` |
| `nouns` | | `{ agent, agents, repo, repos }`: `agent`, `agents`, `repo`, `repos` |
| `SH` | | `16`: a character's height |
| `layout`, `relayout` | `()`, `(ground)` | the grid's current ground; `relayout` keeps the new one and returns it |
| `setScene` | `(scene)` | returns `[]`. May return events `{ id?, at?: [x, y], text, cls?, log? }`: a pop-up with `text` over the agent `id` (or at `at`), and a line in the log if `log` is set. The engine records `scene.fields` itself, whether or not you give one |
| `spawn` | `()` | `[W / 2, 0]`: where a new agent appears |
| `follow` | `(body, k, T, kid)` | where the k-th subagent stands beside its agent (`T` the clock, `kid` the subagent's scene entry) |
| `startText` | `(n)` | "n agents here": the first line of the log |
| `arriveText` | | the string `'arrives'`: the log line when an agent walks in |
| `tag`, `tip` | `(agent)` | the name, cut to 16; the name |
| `onMove` | `(agent, zone, prevZone, pop)` | nothing; `pop(text, cls)` shows a pop-up over the agent |
| `speed` | `(agent)` | `40`: walking speed |
| `zoneText` | `(agent, zone)` | `'moves'`: the log line when an agent changes zone |
| `hud` | `(state)` | the dashboard's buttons: list, world, sidebar, sky, motion, help, zoom. `state` is `{ still, zoom, saysOn, skyMode, follow, canFollow, restingHidden, bell, nav, panelOpen, animals }` (`animals`: `true` or `false` for a world with animals, its Animals switch with `data-farm-animals`; `null` for one without). Your own should keep List and World: an engine world gets no corner control from the page |
| `ground`, `shadows(body)`, `top`, `drawFx(agent, body)` | | nothing: drawn under the agents, under each agent, over everything, and over each agent |
| `season` | `()` | `'summer'` |
| `lights` | `()` | `[]`; each `[x, y, r, colour]` glows at night |
| `items` | `()` | `[]`; each `[y, draw]`, drawn among the agents in order of `y`. Return a fresh array each call: the engine pushes its own into it |
| `movers` | `(posOf)` | `[]`; each `{ key, html, title, x, y }`, an HTML label that moves; `posOf(id)` gives an agent's body |
| `labels` | `(lab, overflow)` | each field's name under its bed. `lab(x, y, html, cls, title)` places HTML at a world position; `overflow` counts the agents over each group's `cap` |
| `fieldAt` | `(x, y)` | `null`: the field under that point, which opens its close-up |
| `buildingAt` | `(x, y)` | `null`: the building under that point (a key, below) |
| `buildingTip` | `(key)` | `''` |
| `dialog` | `(key)` | `null`; or `{ title, html }` |
| `boardSessions` | `()` | `[]`: the agents the notice board is read from |
| `emit` | `(agent, body, dt, addParticle)` | nothing: called each frame per agent |
| `tick` | `(dt, posOf, snap)` | nothing: called each frame, and `snap` is true when the world is drawn still |
| `ambient` | `(dt, addParticle)` | nothing: called each frame |
| `weather` | `(sky)` | nothing: drawn over the sky |
| `animals` | `()` | `[]`: the world's creatures (see "Creatures"): a list, or `{ cast, gags, play }`. With any, the engine draws them and adds an Animals switch |
| `roam` | `()` | `[]`: rectangles `{ x, y, w, h }` where they may walk. Keep them off anything that shows data |
| `avoid` | `()` | `[]`: rectangles inside those that they keep off (a pond, a henhouse) |
| `perches` | `()` | `[]`: `[x, y, lift]` points a climber stands on, `lift` pixels up (a woodpile, a rock). One it can't reach is skipped |
| `spots` | `()` | `{}`: named points gags go to (`{ hammock: [x, y] }`), and `huddle`, where they gather in winter. A spot may be inside an `avoid` rectangle: only a gag goes in |
| `spotFree` | `(name)` | `true`: may a gag use that spot now (the farm's hammock is taken while an agent naps) |

Buildings: `buildingAt` returns a key when the point is on a building. The key `'barn'` calls the
page's ＋ Session (starting a session) and `'board'` opens the notice board, built from
`boardSessions()`. Any other key goes to `dialog(key)`, which gives the dialog's title and HTML (or
`null` for none).

### `makeGrid(config)`

The repo grid an engine world lays its fields out on, where a repo keeps its bed while you look, a
project's repos sit together, and a repo that leaves keeps its bed for a day. `config`:

- `cols` (3), `colW`, `rowH`: beds across, and each bed's width and height;
- `cx0`, `top0`: the centre x of the first column and the top of the first row;
- `minRows` (3), `maxRows` (6), `max` (18): how many rows show, and how many beds in all (more show as "+N more");
- `slot(cx, rowTop)` → object: extra fields for each bed (the farm adds `lane`, `x0`, `y0`);
- `fence(rows)` → `{ x0, x1, y0, y1 }`: the fenced ground for that many rows;
- `height(fence)` → the world's height.

It returns `{ layoutFor(fields, beds?, now?), packedLayout(fields, beds, now?), slotAt(i), cols }`.
`layoutFor` returns `{ key, ST, slots, empty, rows, GRID, H, groups, more, beds }`.

If a world's `grid` is a config (not a `makeGrid` result), the engine fills in what is missing:
`cols` 3, `colW` 88, `rowH` 62, the first column so the columns are centred on `W`, and a fence half a
column wider on each side (kept inside 0 to `W`).

### `engineScene(scene)`

The engine's scene, from the version 1 scene: `farmers` (the agents, each with `field`, its repo;
`pct`, the context used; `hearts`, left of 4; `shirt`, its colour), `fields` (the repos, with
`lastDeploy`), `plan.windows` (each with `percentUsed`), `henhouse`, `carts`, `mail`, `subagents` and
`chrome`. A world's `fromScene` can call it and add its own looks (the farm adds each farmer's `look`
and each field's crop, fence, soil, pennant and weather).

The field close-up (a field's files) is still drawn as the farm draws it.

## Creatures

Animals that live in a world just for fun: they wander, graze, nap, sleep at night, say short lines
in their own bubbles, and do what you click. They never stand for data. A world opts in with the
`animals()` hook and says where they may walk with `roam()` and `avoid()`; the engine (with the kit,
`sdk/animals.js`, and the creature library, `sdk/creatures.js`) does the rest:

- They wander inside `roam`, never into `avoid` (no part of them: a tall one doesn't reach over
  it), never onto what your `fieldAt` and `buildingAt` report, and never across any of it on the way.
  A creature with a `home` keeps to it (the farm's ducks keep to the pond). With no `roam`, the rest
  aren't shown.
- At night most sleep (the lion and the cat wander); with motion off they all doze where they are.
- Now and then one says a line from `lines.idle`: at most two bubbles at once, 4 s each, 40 characters
  at most, shown as text (never HTML). A bubble moves out of the way of an agent's bubble or name,
  or waits.
- Clicking one (or its `home`) opens its menu. The nearest agent that isn't waiting on you (or on its
  turn: that is waiting for you too), and isn't already away, walks over and does it; one at work goes
  only if it can be there and back in 5 s. The menu says who, and a colour dot sends another. With no
  one free, or motion off, it happens at once, in place.
- The Animals switch (in the default HUD, or your own `hud` with `animals`) hides them all, and is
  saved as the world's `animals` preference.
- The engine sets `PXG.animals` before `ground()`: true while they are shown, so a world can leave
  out what they replace (the farm's scenery duck). It sets `PXG.taken` too: a `Set` of what they have
  just now (`'bucket'` while the ostrich wears it), so the world doesn't also draw it in its place.
- Now and then (one rest in three) one keeps a habit of its own (`habits`, below). Not at night (bar
  the night owls), not in winter.
- They react to what happens: a world event from `setScene` with a `kind` (below), and `arrive`,
  from the engine, when a new agent walks in.
- In winter (`season()` returns `'winter'`) the goats wear scarves, the pond freezes (the ducks slide
  on it), they rest twice as long and huddle at `spots().huddle`.
- Now and then (every one to two minutes, one at a time) they get up to something: a gag, a short
  script of steps. An agent idle three minutes or more sometimes plays with one (play, two at most).

A creature in `animals()`:

| Field | Meaning |
|---|---|
| `kind` | One of the library's creatures (below). Never one of your `taken` shapes |
| `count` | How many (1) |
| `looks` | One look per creature, in order (the duck's `drake`, `hen`, `duckling`) |
| `name` | The menu's title (the kind) |
| `home` | `{ x, y, w, h }`: it keeps to this area, and clicking it opens its menu |
| `bank` | `[[x, y], …]`: where an agent stands to do something with one that has a `home` (the nearest is used); else beside it |
| `actions` | Its menu, 2 to 4: `{ label, fx?, pose?, line?, run?, gather?, steal?, ms? }`. `fx` is `'hearts'`, `'crumbs'` or `'dust'`; `pose` what it does meanwhile (`happy` by default); `line` a key of `lines` it says; `run` makes it run off; `gather` brings every one of its kind to it (feeding the ducks); `steal`, with `gather`, sends its last `duckling` look first, fast, to say `lines.bread`; `ms` how long (2500) |
| `lines` | `{ idle: […], <key>: […] }`: what it says, now and then (`idle`), after an action (`line`), in a gag (`say`) and when it reacts (the event's kind). 40 characters at most each |
| `habits` | What it does now and then, of: `climb` (onto a `perch`), `circles`, `hide` (the ostrich's head in the ground; it hides from a failed deploy too), `yawn`, `stretch`, `roll` (onto its back), `chaseTail`, `pounce`, `fetch` (runs off and back), `laps` |
| `reacts` | `{ <event kind>: what }`, over the defaults: `'scatter'`, `'hop'`, `'gather'`, `'hide'` or `'run'` (to where it happened); `null` for nothing |

The library's creatures, each drawn on its feet, facing either way: `cow`, `goat`, `sheepdog` (with a
red bandana), `ostrich`, `lion`, `tiger`, `duck` (looks `drake`, `hen`, `duckling`), `cat`, `dog`,
`pigeon`, `mouse` and `fish`. Their poses: `stand`, `walk`, `run`, `eat`, `sleep`, `happy`, `yawn`,
`startled`, `stretch`, `roll`; the duck's `swim`, `dabble` and `slide` (on ice); the ostrich's `hide`.
What they can wear (the kit puts it on): a goat's scarf and a hat (a farmer's, in a gag), the
ostrich's bucket.

### Reactions

Return events from `setScene` with a `kind` and the kit reacts where it happened (`at`, or beside the
event's agent). An event with an empty `text` pops nothing: it is for the animals only.

| Kind | By default | The farm sends it |
|---|---|---|
| `deployFailed` | They scatter (the ostrich hides) | A field's weather turns to rain |
| `deployOk` | They hop | A field's weather turns to a rainbow |
| `harvest` | Up to four gather there | An agent's conversation is compacted |
| `merged` | Nothing (the farm's sheepdog runs to the stall) | A pull request is merged |
| `arrive` | Nothing (the farm's sheepdog runs to meet it) | From the engine: a new agent walks in |

Each kind at most once in 30 s. Those near it react (within 120 px, or the three nearest), and the
first says `lines[<kind>]` if it has one.

### Gags and play

`animals()` may return `{ cast, gags, play }`: the creatures, then short scripts they play out.

```
{ id, needs: { <kind>: n, farmer?: 'idle' | 'busy', chicken?: true, spot?: '<name>' }, lines?: { <key>: […] }, steps: [ … ] }
```

`needs` says who it takes: creatures of a kind (awake, not busy with something else), an agent
(`farmer`), a subagent's chicken within 40 px of the first creature, a free spot. A gag starts only
when all are there. Its roles are the kinds it needs (the first of each picked), `'farmer'` (the agent
nearest it) and `'chicken'`. The steps run one at a time:

| Step | What it does |
|---|---|
| `{ go: role, to, run?, ms? }` | Walks there (runs with `run`): `to` is a role (beside it), `'spot:<name>'`, `'away'` (somewhere far) or `'back'` (where it started). Done on arrival, or after `ms` (as long as the walk takes by default). A creature that can't get within 24 px of a role ends the gag; the way into a spot inside `avoid` is checked up to its edge |
| `{ chase: 'farmer', after: role, ms }` | The agent follows the role for `ms` |
| `{ say: role, line }` | The role says `lines[line]` (its own, or the gag's) |
| `{ pose: role, is, ms }` | A pose for `ms` |
| `{ wear: role, what: 'hat' \| 'bucket', on }` | A hat is the agent's own (the agent is drawn `hatless` meanwhile); the bucket is in `PXG.taken` |
| `{ wait: ms }` | A pause |
| `{ fx: 'hearts' \| 'crumbs' \| 'dust', at: role }` | An effect |
| `{ stay: role, is?, ms, while: 'spot:<name>' }` | Stays (asleep by default) while `spotFree(name)` says the spot is free |

The rules the engine keeps for the agents a gag borrows:

- Only idle agents walk: never one waiting on you or on its turn. One that starts waiting, or gets
  work, ends the gag at once, and everything is put back (the hat on its head, the bucket by the
  trough, the agent let go).
- A busy agent (`farmer: 'busy'`) is never moved: the creature comes to it, and its hat is off 3 s at
  most. A gag that would take longer, or move it, is dropped.
- Motion off, the animals hidden or the page reloaded: every gag ends where it is.

`play` is the same shape, for an agent idle three minutes or more (checked every 45 s, two at most):
the agent walks to a creature and plays (a stick for the dog, a goat to pet). Work, or you, call it
back.

A gag written wrong (a step it doesn't know, a role it wasn't given) is dropped the first time it
runs, with one warning in the console: "Animals: the gag <id> was dropped: <why>". The world goes on.

A body the kit has borrowed carries flags for your `drawChar`: `b.hatless` while a creature has its
hat (the farm draws that farmer with `hat: 'none'`, and leaves out the pin on its hat).

A cat for a world 200 wide, in `world.js`'s hooks:

```js
animals: () => [{ kind: 'cat', name: 'Cat', actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }], lines: { idle: ['mrrp.'], petted: ['purr ♥'], fed: ['MEOW'] } }],
roam: () => [{ x: 4, y: 60, w: 90, h: 40 }],
avoid: () => [],
```

The same cat with habits, a reaction and a gag (it jumps at nothing, then says so):

```js
animals: () => ({
  cast: [{ kind: 'cat', name: 'Cat', habits: ['yawn', 'pounce', 'chaseTail'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }],
    lines: { idle: ['mrrp.'], petted: ['purr ♥'], fed: ['MEOW'], deployFailed: ['not me'] } }],
  gags: [{ id: 'pounce', needs: { cat: 1 }, steps: [{ pose: 'cat', is: 'startled', ms: 600 }, { say: 'cat', line: 'idle' }] }],
  play: [],
}),
roam: () => [{ x: 4, y: 60, w: 90, h: 40 }],
avoid: () => [],
```

The rules for your creatures: none in a `taken` shape; lines of 40 characters at most (a gag's own
too); `roam` areas, `perches` and `spots` clear of anything that shows data (the farm keeps them out
of its fields, off the hay, crates and mailbox, and off the carts' rank).

## What a world can't do

- It has no token, no cookies and no storage: reading them throws a `SecurityError`. It can't
  **fetch, post or upload** anything: no `fetch`, no `EventSource` — no request it can read, and
  none to another server (`connect-src 'none'`; a tag can still ask the dashboard's own server for a
  path, but the world can't read the answer, and no such request acts) — no workers, forms, popups
  (`window.open` gives `null`) or dialogs like
  `alert`. It can make a frame of its own but can't load an address into one (`frame-src 'none'`).
  It can't read the page: `parent.document` and setting `top.location` throw a `SecurityError`. A
  picture from another server isn't loaded. Its scripts come from the dashboard's server only: no
  inline scripts and no `eval`. It can use pictures, fonts, sounds and stylesheets from the
  dashboard's server (its own folder's, through `/world/<key>/…`), inline styles, and `data:`
  pictures, fonts and sounds (`blob:` pictures and sounds too).
- It can't see the dashboard: the page and its API refuse to be shown in a frame
  (`frame-ancestors 'none'`), so a world can't load them with the token inside itself.
- It can't make the page do anything but the messages above, each checked against the scene.
  Anything else (a message type the page doesn't know, such as an answer to a question) is dropped.
- It can't move your click onto a control it raised. When a world message changes or opens part of
  the page (the sidebar's agent, a dialog, the reader), the action buttons in that area ignore clicks
  for about a second, re-armed while you keep moving the pointer or typing; a click whose press began
  before the change is ignored too. So a world can't swap another agent (or a dialog) under a click
  you meant for the one you were reading. Your own clicks — a row, a sidebar tab — lock nothing, and a
  way out is never held (closing or cancelling a dialog, the page's corner, ☰ List, the view toggle).
  Your world's own `nav` and `startSession` still work while it is up: they are presses the page does
  for you, not clicks.

The sandbox protects the token and every action, not the secrecy of what a world is shown: a world
can get what it sees out to another machine (see "The gaps"), so treat the scene a world is handed
as visible to its author.

`scripts/e2e-ui.mjs` (`npm run test:ui`) runs a probe world in a real browser that tries each way
out (`fetch`, `EventSource`, the parent page, the top page, storage, cookies, the token, a frame of
the dashboard, a picture from another server, a popup, WebRTC, a preconnect), sends the page
messages it must drop, and checks that every one is blocked but the gaps below, that a world
that loads another page in its frame is stopped, and that a world that erases its listeners and
navigates away gets no scene after and has nothing it posts acted on.

## The gaps

Browsers let any page signal another machine in ways the page can't fully close. A world can't fetch,
post or upload, but it can get out what it sees:

- **A connection hint to a host it names.** A world can make the browser reach out to a host of its
  choosing (a connection hint such as `preconnect`, or `dns-prefetch`), repeatedly and unseen. No
  request of yours goes with it, but the host name (looked up in DNS) and the choice of host carry
  what the world sees. This can't be closed from the page.
- **WebRTC.** A peer connection reaches another machine directly, and no CSP stops it. The bridge
  switches WebRTC off in the world's own page (its constructors are made `undefined` before the
  world runs), which stops the straightforward use; a determined world can still get round it (a
  fresh page it makes keeps WebRTC), so this is narrowed, not closed.
- So a world from your folder could get out what a private scene holds (states, tools and numbers;
  see "Privacy mode" for exactly what that is), and a world you let see what agents say could get
  out the words too.
- **Leaving its frame.** A frame can always navigate itself away (`location = …`). What can't be
  stopped is the one request that starts the navigation, which carries whatever the world put in its
  address. After that there is nothing more: page-to-frame traffic rides a `MessageChannel` port that
  lives in the frame's realm, so once the world navigates, the realm and the port die together — the
  page it lands on gets no scene, and anything it posts is ignored. The page usually catches the leave
  and shows a panel (the bridge's `leaving`, from `beforeunload` / `pagehide`, or the frame's second
  `load`); a world that erases those listeners and keeps the new page's load from finishing can avoid
  the panel, but not the cut-off.

The threat model, plainly: the sandbox protects your token and every action — a world can't act for
you — but not the secrecy of what a world is shown. So treat the scene a world is handed as visible
to its author: for the farm and a world you allowed, agents' names, paths and what they say; for one
of your other worlds, what a private scene keeps. Add only worlds you trust, and tick "Can see what
agents say" only for a world whose author you'd trust with the words.
