# Worlds

A world is a way to draw what the dashboard knows. The farm is the first one. This page is the
reference for what a world gets from the dashboard and what it can do.

## What a world is

Each world runs in a sandboxed frame of its own, loaded from `/world/<key>/`. The frame has no token,
no cookies, no storage and no network. It sees only the **scene** (below), which the page builds from
each snapshot, and it reaches the page only through the **messages** below. The page checks every
message, and drops anything else.

A world is a folder holding `world.json` and `world.js`, and any files they use (pictures, sounds,
fonts, stylesheets). The collector serves those files from inside the folder only. The frame's page
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
  "nouns": { "agent": "farmer", "agents": "farmers", "repo": "field", "repos": "fields", "start": "barn", "diary": "Farm diary" }
}
```

| Field | Meaning |
|---|---|
| `name` | The world's name. The frame's title today; the list of worlds will show it too |
| `icon` | One emoji, for the world's button |
| `description` | One line saying what the world shows |
| `api` | The version of this page the world was written for: `1` |
| `nouns` | What the world calls things, so the page's words can match: an agent and agents, a repo and repos, where a new session starts (`start`), and the title of its diary (`diary`) |

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
- `private`: `false`. A later change adds a private mode for worlds that shouldn't see what agents say.
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

- `key`: its folder, which is also its id. `name`: the folder's name.
- `branch`: the branch it is on, or `null`; `onMain`: that branch is `main` or `master`.
- `dirty`: uncommitted files; `ahead` and `behind`: commits against its upstream.
- `deploy`: its last deploy, or `null`. From the collector: `{ state, label, detail, url, source }`,
  with `state` `running`, `ok`, `failed` or `blocked`, and its words. From a bare GitHub Actions run:
  `{ state: 'running' | 'ok' | 'failed' | 'other', label: null, detail: null, url, source: 'actions', run: true }`.
- `collision`: two agents writing in it at once: `'high'` (one of them used git), `'normal'`, or `null`.
- `worktree`: it is a git worktree; `main`: the folder of the repo it belongs to, or `null`.
- `project`: an id for grouping repos that sit side by side in one folder (that folder's path), or
  `null`; `projectName`: its label.
- `prs`: its pull requests, from `gh`, or `null`: `{ open: [{ number, title, url, draft, branch, checks }], merged: [{ number, title, url, at }] }`,
  with `checks` `ok`, `failed`, `running` or `null`.

**Each agent** (`agents`)

- `id`, `name`; `kind`: `interactive`, `background`, `codex`…; `cwd`: its folder, or `null`.
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

## Messages

Every message is an object with a `type`. Each side checks the other's: the frame takes messages
from the page only, and the page from its current frame only.

**From the page to the frame**

| Message | What it is |
|---|---|
| `start { world, prefs, settings }` | Each time the frame loads, after it says `loaded`: the world's key, its saved settings (`{ name: value }`, strings) and the page's settings |
| `settings { settings }` | The page's settings, when they change (they are looked at every second): `{ still, theme, nav: { theme, side, live }, bell }`. `still`: stand still (reduced motion, or the world's own Motion switch). `theme`: `auto`, `light` or `dark`; the bridge sets it on the frame, so `base.css`'s colours follow the dashboard. `nav`: the state of the top bar's buttons (`live`: connected to the collector). `bell`: the page's bell is on |
| `scene { scene }` | Every snapshot, as the scene above. Before the world is ready only the newest is kept |
| `select { id }` | The agent shown in the page's sidebar, or `null` |
| `reply { id, ok, status, data?, error? }` | The answer to a `request`: `{ ok: true, status, data }`; `{ ok: false, status, error }` for an error from the collector (its own words, if any); `status: 0` with the reason when the request itself failed; `status: 403` with why when the page refused it |

**From the frame to the page**

| Message | What the page does |
|---|---|
| `loaded` | The world has registered: the page sends `start`, then the newest scene and the selection. The page builds a new frame for every load, and takes `loaded` once from each: an extra one is dropped. Replies to an earlier frame's requests are not posted to the new one, and the paths they named are forgotten |
| `ready` | The world has started: the page stops waiting for it (see "When a world breaks") |
| `error { message, where }` | Shows it (300 and 120 characters at most): before `ready`, in the panel that replaces a world that doesn't start; after it, in a strip over the world. Also written to the page's console, each once (50 at most) |
| `pick { agentId, from? }` | Opens that agent in the sidebar. The id must be one of the scene's; `from: 'say'` when it was picked by its speech bubble |
| `openDoc { agentId, path }` | Opens the file in a reader over the world. Only a path in that agent's folder, in a repo of the scene, or one a reply to `agentFiles` named for that same agent; never one with `..`; 4096 characters at most |
| `openLink { url }` | Opens it in a new tab. Only `https://github.com/` links, 2048 characters at most |
| `startSession` | Opens Start or resume a session |
| `showRepos` | Shows the repos in the list view |
| `nav { what }` | Presses one of the top bar's buttons: `list`, `session`, `setup`, `side` or `theme` (`worlds` opens the list of worlds) |
| `bell { on }` | Turns the page's bell on or off (`on` must be `true` or `false`) |
| `motion { still }` | The world stood still, or moves again (`true` or `false`); the page keeps it for `settings` |
| `diary { entries }` | Shows the world's diary in the sidebar: at most 20 entries `{ at, state, who, text }`, in the order given (the farm puts the newest first), with `state` one of the agents' states and `at` a time. `who` is cut to 80 characters and `text` to 300, and both are shown as text, never as HTML. One bad entry drops the whole message. Drawn at most every quarter second: the newest entries are drawn when their turn comes |
| `store { key, value }` | Saves one of the world's settings in the page's storage, as `tracker-world:<world>:<key>`. Names match `^[a-z][a-z0-9-]{0,31}$`; values are strings of 16384 characters at most. A world keeps at most 64 settings, 64 KB in all (names and values, what it saved before included): a `store` past either is refused (the page says so once, in its console). `migrated` is the page's own |
| `request { id, kind, agentId? \| repo? }` | Reads one of two things with the token and answers with `reply`: `agentFiles` (an agent's files and memory; `agentId` must be in the scene) or `repoTouched` (the files agents touched in a repo; `repo` must be a repo's `key` in the scene). At most four are answered at a time: a fifth is refused at once (the bridge keeps a world under that: see below). One that can't be done is refused, and still answered |

