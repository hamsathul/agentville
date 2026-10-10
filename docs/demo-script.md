# Agentville demo: the script

What the demo videos show and say, scene by scene. There are two: the tour of every feature
(`npm run demo`), and a short one with sixteen sessions at once (`npm run demo:many`, at the end).
The sessions, repos and files in them are made up. Each video has its own demo home, under
`/Users/Shared/agentville-demo` and `/Users/Shared/agentville-many`, not on a real Mac. The tour's
home has two Claude accounts, `~/.claude` (personal) and `~/.claude-work` (work, where the infra
sessions run), and the ✨ Helper on, with its Haiku stood in for.

The tour shows no text on screen: only the dashboard, the cursor and its click ripples. What each
scene says (a caption, and a line under it) goes in a file beside the video, `<video>-captions.md`,
with its time in the whole video and in its chapter's own clip, for a voice-over or subtitles. The
tour runs about 12 minutes over fifteen chapters. Each chapter is also saved as a short video of its
own; the opening is at the start of chapter 1's.

## Opening (6 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 0.1 | The farm, full window, sessions busy | Agentville | A local dashboard for every Claude Code and Codex session on your Mac. Here it is a farm: each agent is a farmer. |

## 1. The farm (90 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 1.1 | The cursor drifts over the farm | Each agent is a farmer, and each repo is a field | Subagents, background jobs and Codex sessions show up here too. |
| 1.2 | The panel, top left: the counts, then the gauges of both accounts | The panel in the corner | It counts agents by what they need, shows their memory and CPU, and each Claude account's 5-hour and weekly limits. |
| 1.3 | The porch: deploy-bot's !, cache-plan's scroll, release-notes' basket | Agents that need you wait on the porch | A red ! is a question or a permission, a scroll is a plan to approve, and a basket means it has finished: it's your turn. |
| 1.4 | cart-ui with a hoe, checkout-api with a magnifier and its task board | The farmer's tool shows what the agent is doing | A hoe means it is editing and a magnifier means it is running tests. The board beside it is its task list. |
| 1.5 | metrics' field is harvested as its session is compacted | Crops grow as the context fills | When the session is compacted, its field is harvested and planted again. |
| 1.6 | Rain on mobile, a rainbow on docs, a windmill on analytics | The weather shows the last deploy | Rain on a field whose deploy failed, a rainbow on one that passed, and a windmill while one runs. |
| 1.7 | The two silos, personal (amber, 76%) and work (42%) | A silo for each Claude account | Its grain is the account's weekly usage. The tag at its foot turns amber at 70% and red at 90%. |
| 1.8 | Zoomed in: a pigeon flies from cart-ui to checkout-api | A pigeon means one agent wrote to another | The message also shows in both conversations. |
| 1.9 | The Linear cart leaves the lane's end and drives to infra-ops | Each MCP server has its own cart | When an agent calls the server, its cart drives to that farmer and waits there until the call ends. |
| 1.10 | The docs.github.com cart, a pump, a hammock | Web fetches and searches send a cart to town | A pump is a background job. A farmer in a hammock is a session that will wake itself up with /loop. |
| 1.11 | The stall's, the notice board's and the henhouse's dialogs | Click a building to see more | The stall lists pull requests, the notice board shows CLAUDE.md and memory, and the henhouse the subagents. |

## 2. Day, night and seasons (45 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 2.1 | The Menu opens, top right | Everything else is in the Menu | The dashboard's buttons, the farm's switches and zoom, in one place at the top right. |
| 2.2 | Sky: night. The glass and lamps light up | The sky follows your clock | Or hold it at day or night: windows and lamps light up, and fireflies come out. |
| 2.3 | Season: spring, summer, autumn, winter, then live | The season follows your 5-hour limit | Spring while it is fresh, winter when it is nearly used up. Or hold a season with the Season switch. |
| 2.4 | Zoom in, drag, the minimap, back to 100%, Help | Zoom in and look around | Drag the view, and use the minimap while you are zoomed in. Help explains every symbol on the farm. |

