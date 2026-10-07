// Builders for transcript lines shaped like real Claude Code 2.1.291 entries.
import { SessionModel } from '../transcript/session-model.mjs';

export const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
export const at = sec => T0 + sec * 1000;
const iso = sec => new Date(at(sec)).toISOString();

export const prompt = (sec, text, extra = {}) =>
  JSON.stringify({ type: 'user', timestamp: iso(sec), cwd: '/w', message: { role: 'user', content: text }, ...extra });

export const toolUse = (sec, id, name, input = {}, cwd = '/w') =>
  JSON.stringify({ type: 'assistant', timestamp: iso(sec), cwd, message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });

export const toolResult = (sec, id, isError = false) =>
  JSON.stringify({ type: 'user', timestamp: iso(sec), cwd: '/w', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] } });

export const reply = (sec, text) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(sec), cwd: '/w', message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 90 } } });

export const turnEnd = sec => JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: iso(sec), durationMs: 1000 });

export const title = text => JSON.stringify({ type: 'ai-title', aiTitle: text });

export function modelOf(...lines) {
  const m = new SessionModel();
  m.applyLines(lines);
  return m;
}
