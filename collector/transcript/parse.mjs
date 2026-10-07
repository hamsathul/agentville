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
  return [...text.matchAll(/<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>([a-z]+)<\/status>/g)]
    .map(n => ({ kind: 'task_done', toolUseId: n[1].trim(), status: n[2] }));
}

/** Normalises one transcript JSON object into { at, events }. */
export function parseEntry(obj) {
  if (!obj || typeof obj !== 'object') return { at: null, events: [] };
  const parsed = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
  const at = Number.isFinite(parsed) ? parsed : null;
  const events = [];
  const content = obj.message?.content;

  if (obj.type === 'user') {
    const blocks = Array.isArray(content) ? content : [];
    const results = blocks.filter(b => b?.type === 'tool_result');
    if (results.length) {
      for (const b of results) events.push({ kind: 'tool_result', toolUseId: b.tool_use_id, ok: b.is_error !== true });
    } else if (obj.isCompactSummary === true || obj.isVisibleInTranscriptOnly === true) {
      events.push({ kind: 'turn_start' });
    } else if (obj.isMeta !== true) {
      if (typeof obj.permissionMode === 'string') events.push({ kind: 'mode', mode: obj.permissionMode.slice(0, 40) }); // as of this message
      const text = typeof content === 'string' ? content : blocks.filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n');
      events.push(...taskNotices(text));
      if (obj.origin?.kind === 'peer') events.push(...peerMessages(text, obj.origin)); // another session wrote to this one
      // The person typed it, or sent it from the dashboard (the mod submits it as the user's own words).
      const isHuman = !obj.origin || obj.origin.kind === 'human' || obj.origin.asUser === true;
      const clean = cleanPrompt(text);
      if (isHuman && clean) events.push({ kind: 'prompt', text: clean });
      else if (!isHuman) events.push({ kind: 'turn_start' });
    }
  } else if (obj.type === 'assistant' && Array.isArray(content)) {
    const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
    for (const b of content) {
      if (b?.type === 'tool_use' && typeof b.id === 'string') {
        events.push({ kind: 'tool_use', id: b.id, name: String(b.name ?? ''), input: b.input && typeof b.input === 'object' ? b.input : {}, cwd });
      } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        events.push({ kind: 'reply', text: b.text });
      }
    }
    if (typeof obj.message?.model === 'string') events.push({ kind: 'model', model: obj.message.model, usage: obj.message.usage });
  } else if (obj.type === 'queue-operation' && obj.operation === 'enqueue' && typeof obj.content === 'string') {
    events.push(...taskNotices(obj.content)); // a notice that waited for a busy session: queued when the job ended
  } else if (obj.type === 'attachment' && obj.attachment?.type === 'queued_command' && (obj.origin ?? obj.attachment.origin)?.kind === 'peer') {
    events.push(...peerMessages(obj.attachment.prompt, obj.origin ?? obj.attachment.origin)); // it came while this session was busy
  } else if (obj.type === 'permission-mode' && typeof obj.permissionMode === 'string') {
    events.push({ kind: 'mode', mode: obj.permissionMode.slice(0, 40) }); // written as the mode is set or changed (Shift+Tab)
  } else if (obj.type === 'system' && obj.subtype === 'turn_duration') {
    events.push({ kind: 'turn_end' });
  } else if (obj.type === 'ai-title' && typeof obj.aiTitle === 'string') {
    events.push({ kind: 'title', text: obj.aiTitle });
  }
  return { at, events };
}