## 3. The animals (50 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 3.1 | The cursor visits a cow, a goat, the sheepdog, the ostrich, the lion | Animals live on the farm, just for fun | Cows, goats, a sheepdog, an ostrich, a lion, a tiger, and a duck family on the pond. They never stand for anything. |
| 3.2 | A cow's menu: Pet. A farmer walks over; the cow says so | Click one to pet or feed it | A farmer with nothing to do walks over and does it. |
| 3.3 | The pond's menu: bread for the ducks | The ducks on the pond | Click the pond to feed them bread, or quack back. |
| 3.4 | The animals say Haiku's fresh lines in their bubbles | With ✨ Helper's Animal lines on, Haiku writes what they say | Fresh lines about what is happening on the farm, never naming anyone, written through one of your own sessions. |

## 4. The sidebar (46 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 4.1 | Click checkout-api: the sidebar opens beside the farm | Click a farmer to open its sidebar | What it is doing now, its chat with you, and one box to write in. |
| 4.2 | The list of every agent, a search, then ‹ › | Pick any agent from the list | Those that need you come first. Type to find one, and ‹ › step through them in that order. |
| 4.3 | On checkout-api, orders-db's card: Postgres | Answer the others without leaving this one | A card for each agent waiting on you: allow a command, pick an option or say Yes, right here. |
| 4.4 | deploy-bot's permission above the tabs, folded to one line, unfolded | Its own question sits above the tabs | Fold it to one line to read the whole chat first. A new question always comes unfolded. |
| 4.5 | Always allow…: Claude Code's options; the first is picked | Always allow uses Claude Code's own choices | For example a rule for this project, or access to a folder. |

## 5. Messaging (42 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 5.1 | A picture and a folder attached, a message typed and sent | Message it like a chat | It arrives as your own prompt. Attach pictures and files, or a folder by its path. |
| 5.2 | It waits under the box; ⚡ Send now, and its reply follows | A busy agent gets it when its turn ends | Until then it waits under the box, where you can remove it, edit it, or ⚡ send it now. |
| 5.3 | Side question: asked, answered | Ask a side question | It answers from its conversation without stopping, and nothing is added to it: Claude Code's /btw. |
| 5.4 | Note: a note added | Keep notes for later | Things you may want to tell it, or not. Put one in the box to edit, or send it as it is. |

## 6. Broadcast (18 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 6.1 | Menu → Broadcast: the agents at work picked, a message typed | 📣 Broadcast one message to several agents | Tick the ones you want, or pick a group: all of them, those that need you, or those at work. |
| 6.2 | Sent: a line for each, sent or waiting for its turn to end | Each gets it as its own box would send it | An agent in the middle of a turn gets it when the turn ends, and the list says which. |

## 7. Naming and steering (74 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 7.1 | scratch: ✎, a new name typed, Rename | Rename a session yourself | ✎ opens its name. Rename runs /rename in the session, as if you typed it there. |
| 7.2 | metrics: ✨, Haiku's offer, ✓ Rename | Or let Haiku suggest one | ✨ asks a small Claude model, through the session's own Claude Code, for a short name from what it is working on. |
| 7.3 | Session: effort high, confirmed; Compact | Change its model or effort, or compact it | The dashboard runs /model, /effort or /compact inside the session. |
| 7.4 | cart-ui: ■ Stop, and it waits | Stop it in the middle of a turn | ■ Stop ends the turn as Esc does in its terminal, and the session waits for you. |
| 7.5 | Session: Restart in…, the work account; asked, not done | Restart it in another mode, or on your other account | Restart in resumes it in plan, accept-edits or bypass mode, or moves it to another of your Claude accounts. |

## 8. Following the work (42 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 8.1 | The Activity tab, filtered to edits, then commands | The Activity tab lists every step | How long each one took and whether it worked. Filter it to commands, edits, reads or failures. |
| 8.2 | The Subagents tab, the Explore card opened | Each subagent gets a card | Its task, its current step and what it last said. Open it to follow along. |
| 8.3 | Under Now, the commands running: a dev server and a test run | Its commands, as they run | How long each one has run, and the CPU and memory it uses, counting everything it started. |
| 8.4 | The dev server's output, growing | Output shows a background command's log | It keeps updating while the window is open. |
| 8.5 | Stop, confirmed: the dev server is gone | Stop ends a command | After you confirm, it stops with everything it started, and the session sees it end. |
| 8.6 | The diary, then back | The diary is a log of the farm | Answers, messages, harvests and deploys, newest first. |

