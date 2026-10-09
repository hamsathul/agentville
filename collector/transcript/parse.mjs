// What Claude Code writes when a turn is interrupted (Esc), and the tracker's mod writes after a stop.
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;

// A message's row in the transcript, where a fork can be cut.
const rowId = obj => (typeof obj.uuid === 'string' ? { uuid: obj.uuid } : {});

/** Prompt text as a person would recognise it; '' for entries that are not real prompts. */
export function cleanPrompt(text) {
  const t = String(text ?? '').trim();
  if (!t || t.startsWith('<local-command-') || t.startsWith('[Request interrupted')) return '';
  const name = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (name) {
    const args = t.match(/<command-args>([^<]*)<\/command-args>/);
    return `${name[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  return t;
}

/** Messages from other Claude sessions in a text (<cross-session-message from-name="…">…</…>), with who sent them. */
function peerMessages(text, origin) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/<cross-session-message\b[^>]*?from-name="([^"]*)"[^>]*>\n?([\s\S]*?)\n?(?:<\/cross-session-message>|$)/g)) {
    const ev = { kind: 'peer_in', from: m[1] || origin?.name || 'another session' };
    if (Number.isInteger(origin?.verifiedPeerPid)) ev.pid = origin.verifiedPeerPid;
    if (typeof origin?.msg_id === 'string') ev.id = origin.msg_id;
    ev.text = m[2].trim();
    out.push(ev);
  }
  return out;
}

/** A background command's notices: which call each was and how it ended (completed, failed, killed…). */
function taskNotices(text) {
  return text.split('<task-notification>').slice(1).flatMap(notice => {
    const body = notice.split('</task-notification>')[0];
    const id = body.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1], status = body.match(/<status>([a-z]+)<\/status>/)?.[1];
    if (!id || !status) return [];
    const result = body.match(/<result>([\s\S]*?)(?:<\/result>|$)/)?.[1].trim().slice(0, 2000); // a background subagent's answer
    return [{ kind: 'task_done', toolUseId: id.trim(), status, ...(result ? { result } : {}) }];
  });
}

/** The id of the task a TaskCreate call made: its result's task, or "Task #7 created…" in its text. */
function createdTaskId(obj, block) {
  const id = obj.toolUseResult?.task?.id;
  if (typeof id === 'string' || Number.isInteger(id)) return String(id);
  const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(c => c?.text ?? '').join(' ') : '';
  return text.match(/^Task #([\w-]+) created/)?.[1];
}

/** The start of a tool result's text (a subagent's result, mostly): 2,000 characters at most. */
function resultText(content) {
  if (typeof content === 'string') return content.slice(0, 2000);
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const c of content) {
    if (c?.type !== 'text' || typeof c.text !== 'string') continue;
    out += (out ? '\n' : '') + c.text.slice(0, 2000);
    if (out.length >= 2000) break;
  }
  return out.slice(0, 2000);
}

// What /effort printed when it set the level (typed, or run from the dashboard).
const EFFORT_SET = /<local-command-stdout>Set effort level to ([a-z]+)/;
// What /model printed: the model's name as its picker has it ("Opus 5.5 (1M context)"), bold or in backticks.
const MODEL_SET = /<local-command-stdout>(?:Set model to|Kept model as) `?([^`<]+?)`?(?: and saved\b|<\/local-command-stdout>)/;
const ANSI = /\u001b\[[0-9;]*m/g;

/** Normalises one transcript JSON object into { at, events }. */
export function parseEntry(obj) {
  if (!obj || typeof obj !== 'object') return { at: null, events: [] };
  const parsed = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
  const at = Number.isFinite(parsed) ? parsed : null;
  const events = [];
  const content = obj.message?.content;
  if (obj.type === 'user' || obj.type === 'system') {
    const said = typeof obj.content === 'string' ? obj.content : typeof content === 'string' ? content : '';
    const effort = said.match(EFFORT_SET);
    if (effort) events.push({ kind: 'effort', level: effort[1] });
    const model = said.includes('model ') ? said.replace(ANSI, '').match(MODEL_SET) : null;
    if (model) events.push({ kind: 'model_set', name: model[1].replace(/ \(default\)$/, '').slice(0, 60) });
  }

  if (obj.type === 'user') {
    const blocks = Array.isArray(content) ? content : [];
    const results = blocks.filter(b => b?.type === 'tool_result');
    if (results.length) {
      for (const b of results) {
        const text = resultText(b.content);
        const ev = { kind: 'tool_result', toolUseId: b.tool_use_id, ok: b.is_error !== true, ...(text ? { text } : {}) };
        const tur = results.length === 1 ? obj.toolUseResult : undefined; // a subagent launched in the background: it ends with a notice
        if (tur?.status === 'async_launched' || tur?.isAsync === true) ev.async = true;
        const taskId = results.length === 1 ? createdTaskId(obj, b) : undefined; // a task list item made by TaskCreate
        if (taskId) ev.taskId = taskId;
        events.push(ev);
      }
    } else if (obj.isCompactSummary === true || obj.isVisibleInTranscriptOnly === true) {
      events.push({ kind: 'turn_start' });
    } else if (INTERRUPTED.test(typeof content === 'string' ? content : blocks.find(b => b?.type === 'text')?.text ?? '')) {
      events.push({ kind: 'turn_end' }); // Esc in the terminal, or ■ Stop on the dashboard (its mod writes the same marker)
    } else if (obj.isMeta !== true) {
      if (typeof obj.permissionMode === 'string') events.push({ kind: 'mode', mode: obj.permissionMode.slice(0, 40) }); // as of this message
      const text = typeof content === 'string' ? content : blocks.filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n');
      events.push(...taskNotices(text));
      if (obj.origin?.kind === 'peer') events.push(...peerMessages(text, obj.origin)); // another session wrote to this one
      // The person typed it, or sent it from the dashboard (the mod submits it as the user's own words).
      const isHuman = !obj.origin || obj.origin.kind === 'human' || obj.origin.asUser === true;
      const clean = cleanPrompt(text);
      if (isHuman && clean) events.push({ kind: 'prompt', text: clean, ...rowId(obj) });
      else if (!isHuman) events.push({ kind: 'turn_start' });
    }
  } else if (obj.type === 'assistant' && Array.isArray(content)) {
    const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
    for (const b of content) {
      if (b?.type === 'tool_use' && typeof b.id === 'string') {
        events.push({ kind: 'tool_use', id: b.id, name: String(b.name ?? ''), input: b.input && typeof b.input === 'object' ? b.input : {}, cwd });
      } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        events.push({ kind: 'reply', text: b.text, ...rowId(obj) });
      }
    }
    if (typeof obj.message?.model === 'string') events.push({ kind: 'model', model: obj.message.model, usage: obj.message.usage, ...(typeof obj.message.id === 'string' ? { id: obj.message.id } : {}) });
  } else if (obj.type === 'queue-operation' && obj.operation === 'enqueue' && typeof obj.content === 'string') {
    events.push(...taskNotices(obj.content)); // a notice that waited for a busy session: queued when the job ended
  } else if (obj.type === 'attachment' && obj.attachment?.type === 'queued_command' && (obj.origin ?? obj.attachment.origin)?.kind === 'peer') {
    events.push(...peerMessages(obj.attachment.prompt, obj.origin ?? obj.attachment.origin)); // it came while this session was busy
  } else if (obj.type === 'permission-mode' && typeof obj.permissionMode === 'string') {
    events.push({ kind: 'mode', mode: obj.permissionMode.slice(0, 40) }); // written as the mode is set or changed (Shift+Tab)
  } else if (obj.type === 'system' && obj.subtype === 'turn_duration') {
    events.push({ kind: 'turn_end' });
  } else if (obj.type === 'system' && obj.subtype === 'compact_boundary') { // the conversation was compacted
    const meta = obj.compactMetadata ?? {};
    events.push({ kind: 'compact', ...(typeof meta.trigger === 'string' ? { trigger: meta.trigger } : {}), ...(Number.isFinite(meta.preTokens) ? { preTokens: meta.preTokens } : {}) });
  } else if (obj.type === 'ai-title' && typeof obj.aiTitle === 'string') {
    events.push({ kind: 'title', text: obj.aiTitle });
  }
  return { at, events };
}
