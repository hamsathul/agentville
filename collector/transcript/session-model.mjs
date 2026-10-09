import { isAbsolute, resolve } from 'node:path';
import { parseEntry } from './parse.mjs';
import { firstLine, summarizeTool } from './summarize.mjs';
import { stepOf } from '../derive/step.mjs';

const CHILD_KIND = { Agent: 'subagent', Task: 'subagent', Workflow: 'workflow' };
// Documents: markdown, and the pictures, videos, PDFs and office files it wrote or read (a screenshot it checked).
const DOC_FILE = /\.(md|markdown|mdx|png|jpe?g|gif|webp|avif|svg|bmp|pdf|mp4|m4v|webm|mov|mp3|m4a|wav|docx?|rtf|odt|xlsx|csv|pptx?|key|pages|numbers)$/i;
const FILE_MODE = { Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write', Read: 'read' };
const DOCS_KEPT = 40;
const TASK_OPS_KEPT = 400;
const TASK_STATUS = new Set(['pending', 'in_progress', 'completed']);
const BODY_MAX = 20_000; // a prompt or reply is kept whole for the conversation view, up to this (a pasted dump stops here)
const bodyOf = text => {
  const t = String(text ?? '').trim();
  return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX)}…` : t;
};
/** Whether a model id is the one a name says: claude-opus-5-5 is Opus 5.5 (1M context), claude-haiku-4-5-20251001 is Haiku 4.5. */
const isModelNamed = (id, name) => id.replace(/\[.*$/, '').replace(/-\d{8}$/, '') === `claude-${name.replace(/\s*\(.*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Everything the tracker knows about one session, built incrementally from its transcript. */
export class SessionModel {
  constructor({ feedCap = 200, saidCap = 200, callCap = 500, fileCap = 300 } = {}) {
    this.feedCap = feedCap;
    this.saidCap = saidCap;
    this.callCap = callCap;
    this.fileCap = fileCap;
    this.files = new Map(); // path → { path, wrote, at } for files the session wrote or read, oldest first
    this.feed = [];
    this.said = []; // prompts, replies and messages between sessions, newest first: kept apart so a run of tool steps can't push them out
    this.peerIds = new Set(); // messages from other sessions already counted
    this.pending = new Map();
    this.resulted = new Set(); // tool uses with a result, the latest 500: a question answered in the terminal
    this.openItems = new Map();
    this.calls = [];
    this.children = new Map();
    this.lastPrompt = null;
    this.lastPromptAt = 0;
    this.lastReply = null;
    this.finalReply = null; // the whole last reply, while nothing has come after it in the turn
    this.lastActivityAt = 0;
    this.lastTurnEndAt = 0;
    this.turnOpen = false;
    this.title = null;
    this.model = null;
    this.modelSet = null; // the model as /model last named it, until a reply from another model ("Opus 5.5 (1M context)")
    this.contextTokens = null;
    this.fast = false; // the latest reply came in fast mode
    this.taskOps = []; // the task list as it was made and changed (TaskCreate, TaskUpdate, TodoWrite), oldest first
    this.compactions = 0; // times the conversation was compacted
    this.lastCompactAt = 0;
    this.wakeAt = 0; // when a session that scheduled a wake-up (/loop) comes back by itself
    this.turnStartedAt = 0; // when the current turn began, and the tokens its replies have come back with so far
    this.turnOut = new Map(); // reply id → output tokens (each of a reply's entries repeats its count)
    this.toolCount = 0; // tool calls so far (a subagent's steps)
  }

  /** Output tokens the current turn has received, as the terminal's working line counts them (↓ 28.5k tokens). */
  turnTokens() {
    let total = 0;
    for (const n of this.turnOut.values()) total += n;
    return total;
  }

  applyLines(lines) {
    for (const line of lines) this.applyLine(line);
  }

  applyLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    this.apply(parseEntry(obj));
  }

  apply({ at, events }) {
    if (at !== null && at > this.lastActivityAt) this.lastActivityAt = at;
    const when = at ?? this.lastActivityAt;
    for (const ev of events) this.#applyEvent(ev, when);
  }

  #applyEvent(ev, when) {
    switch (ev.kind) {
      case 'prompt':
        this.wakeAt = 0; // you spoke first
        this.turnStartedAt = when;
        this.turnOut.clear();
        this.#abandonPending();
        this.lastPrompt = firstLine(ev.text);
        this.lastPromptAt = when;
        this.finalReply = null;
        this.turnOpen = true;
        this.#push({ at: when, kind: 'prompt', text: this.lastPrompt, body: bodyOf(ev.text), ...(ev.uuid ? { uuid: ev.uuid } : {}) });
        break;
      case 'turn_start':
        if (!this.turnOpen) { this.wakeAt = 0; this.turnStartedAt = when; this.turnOut.clear(); } // a new turn: the wake-up came (or something else woke it)
        this.turnOpen = true;
        break;
      case 'reply':
        this.lastReply = firstLine(ev.text);
        this.finalReply = String(ev.text ?? '').slice(0, 8000);
        this.turnOpen = true;
        this.#push({ at: when, kind: 'reply', text: this.lastReply, body: bodyOf(ev.text), ...(ev.uuid ? { uuid: ev.uuid } : {}) });
        break;
      case 'tool_use': {
        this.toolCount += 1;
        const call = { id: ev.id, name: ev.name, input: ev.input, at: when, cwd: ev.cwd, background: ev.input?.run_in_background === true };
        this.finalReply = null;
        this.pending.set(ev.id, call);
        this.calls.push(call);
        if (this.calls.length > this.callCap) this.calls.splice(0, this.calls.length - this.callCap);
        this.#noteFile(call);
        this.#noteTasks(ev.name, ev.input, when);
        if (ev.name === 'ScheduleWakeup' && Number.isFinite(ev.input?.delaySeconds) && ev.input.delaySeconds > 0) this.wakeAt = when + ev.input.delaySeconds * 1000;
        const item = { at: when, kind: 'tool', tool: ev.name, step: stepOf(ev.name, ev.input), text: summarizeTool(ev.name, ev.input) };
        this.openItems.set(ev.id, item);
        this.#push(item);
        if (ev.name === 'SendMessage' && typeof ev.input?.to === 'string') { // this session wrote to another session, or to one of its helpers
          const to = ev.input.to.slice(0, 80), message = String(ev.input.message ?? '');
          this.#push({ at: when, kind: 'peer', dir: 'out', other: to, ...(typeof ev.input.summary === 'string' ? { summary: ev.input.summary.slice(0, 160) } : {}), ...(/^a[0-9a-f]{16}$/.test(to) ? { helper: true } : {}), text: firstLine(message), body: bodyOf(message) });
        }
        const isBackground = ev.input?.run_in_background === true;
        const kind = CHILD_KIND[ev.name] ?? (ev.name === 'Bash' && isBackground ? 'bgjob' : null);
        if (kind) {
          const agentType = kind === 'subagent' && typeof ev.input?.subagent_type === 'string' ? ev.input.subagent_type : undefined;
          const prompt = kind === 'subagent' && typeof ev.input?.prompt === 'string' ? ev.input.prompt.slice(0, 4000) : undefined; // what it was asked
          this.children.set(ev.id, { id: ev.id, kind, agentType, label: summarizeTool(ev.name, ev.input), state: 'running', startedAt: when, isBackground, prompt });
        }
        this.turnOpen = true;
        break;
      }
      case 'tool_result': {
        this.resulted.add(ev.toolUseId);
        if (this.resulted.size > 500) this.resulted.delete(this.resulted.values().next().value);
        const call = this.pending.get(ev.toolUseId);
        this.pending.delete(ev.toolUseId);
        // How a call ended (a deploy command's outcome is the deploy's). A background command only
        // started here: its notice says how it ended (task_done).
        if (call && !(call.background && ev.ok)) { call.ok = ev.ok; call.endedAt = when; }
        if (call?.background && ev.text) { // where Claude Code writes a background command's output, for the dashboard to follow
          const out = /Output is being written to: (\S+\.output)\b/.exec(ev.text)?.[1];
          if (out) call.outputPath = out;
        }
        if (call?.name === 'TaskCreate' && ev.taskId) this.#taskOp({ op: 'create', id: ev.taskId, subject: firstLine(call.input?.subject ?? ''), activeForm: firstLine(call.input?.activeForm ?? ''), at: when });
        const item = this.openItems.get(ev.toolUseId);
        if (item) {
          item.ok = ev.ok;
          if (call) item.durationMs = Math.max(0, when - call.at);
          this.openItems.delete(ev.toolUseId);
        }
        const child = this.children.get(ev.toolUseId);
        if (child?.kind === 'subagent' && ev.async && ev.ok) { // launched in the background: its notice says when it ends
          child.isBackground = true;
          child.state = 'running';
        } else if (child) {
          child.state = !ev.ok ? 'failed' : child.kind === 'subagent' && !child.isBackground ? 'done' : 'unknown';
          if (child.state === 'done' || child.state === 'failed') { // a background one's result only says it started
            child.endedAt = when;
            if (ev.text) child.result = ev.text;
          }
        }
        break;
      }
      case 'task_done': {
        const call = this.calls.findLast(c => c.id === ev.toolUseId);
        if (call?.background && call.endedAt === undefined && ev.status !== 'running') { call.ok = ev.status === 'completed'; call.endedAt = when; } // the first notice says it
        const job = this.children.get(ev.toolUseId);
        if (job?.kind === 'bgjob') job.state = ev.status === 'completed' ? 'done' : ev.status === 'running' ? 'running' : 'failed';
        if (job?.kind === 'subagent') { // a background subagent stopped (resumed, it may notify again: the latest says)
          const state = ev.status === 'completed' ? 'done' : ev.status === 'running' ? 'running' : 'failed';
          const again = state === job.state && (ev.result ?? job.result) === job.result; // the same notice: queued, then handed over
          if (!again) {
            job.state = state;
            job.endedAt = state === 'running' ? undefined : when;
            if (ev.result) job.result = ev.result;
          }
        }
        break;
      }
      case 'turn_end':
        this.#abandonPending();
        this.lastTurnEndAt = when;
        this.turnOpen = false;
        break;
      case 'title':
        this.title = ev.text;
        break;
      case 'peer_in': // another session wrote to this one (each message once, by its id)
        if (ev.id && this.peerIds.has(ev.id)) break;
        if (ev.id) this.peerIds.add(ev.id);
        this.#push({ at: when, kind: 'peer', dir: 'in', other: ev.from, ...(ev.pid ? { pid: ev.pid } : {}), text: firstLine(ev.text), body: bodyOf(ev.text) });
        break;
      case 'mode':
        this.permissionMode = ev.mode;
        this.permissionModeAt = when; // entries without a time count as the last activity before them
        break;
      case 'effort':
        this.effort = ev.level;
        this.effortAt = when;
        break;
      case 'compact':
        this.compactions += 1;
        this.lastCompactAt = when;
        break;
      case 'model_set':
        this.modelSet = ev.name;
        break;
      case 'model':
        if (!ev.model.startsWith('<')) {
          this.model = ev.model;
          this.fast = ev.usage?.speed === 'fast';
          if (this.modelSet && !isModelNamed(ev.model, this.modelSet)) this.modelSet = null; // another model answered
        }
        if (ev.id && Number.isFinite(ev.usage?.output_tokens)) this.turnOut.set(ev.id, Math.max(this.turnOut.get(ev.id) ?? 0, ev.usage.output_tokens));
        if (ev.usage) {
          const total = (ev.usage.input_tokens ?? 0) + (ev.usage.cache_read_input_tokens ?? 0) + (ev.usage.cache_creation_input_tokens ?? 0);
          if (total > 0) this.contextTokens = total;
        }
        break;
      default:
        break;
    }
  }

  /** Task list changes from a tool call: an update to one item, or a whole to-do list (TodoWrite). A new item comes with TaskCreate's result. */
  #noteTasks(name, input, when) {
    if (name === 'TaskUpdate' && input?.taskId !== undefined) {
      this.#taskOp({ op: 'update', id: String(input.taskId), ...(typeof input.status === 'string' ? { status: input.status } : {}), ...(typeof input.subject === 'string' ? { subject: firstLine(input.subject) } : {}), ...(typeof input.activeForm === 'string' ? { activeForm: firstLine(input.activeForm) } : {}), at: when });
    } else if (name === 'TodoWrite' && Array.isArray(input?.todos)) {
      this.#taskOp({ op: 'todos', list: input.todos.slice(0, 50).map(t => ({ subject: firstLine(t?.content ?? ''), activeForm: firstLine(t?.activeForm ?? ''), status: TASK_STATUS.has(t?.status) ? t.status : 'pending' })), at: when });
    }
  }

  #taskOp(op) {
    this.taskOps.push(op);
    if (this.taskOps.length > TASK_OPS_KEPT) this.taskOps.splice(0, this.taskOps.length - TASK_OPS_KEPT);
  }

  /** The task list now, in the order items were made: [{ id, subject, activeForm, status }]. */
  tasks() {
    const list = new Map();
    for (const op of this.taskOps) {
      if (op.op === 'todos') { list.clear(); op.list.forEach((t, i) => list.set(`todo-${i}`, { id: `todo-${i}`, ...t })); }
      else if (op.op === 'create') list.set(op.id, { id: op.id, subject: op.subject, activeForm: op.activeForm, status: 'pending' });
      else if (op.op === 'update' && list.has(op.id)) {
        if (op.status === 'deleted') { list.delete(op.id); continue; }
        const t = list.get(op.id);
        if (TASK_STATUS.has(op.status)) t.status = op.status;
        if (op.subject) t.subject = op.subject;
        if (op.activeForm) t.activeForm = op.activeForm;
      }
    }
    return [...list.values()];
  }

  /** Task list changes and compactions from before the part of the transcript that was read: they come first. */
  /** Background commands from the part of the transcript read later, to match the ones still running. */
  addEarlierBackground(calls = []) {
    this.earlierBackground = calls.slice(-50);
  }

  /** Its Bash calls, oldest first, those from the earlier part too: to tell which call a running shell command is. */
  bashCalls() {
    return [...(this.earlierBackground ?? []), ...this.calls.filter(c => c.name === 'Bash')];
  }

  addEarlierTasks({ ops = [], compactions = 0, lastCompactAt = 0 } = {}) {
    this.taskOps = [...ops, ...this.taskOps].slice(-TASK_OPS_KEPT);
    this.compactions += compactions;
    if (!this.lastCompactAt) this.lastCompactAt = lastCompactAt;
  }

  /** Files the session wrote or read with its file tools, for the explorer and the document list. */
  #noteFile(call) {
    const mode = FILE_MODE[call.name];
    const raw = call.input?.file_path ?? call.input?.notebook_path;
    if (!mode || typeof raw !== 'string' || !raw) return;
    const path = isAbsolute(raw) ? raw : call.cwd ? resolve(call.cwd, raw) : null;
    if (!path) return;
    const wrote = mode === 'write' || Boolean(this.files.get(path)?.wrote);
    this.files.delete(path);
    this.files.set(path, { path, wrote, at: call.at });
    if (this.files.size > this.fileCap) this.files.delete(this.files.keys().next().value);
  }

  /** File calls from before the part of the transcript that was read, oldest first: merged in as older. */
  addEarlierFiles(calls) {
    const earlier = new SessionModel({ fileCap: this.fileCap });
    for (const call of calls) earlier.#noteFile(call);
    const merged = new Map(earlier.files);
    for (const [path, f] of this.files) {
      const prev = merged.get(path);
      merged.delete(path);
      merged.set(path, { path, wrote: f.wrote || Boolean(prev?.wrote), at: Math.max(f.at, prev?.at ?? 0) });
    }
    while (merged.size > this.fileCap) merged.delete(merged.keys().next().value);
    this.files = merged;
  }

  /** Messages from earlier in the transcript ([{ kind, text, at }], oldest first), added behind the ones known. */
  addEarlierSaid(items) {
    const oldest = this.said.length ? this.said[this.said.length - 1].at : Infinity;
    const older = items.filter(i => i.at < oldest).map(({ text, ...rest }) => ({ ...rest, text: firstLine(text), body: bodyOf(text) }));
    this.said.push(...older.reverse());
    if (this.said.length > this.saidCap) this.said.length = this.saidCap;
  }

  /** The newest `steps` feed items and `messages` messages together, newest first. */
  recent(steps, messages = steps) {
    const items = this.feed.slice(0, steps);
    const have = new Set(items);
    for (const s of this.said.slice(0, messages)) if (!have.has(s)) items.push(s);
    return items.sort((x, y) => y.at - x.at);
  }

  /** The whole history kept, up to `limit` feed items plus up to `limit` messages, newest first. */
  history(limit) {
    return this.recent(limit, limit);
  }

  /** Every file touched, newest first. */
  touchedFiles() {
    return [...this.files.values()].reverse();
  }

  /** Markdown files (specs, plans, READMEs) touched, newest first. */
  documents() {
    return this.touchedFiles().filter(f => DOC_FILE.test(f.path)).slice(0, DOCS_KEPT);
  }

  #abandonPending() {
    this.pending.clear();
    this.openItems.clear();
  }

  #push(item) {
    this.feed.unshift(item);
    if (this.feed.length > this.feedCap) this.feed.length = this.feedCap;
    if (item.kind === 'prompt' || item.kind === 'reply' || item.kind === 'peer') {
      this.said.unshift(item);
      if (this.said.length > this.saidCap) this.said.length = this.saidCap;
    }
  }

  /** Whether the transcript has a result for this tool use (an answered question, a finished call). */
  hasResult(toolUseId) {
    return this.resulted.has(toolUseId);
  }

  latestPending() {
    let latest = null;
    for (const call of this.pending.values()) if (!latest || call.at >= latest.at) latest = call;
    return latest;
  }

  callsSince(since) {
    return this.calls.filter(call => call.at >= since);
  }
}