## 9. Opening files (83 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 9.1 | The Files tab: its folder, scratchpad and memory | The Files tab shows the agent's folder | Its scratchpad and memory too. Git letters and dots mark the files it changed or read. |
| 9.2 | The plan opens in a window over the farm | Files open in a window over the farm | Markdown is rendered and code has line numbers. If the agent changes the file, the window updates. |
| 9.3 | A passage selected, Quote, a reply; it waits, ⚡ sent now | Quote part of a file in your reply | Select a passage and click Quote. The agent gets your reply with the quoted lines. |
| 9.4 | A picture, the release notes PDF, a video playing | Pictures, PDFs and videos open as they are | A picture fits the window, a PDF opens in the browser's viewer, and a video plays. |
| 9.5 | The checkout page: Preview, then Source | Preview an HTML page | Preview shows the page with its own CSS and scripts, kept apart from the dashboard. Source shows its code. |
| 9.6 | The brief (Word), then the forecast (Excel) and its second sheet | Word and Excel files | A Word document shows as a page or as text. A workbook shows as tables, with a tab for each sheet. |
| 9.7 | The cards folded away; asked for a screenshot, ⚡ sent now; the thumbnail under its reply opens | Ask it for a screenshot | When its reply names the file, a thumbnail shows under it. Click it to open the picture. |

## 10. The conversation (23 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 10.1 | ⤢ Read the whole conversation; a search for "retry" | Read the whole conversation | From its first message, with search: Enter jumps to the next match. |
| 10.2 | In the conversation, ⑂ Fork on the reply it found: its dialog | Fork from any reply | A new session starts from that point of the conversation, in the mode, model, effort and account you choose. |
| 10.3 | ↺ Restore on its first prompt: its dialog; the conversation closed | Or go back to before one of your messages | ↺ Restore rewinds the conversation, the code it changed since, or both, as /rewind does. |

## 11. The list view (40 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 11.1 | Menu → List: the rows, an account tag, the idle group | The list view shows the same agents | Sorted by what needs you; idle and stale sessions are folded away. Each carries its account. |
| 11.2 | The top bar: the Mac, then each account's plan | The top bar shows your Mac and each account | How much memory and CPU your agents use, and each Claude account's limits and when they reset. |
| 11.3 | The collisions count and card | Collisions | Two agents writing to the same repo at the same time. |
| 11.4 | checkout-api's panel | Each agent has a detailed panel | Its working line, tasks, model, effort, context and cost, with CPU and memory over time. |
| 11.5 | The Latest frame in its conversation | The newest reply is framed as Latest | With your message just before it, when there is one. Reply quotes any message into the box. |
| 11.6 | The repo cards | The repos | Each one with its branch, uncommitted files, unpushed commits, last deploy and open pull requests. |

## 12. Sessions (37 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 12.1 | ＋ Session: `~/code/sh`, its folders suggested, Tab | Start a session in any folder | Type a path and the folders in it are suggested. Tab completes the name, and Browse opens Finder's folder window. |
| 12.2 | `~/code/new-shop`: Create it, confirmed; the work account; New | The folder does not have to exist yet | Create it makes it after asking. New starts the session there, in the mode, model, effort and account you pick. |
| 12.3 | Past sessions: a search, filtered by model, sorted by length | Search your past sessions | Filter them by folder, model, branch, account or whether they run, sort them, and resume one. |

## 13. Claude Code itself (20 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 13.1 | The Claude Code dialog: Plugins | Your plugins and skills | Each one with the context it adds to every session. Turn it off, update it or remove it. |
| 13.2 | Reload sessions | Reload applies them to running sessions | It runs /reload-plugins in every session that is listening. |
| 13.3 | MCP servers | Check your MCP servers | Yours, claude.ai's connectors and each plugin's, with Sign in where one needs it. |
| 13.4 | Permission rules | Permission rules | What runs without asking, and the settings file each rule is in. Remove one in a click. |

