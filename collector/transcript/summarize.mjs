export function clip(text, max = 80) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function firstLine(text, max = 200) {
  return clip(String(text ?? '').split('\n').find(line => line.trim()) ?? '', max);
}

const lastTwo = path => String(path ?? '').split('/').filter(Boolean).slice(-2).join('/');

/** One short line describing a tool call, for tickers and feeds. */
export function summarizeTool(name, input = {}) {
  switch (name) {
    case 'Bash': return clip(input.description || input.command);
    case 'Edit': case 'Write': case 'Read': return lastTwo(input.file_path);
    case 'NotebookEdit': return lastTwo(input.notebook_path ?? input.file_path);
    case 'Grep': return clip(`"${input.pattern ?? ''}"${input.path ? ` in ${lastTwo(input.path)}` : ''}`);
    case 'Glob': return clip(input.pattern);
    case 'Agent': case 'Task': return clip(input.description || input.prompt);
    case 'Skill': return clip(input.skill);
    case 'WebFetch': return clip(input.url);
    case 'WebSearch': return clip(input.query);
    case 'AskUserQuestion': return clip(input.questions?.[0]?.question);
    default: return clip(Object.values(input ?? {}).find(v => typeof v === 'string') ?? '');
  }
}
