import { isAbsolute, resolve } from 'node:path';
import { parseEntry } from './parse.mjs';
import { firstLine, summarizeTool } from './summarize.mjs';

const CHILD_KIND = { Agent: 'subagent', Task: 'subagent', Workflow: 'workflow' };
const DOC_FILE = /\.(md|markdown|mdx)$/i;
const DOC_MODE = { Write: 'write', Edit: 'write', MultiEdit: 'write', Read: 'read' };

/** Everything the tracker knows about one session, built incrementally from its transcript. */
export class SessionModel {
  constructor({ feedCap = 200, callCap = 500, docCap = 40 } = {}) {
    this.feedCap = feedCap;
    this.callCap = callCap;
    this.docCap = docCap;
    this.docs = new Map(); // markdown path → { path, wrote, at }, oldest first
    this.feed = [];
    this.pending = new Map();
    this.openItems = new Map();
    this.calls = [];
    this.children = new Map();
    this.lastPrompt = null;
    this.lastPromptAt = 0;
    this.lastReply = null;
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
        this.turnOpen = true;
        this.#push({ at: when, kind: 'prompt', text: this.lastPrompt });
        break;
      case 'turn_start':
        this.turnOpen = true;
        break;
      case 'reply':
        this.lastReply = firstLine(ev.text);
        this.turnOpen = true;
        this.#push({ at: when, kind: 'reply', text: this.lastReply });
        break;
      case 'tool_use': {
        const call = { id: ev.id, name: ev.name, input: ev.input, at: when, cwd: ev.cwd };
        this.pending.set(ev.id, call);
        this.calls.push(call);
        if (this.calls.length > this.callCap) this.calls.splice(0, this.calls.length - this.callCap);
        this.#noteDoc(call);
        const item = { at: when, kind: 'tool', tool: ev.name, text: summarizeTool(ev.name, ev.input) };
        this.openItems.set(ev.id, item);
        this.#push(item);
        const isBackground = ev.input?.run_in_background === true;
        const kind = CHILD_KIND[ev.name] ?? (ev.name === 'Bash' && isBackground ? 'bgjob' : null);
        if (kind) this.children.set(ev.id, { id: ev.id, kind, label: summarizeTool(ev.name, ev.input), state: 'running', startedAt: when, isBackground });
        this.turnOpen = true;
        break;
      }
      case 'tool_result': {
        const call = this.pending.get(ev.toolUseId);
        this.pending.delete(ev.toolUseId);
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

  /** Markdown files (specs, plans, READMEs) the session wrote or read, for the dashboard's reader. */
  #noteDoc(call) {
    const mode = DOC_MODE[call.name];
    const raw = call.input?.file_path;
    if (!mode || typeof raw !== 'string' || !DOC_FILE.test(raw)) return;
    const path = isAbsolute(raw) ? raw : call.cwd ? resolve(call.cwd, raw) : null;
    if (!path) return;
    const wrote = mode === 'write' || Boolean(this.docs.get(path)?.wrote);
    this.docs.delete(path);
    this.docs.set(path, { path, wrote, at: call.at });
    if (this.docs.size > this.docCap) this.docs.delete(this.docs.keys().next().value);
  }

  /** Newest first. */
  documents() {
    return [...this.docs.values()].reverse();
  }

  #abandonPending() {
    this.pending.clear();
    this.openItems.clear();
  }

  #push(item) {
    this.feed.unshift(item);
    if (this.feed.length > this.feedCap) this.feed.length = this.feedCap;
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