The page takes each action (`pick`, `openDoc`, `openLink`, `startSession`, `showRepos`, `nav`,
`bell`, `motion`) at most once a quarter second: the first at once, the rest dropped, so a world can't
open a flood of dialogs, files or chimes. `bell` and `motion` are settings, so the newest of those is
taken when its turn comes instead, and the page and the world agree.
A world that is out of sight (the page is showing its list view, the frame kept loaded) can do none of them: those messages are dropped until it is shown again. `store`, `diary` and `request` still work.

The frame stays loaded while the dashboard shows its list: it is hidden (Chrome draws nothing in it
meanwhile), and a world keeps all it remembers. It gets no scenes while hidden, and the newest one when
it shows again.

### When a world breaks

A world never traps the person using it: the page puts a panel in its place, or a strip over it.

- **It must start within 5 seconds of its frame being built.** Starting means `ready`: call
  `Agentville.world(...)` or `Agentville.raw(...)` as `world.js` loads. A `world.js` that throws first,
  a missing file, a `world.json` that is briefly invalid mid-save (the frame loads a 404), or one that
  never registers: after 5 s the frame is replaced by a panel (`role="alert"`) saying
  "<name> didn't start" and the last error the bridge caught, if any. Its buttons: **Back to the
  farm** (for the farm itself, **List**), **Show the list**, and **Try again**. Save the file and the
  world reloads on its own.
- **It must stay in its frame.** The page builds a new frame for each load, so a second `load` of the
  same frame means the world navigated itself somewhere else (a link, `location`, a form). The page
  stops it at once, hears nothing more from it, and shows a panel: "<name> tried to leave the page and
  was stopped."
- **An error after it started** (one the bridge caught in your `start`, `scene` or `select`) shows in a
  strip (`role="status"`, with a close button) over the world, which keeps running under it.

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

`Agentville.send(message)` sends any of the messages above itself. A click on a link (`<a href>`)
in the world goes through the page as `openLink`. Script errors, scripts that fail to load and
errors thrown by `start`, `scene` or `select` reach the page as `error`, each once (20 at most). A
`world.js` that registers nothing is reported too.

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

Wrap `world.js` in a function like this. The SDK's own top-level names (`ACTIVE`, `makeGrid`,
`withDefaults`, `engineScene`, `makePixelView`, `px`, …) share the frame's scope with your script, and
declaring one of them again at the top level is a SyntaxError that stops the world. Inside a function
your names are your own, and the SDK's are still there to use.

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
| `hud` | `(state)` | the dashboard's buttons: list, world, sidebar, sky, motion, help, zoom. `state` is `{ still, zoom, saysOn, skyMode, follow, canFollow, restingHidden, bell, nav, panelOpen }` |
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

## What a world can't do

- It has no token, no cookies and no storage: reading them throws a `SecurityError`. It can't reach
  the network: no `fetch`, no requests of any kind (`connect-src 'none'`), no frames, workers, forms,
  popups or dialogs like `alert`. Its scripts come from the dashboard's server only: no inline
  scripts and no `eval`. It can use pictures, fonts, sounds and stylesheets from the dashboard's
  server (its own folder's, through `/world/<key>/…`), inline styles, and `data:` pictures, fonts and
  sounds (`blob:` pictures and sounds too).
- It can't see the dashboard: the page and its API refuse to be shown in a frame
  (`frame-ancestors 'none'`), so a world can't load them with the token inside itself.
- It can't make the page do anything but the messages above, each checked against the scene.
- The one gap: a frame can still navigate itself away (`location = …`), carrying what it saw in the
  address. No browser rule stops a frame from doing that. Until the page catches it, a frame that
  navigated away also keeps receiving the scene. Only the built-in farm runs today; before your own
  worlds can, the page will watch for a frame that leaves its address and stop that world.
