// The demo video's captions, for a file beside it: the video shows no text, so what it would say goes
// here, timed for the whole video and for each chapter's own clip (for a voice-over or subtitles).

/** Seconds into a video as m:ss.t (never before the start). */
export function clock(s) {
  const t = Math.round(Math.max(0, s) * 10) / 10, m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** A chapter's clip, as the recorder names it: 02-day-night-and-seasons.mp4. */
export const clipName = (n, title) => `${String(n).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp4`;

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * The captions file. `chapters`: [{ n, title, at }] in order, `at` in seconds into the video; the first
 * chapter's clip starts with the video and each runs to the next one's start (the last to `length`).
 * `captions`: [{ at, until, title, sub }]. Those before the first chapter are the opening, at the start
 * of the first chapter's clip.
 */
export function captionsMd({ video, chapters, captions, length }) {
  const clips = chapters.map((c, i) => ({ ...c, from: i === 0 ? 0 : c.at, to: chapters[i + 1]?.at ?? length }));
  const clipOf = t => clips.findLast(c => t >= c.from) ?? clips[0];
  const rows = list => ['| Whole video | In its clip | Caption | Under it |', '|---|---|---|---|',
    ...list.map(c => { const k = clipOf(c.at); return `| ${clock(c.at)} – ${clock(c.until)} | ${clock(c.at - k.from)} – ${clock(c.until - k.from)} | ${cell(c.title)} | ${cell(c.sub)} |`; })];
  const base = video.replace(/\.mp4$/i, '');
  const out = [
    '# Agentville demo: captions', '',
    `The captions for \`${video}\` (${clock(length)}), which shows no text on screen. Each caption gives when it shows in the whole video and in its chapter's own clip, in \`${base}-chapters/\`.`, '',
  ];
  const opening = captions.filter(c => chapters.length && c.at < chapters[0].at);
  if (opening.length) out.push('## Opening', '', ...rows(opening), '');
  for (const k of clips) {
    out.push(`## ${k.n}. ${k.title}`, '', `Starts at ${clock(k.at)} · its clip: \`${clipName(k.n, k.title)}\` (${clock(k.to - k.from)})`, '');
    const mine = captions.filter(c => c.at >= k.at && c.at < k.to);
    if (mine.length) out.push(...rows(mine), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
