# Agentville demo: the script

What the demo videos show and say, scene by scene. There are two: the tour of every feature
(`npm run demo`), and a short one with sixteen sessions at once (`npm run demo:many`, at the end).
The sessions, repos and files in them are made up. Each video has its own demo `~/.claude`, under
`/Users/Shared/agentville-demo` and `/Users/Shared/agentville-many`, not on a real Mac.

Each scene lists what is on screen and its caption, which is a title with one line under it. The
video runs about 7½ minutes over ten chapters, and each chapter starts with a 2-second title card.
Chapters 1 to 9 are also saved as short videos of their own, each starting at its title card. The
opening is at the start of chapter 1's video and the closing at the end of chapter 9's. A smaller
copy of the whole video, 1280 wide and under 10 MB, can be uploaded to GitHub.

## 0. Opening (10 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 0.1 | The farm, full window, sessions busy | Agentville | A local dashboard for the Claude Code and Codex sessions running on your Mac. |

## 1. The farm (75 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 1.1 | Slow pan across the farm | Each agent is a farmer, and each repo is a field | Subagents, background jobs and Codex sessions show up here too. |
| 1.2 | Cursor on the panel, top left | The panel in the corner | It counts agents by state and shows their memory and CPU, along with your plan's 5-hour and weekly limits. |
| 1.3 | Zoom to the porch: a red !, a scroll, a basket | Agents that need you wait on the porch | A red ! is a question or a permission. A scroll is a plan to approve, and a basket means the agent finished and it's your turn. |
| 1.4 | A field: a farmer with a hoe, its board | The farmer's tool shows what the agent is doing | A hoe means it is editing and a magnifier means it is running tests. The board next to it is the task list. |
| 1.5 | Crops at different heights | Crops grow as the context fills up | When the session is compacted, the field is harvested and planted again. |
| 1.6 | Rainbow on one field, rain on another, a windmill | The weather shows the last deploy | It rains on a field whose last deploy failed. A passed deploy gets a rainbow, and a windmill turns while one is running. |
| 1.7 | The silo, its red tag | The silo shows your weekly usage | The grain rises as you use up the plan's weekly limit. Its tag turns amber at 70% and red at 90%. |
| 1.8 | A pigeon flies between two farmers | A pigeon means one agent wrote to another | The message also appears in both conversations. |
| 1.9 | A cart leaves the row by the road and drives to a farmer | Each MCP server has its own cart | When an agent calls the server, its cart drives to that farmer and waits there until the call ends. |
| 1.10 | A cart heading to town, a pump, a hammock | Web fetches and searches send a cart to town | A pump stands for a background job. A farmer in a hammock is a session that will wake itself up with /loop. |
| 1.11 | The market stall, the notice board, the henhouse | Click a building to see more | The stall lists pull requests and the notice board shows CLAUDE.md and memory. Subagents are in the henhouse. |
| 1.12 | The sky turns to night, with lit windows and fireflies | The sky follows your clock | You can zoom, drag the view around and use the minimap. Help explains every symbol. |

## 2. Answering and messaging from the farm (75 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 2.1 | Click a farmer: the sidebar opens | Clicking a farmer opens its sidebar | It has the current step, the working line, the model and effort, a message box and the conversation. |
| 2.2 | Follow on: the view keeps it in the middle | Follow keeps the farmer in view | The view zooms in and moves along as it walks. |
| 2.3 | Answer a question with its options | Answer its question here | The options are the same as in the terminal, and the session carries on as if you had answered there. |
| 2.4 | A permission card, then Allow | Allow or deny a command | This only comes up in modes that ask you. In bypass or auto mode the call goes ahead without waiting. |
| 2.5 | Always allow, with Claude Code's own choices | Always allow uses Claude Code's own choices | For example, a rule for this project or access to a folder. |
| 2.6 | Type a message, attach a screenshot and a folder | Send it a message | It arrives as your own prompt, even in the middle of a task. Attach files, or attach a folder by its path. |
| 2.7 | Ask a side question; the answer appears | Side questions use /btw | The session answers from its conversation without stopping, and the question is not added to the conversation. |
| 2.8 | Switch effort, then model, then Compact | Change its model or effort, or compact it | The dashboard runs /model, /effort or /compact inside the session. |

## 3. Following the work (60 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 3.1 | The Activity tab | The Activity tab lists every step | Each step shows how long it took and whether it worked. |
| 3.2 | The Subagents tab, one card opened | Each subagent gets a card | The card shows its task, its current step and what it last said. Open it to follow along, or read its transcript. |
| 3.3 | Commands running: a dev server and a test run | Commands running lists its shell commands | For each one you see how long it has run and the CPU and memory it uses, counting anything it started. |
| 3.4 | The dev server's output, growing | Output shows a background command's log | It keeps updating while the window is open. |
| 3.5 | Stop, confirm, and the command is gone | Stop ends a command | After you confirm, the command stops along with anything it started, and the session sees it end. |
| 3.6 | The Diary tab | The Diary tab is a log of the farm | Answers, messages, harvests and deploys are all recorded there. |

