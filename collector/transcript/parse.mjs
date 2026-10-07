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
      const text = typeof content === 'string' ? content : blocks.filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n');
      const isHuman = !obj.origin || obj.origin.kind === 'human';
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
  } else if (obj.type === 'system' && obj.subtype === 'turn_duration') {
    events.push({ kind: 'turn_end' });
  } else if (obj.type === 'ai-title' && typeof obj.aiTitle === 'string') {
    events.push({ kind: 'title', text: obj.aiTitle });
  }
  return { at, events };
}
