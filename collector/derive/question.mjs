// "Your turn" is sometimes a question: the agent's final reply ends by asking something
// ("Should I push them to main?"). This finds that question so the dashboard can show it.
const MAX = 300;

/** The last question in the last paragraph of a reply, or null. Code and URLs don't count. */
export function trailingQuestion(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, (_, code) => (/\?/.test(code) ? ' ' : code))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}/g, '');
  const paragraphs = plain.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const last = paragraphs.at(-1) ?? '';
  const asked = last.replace(/\s+/g, ' ').match(/[^.!?]*\?/g);
  if (!asked) return null;
  const q = asked.at(-1).trim();
  if (q.length < 4) return null;
  return q.length > MAX ? `${q.slice(0, MAX - 1)}…` : q;
}
