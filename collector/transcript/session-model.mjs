import { isAbsolute, resolve } from 'node:path';
import { parseEntry } from './parse.mjs';
import { firstLine, summarizeTool } from './summarize.mjs';
import { stepOf } from '../derive/step.mjs';

const CHILD_KIND = { Agent: 'subagent', Task: 'subagent', Workflow: 'workflow' };
const DOC_FILE = /\.(md|markdown|mdx)$/i;
const FILE_MODE = { Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write', Read: 'read' };
const DOCS_KEPT = 40;
const BODY_MAX = 20_000; // a prompt or reply is kept whole for the conversation view, up to this (a pasted dump stops here)
const bodyOf = text => {
  const t = String(text ?? '').trim();
  return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX)}…` : t;
};

/** Everything the tracker knows about one session, built incrementally from its transcript. */
export class SessionModel {
  constructor({ feedCap = 200, saidCap = 200, callCap = 500, fileCap = 300 } = {}) {
    this.feedCap = feedCap;
    this.saidCap = saidCap;
    this.callCap = callCap;
    this.fileCap = fileCap;
    this.files = new Map(); // path → { path, wrote, at } for files the session wrote or read, oldest first
    this.feed = [];
    this.said = []; // prompts and replies, newest first: kept apart so a run of tool steps can't push them out
    this.pending = new Map();
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
    this.contextTokens = null;
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
        this.#abandonPending();
        this.lastPrompt = firstLine(ev.text);
        this.lastPromptAt = when;
        this.finalReply = null;
        this.turnOpen = true;
        this.#push({ at: when, kind: 'prompt', text: this.lastPrompt, body: bodyOf(ev.text) });
        break;
      case 'turn_start':
        this.turnOpen = true;
        break;
      case 'reply':
        this.lastReply = firstLine(ev.text);
        this.finalReply = String(ev.text ?? '').slice(0, 8000);
        this.turnOpen = true;
        this.#push({ at: when, kind: 'reply', text: this.lastReply, body: bodyOf(ev.text) });
        break;
      case 'tool_use': {
        const call = { id: ev.id, name: ev.name, input: ev.input, at: when, cwd: ev.cwd, background: ev.input?.run_in_background === true };
        this.finalReply = null;
        this.pending.set(ev.id, call);
        this.calls.push(call);
        if (this.calls.length > this.callCap) this.calls.splice(0, this.calls.length - this.callCap);
        this.#noteFile(call);
        const item = { at: when, kind: 'tool', tool: ev.name, step: stepOf(ev.name, ev.input), text: summarizeTool(ev.name, ev.input) };
        this.openItems.set(ev.id, item);
        this.#push(item);
        const isBackground = ev.input?.run_in_background === true;
        const kind = CHILD_KIND[ev.name] ?? (ev.name === 'Bash' && isBackground ? 'bgjob' : null);
        if (kind) {
          const agentType = kind === 'subagent' && typeof ev.input?.subagent_type === 'string' ? ev.input.subagent_type : undefined;
          this.children.set(ev.id, { id: ev.id, kind, agentType, label: summarizeTool(ev.name, ev.input), state: 'running', startedAt: when, isBackground });
        }
        this.turnOpen = true;
        break;
      }
      case 'tool_result': {
        const call = this.pending.get(ev.toolUseId);
        this.pending.delete(ev.toolUseId);
        // How a call ended (a deploy command's outcome is the deploy's). A background command only
        // started here: its notice says how it ended (task_done).
        if (call && !(call.background && ev.ok)) { call.ok = ev.ok; call.endedAt = when; }
        const item = this.openItems.get(ev.toolUseId);
        if (item) {
          item.ok = ev.ok;
          if (call) item.durationMs = Math.max(0, when - call.at);
          this.openItems.delete(ev.toolUseId);
        }
        const child = this.children.get(ev.toolUseId);
        if (child) child.state = !ev.ok ? 'failed' : child.kind === 'subagent' && !child.isBackground ? 'done' : 'unknown';
        break;
      }
      case 'task_done': {
        const call = this.calls.findLast(c => c.id === ev.toolUseId);
        if (call?.background && call.endedAt === undefined && ev.status !== 'running') { call.ok = ev.status === 'completed'; call.endedAt = when; } // the first notice says it
        const job = this.children.get(ev.toolUseId);
        if (job?.kind === 'bgjob') job.state = ev.status === 'completed' ? 'done' : ev.status === 'running' ? 'running' : 'failed';
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
      case 'model':
        if (!ev.model.startsWith('<')) this.model = ev.model;
        if (ev.usage) {
          const total = (ev.usage.input_tokens ?? 0) + (ev.usage.cache_read_input_tokens ?? 0) + (ev.usage.cache_creation_input_tokens ?? 0);
          if (total > 0) this.contextTokens = total;
        }
        break;
      default:
        break;
    }
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
    const older = items.filter(i => i.at < oldest).map(i => ({ at: i.at, kind: i.kind, text: firstLine(i.text), body: bodyOf(i.text) }));
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
    if (item.kind === 'prompt' || item.kind === 'reply') {
      this.said.unshift(item);
      if (this.said.length > this.saidCap) this.said.length = this.saidCap;
    }
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