## 14. Other worlds (44 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 14.1 | Menu → World: the list of worlds; the robot factory | Choose how the dashboard draws your agents | The farm is one world. The robot factory shows the same agents, and you can make your own. |
| 14.2 | The factory: robots in their bays, drones | The robot factory | Every agent a robot, every repo an assembly bay where a robot is built as its context fills. Drones are subagents and web calls. |
| 14.3 | The Linear cart drives to a robot; a capsule in a tube | Carts, tubes and the heat of the floor | A cart drives to the robot calling an MCP server, messages shoot through tubes, and the floor warms with your 5-hour limit. |
| 14.4 | The robot dog, the robot vacuum, the cat | A robot dog, a robot vacuum and a cat live here | Just for fun, like the animals on the farm. |
| 14.5 | The list of worlds again: your folder; back to the farm | Or make a world of your own | npm run new-world starts one, with a guide written for Claude Code. Yours runs sandboxed, and sees no words until you let it. |

## 15. Notifications, privacy and the theme (41 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 15.1 | Menu → Bell; checkout-flow stops to ask, and walks to the porch | The bell rings when an agent needs you | A chime, a desktop notification, and a count in the tab title. |
| 15.2 | The farm | There is a view inside Claude Code too | /tracker opens a pane listing every agent, and each session gets a status line and toasts. |
| 15.3 | The farm, quiet | It all runs on your Mac | The dashboard listens only on 127.0.0.1, and reading files or conversations needs the page's key. |
| 15.4 | The sidebar on checkout-api; the theme: light, auto, dark | Light, dark, or as macOS is | From the Menu. The farm and the list show the same data. |
| 15.5 | The farm, the cursor to the corner | Agentville | github.com/hamsathul/agentville |

# Many sessions at once

A travel-booking company with eight repos and sixteen Claude Code sessions: a release team of five
(a lead who hands out the work, and agents for the API, the web app, testing and the changelog),
and eleven others working on payments, search, the mobile apps, infrastructure, the design system
and data. Four need you: a question (pricing), a permission (db-migrate), a plan to approve
(search-plan), and a session that has finished (docs-agent). About 80 seconds, with a copy under
10 MB.

The terminal windows are drawn in the page: Claude Code's look, with each window streaming its
session's steps, and the waiting ones showing the prompt they wait in.

| Time | On screen | Caption | Under it |
|---|---|---|---|
| 0:00 | Sixteen terminal windows on a desktop, all streaming; the cursor moves across them | Sixteen Claude Code sessions, sixteen windows | Each one is working on something, and some of them are waiting for you. |
| 0:09 | The same; a question, a permission prompt and a plan are among them | Which ones need you? | A question, a permission and a plan are in there somewhere, and one session has finished. |
| 0:17 | Each window shrinks and flies into its farmer; the desktop fades to the farm | Agentville shows them all in one place | Each session is a farmer, and each repo is a field. |
| 0:23 | Pointing at the four farmers on the porch | The ones that need you wait on the porch | A red ! is a question or a permission, a scroll is a plan to approve, and a basket means it has finished. |
| 0:30 | pricing: With tax, Send. db-migrate: its command, Allow. Both go back to work | Answer without hunting for the window | The options are the same as in its terminal, and the session carries on. |
| 0:44 | Pigeons: api-agent to release-lead, release-lead to web-agent, qa-agent to release-lead, release-lead to web-agent | See how they work together | A pigeon is one agent writing to another. Here the release lead hands out work and hears back. |
| 0:58 | The henhouse, the playwright cart beside qa-agent, the pump at search-index | Subagents, MCP calls and jobs show up too | Subagents wait in the henhouse, each MCP server drives its own cart, and a pump is a job running in the background. |
| 1:06 | The list view, the collisions count and card | Or read them as a list | Sorted by who needs you, with a warning when two agents write to the same repo. |
| 1:17 | Title card | Agentville | github.com/hamsathul/agentville |