## 4. Opening files (75 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 4.1 | The Files tab: its folder, scratchpad and memory | The Files tab shows the agent's folder | The scratchpad and memory are there too. Git status letters and dots mark the files the agent changed or read. |
| 4.2 | A plan opens in a window over the farm | Files open in a window over the farm | Markdown is rendered and code has line numbers. If the agent changes the file, the window updates. |
| 4.3 | Select a passage, Quote, reply | Quote part of a file in your reply | Select a passage and click Quote. The agent gets your reply along with the quoted lines. |
| 4.4 | A picture, then a PDF, then a video playing | Pictures, PDFs and videos open as they are | A picture is fitted to the window and a PDF opens in the browser's viewer. Videos play with seeking. |
| 4.5 | An HTML page: Preview, then Source | Preview an HTML page | Preview shows the page with its own CSS and scripts, kept apart from the dashboard. Source shows the code. |
| 4.6 | A Word document, then a spreadsheet with sheet tabs | Word and Excel files | A Word document shows as a page or as plain text. A workbook shows as tables with a tab for each sheet. |
| 4.7 | Ask for a screenshot; a thumbnail appears under the reply; click it | Ask it for a screenshot | When the reply names the file, a thumbnail appears under it. Click the thumbnail to open the picture. |

## 5. The list view (75 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 5.1 | Switch to the list | The list view shows the same agents | They are sorted by what needs you, and idle and stale sessions are folded away. |
| 5.2 | The top bar and the count cards | The top bar shows your Mac and your plan | How much memory and CPU your agents use, your plan's limits, and when each limit resets. |
| 5.3 | A collision card | Collisions | A collision means two agents are writing to the same repo at the same time. |
| 5.4 | One agent's panel | Each agent has a detailed panel | It has the working line, tasks, model, effort, context and cost, with CPU and memory over time. |
| 5.5 | The conversation, with the Latest frame | The newest reply is framed as Latest | If your message is just below it, that is framed too. Reply quotes any message into the box. |
| 5.6 | Read all, then a search for "retry" | Read all opens the whole conversation | Search highlights every match, and Enter jumps to the next one. |
| 5.7 | The Repos panel | The Repos panel lists every repo | You see its branch, uncommitted files, unpushed commits, last deploy and open pull requests. |

## 6. Starting, restarting and ending sessions (60 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 6.1 | The session bar: mode, Restart in, End session | Restart it in another mode, or end it | Restart in resumes it in plan, accept-edits or bypass mode. End session asks before it stops anything. |
| 6.2 | New session: type `~/code/new-shop`, suggestions, Tab | A new session can start in any folder | Type a path and the folders in it are suggested. Tab completes the name, and Browse opens Finder's folder window. |
| 6.3 | Create it, confirm, then New | The folder does not have to exist yet | Create it makes the folder after asking. New then starts the session there with the mode, model and effort you picked. |
| 6.4 | Past sessions: search, filter by model, sort by length | Search your past sessions | Filter them by folder, model, branch or whether they are running, sort them, and resume one. |

## 7. Plugins, MCP servers and permission rules (45 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 7.1 | The Claude Code dialog: Plugins | The Claude Code dialog lists your plugins and skills | Each one shows how much context it uses in every session. You can turn it off, update it or remove it. |
| 7.2 | Reload sessions | Reload applies plugin changes to running sessions | It runs /reload-plugins in every session that is listening. |
| 7.3 | MCP servers: Check again | Check your MCP servers | The list covers your own servers, claude.ai connectors and each plugin's servers. Sign in to one that needs it. |
| 7.4 | Permission rules | Permission rules | See what runs without asking and which settings file each rule is in. You can remove a rule. |

## 8. Notifications (20 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 8.1 | The bell rings; the tab title shows (1) | The bell plays a sound when an agent needs you | You also get a desktop notification, and the tab title shows how many agents are waiting. |
| 8.2 | A still picture of the Claude Code pane and status line | There is a view inside Claude Code too | /tracker opens a pane that lists every agent. Each session also gets a status line and toasts. |

## 9. Privacy (15 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 9.1 | The farm, quiet | It all runs on your Mac | The dashboard only listens on 127.0.0.1, and reading files or conversations needs the page's key. |

## 10. Closing (10 s)

| # | On screen | Caption | Under it |
|---|---|---|---|
| 10.1 | Light theme, then back to the farm | Light, dark, or following macOS | The farm and the list show the same data. |
| 10.2 | Title card | Agentville | github.com/hamsathul/agentville |

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
