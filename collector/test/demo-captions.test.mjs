// The demo video's captions file (scripts/demo/captions.mjs): the video has no text on screen, so
// what it would have said goes in a Markdown file beside it, timed for the whole video and for each
// chapter's own clip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionsMd, clipName, clock } from '../../scripts/demo/captions.mjs';

const chapters = [
  { n: 1, title: 'The farm', at: 6 },
  { n: 2, title: 'Day, night and seasons', at: 80.4 },
];
const captions = [
  { at: 0, until: 5.5, title: 'Agentville', sub: 'A local dashboard for the Claude Code sessions on your Mac.' },
  { at: 7.25, until: 14, title: 'Each agent is a farmer, and each repo is a field', sub: 'Subagents and background jobs show up too.' },
  { at: 14, until: 79.9, title: 'The panel | the corner', sub: '' },
  { at: 82, until: 95, title: 'The sky follows your clock', sub: 'Or hold day or night from the Menu.' },
];

test('a time in the video reads as minutes and seconds, to a tenth', () => {
  assert.equal(clock(0), '0:00.0');
  assert.equal(clock(7.25), '0:07.3');
  assert.equal(clock(65.04), '1:05.0');
  assert.equal(clock(725.96), '12:06.0');
  assert.equal(clock(-0.2), '0:00.0', 'never before the start');
});

test("a chapter's clip is named as the recorder names it", () => {
  assert.equal(clipName(2, 'Day, night and seasons'), '02-day-night-and-seasons.mp4');
  assert.equal(clipName(14, '📣 Broadcast'), '14-broadcast.mp4');
});

test('the captions file: each chapter with its start and clip, every caption timed in the whole video and in its clip; before the first chapter, the opening', () => {
  const md = captionsMd({ video: 'agentville-demo.mp4', chapters, captions, length: 130 });
  assert.match(md, /^# Agentville demo: captions\n/);
  assert.match(md, /`agentville-demo\.mp4` \(2:10\.0\)/, 'the video and how long it is');
  assert.match(md, /`agentville-demo-chapters\/`/, 'where the clips are');
  const at = s => md.indexOf(s);
  assert.ok(at('## Opening') < at('## 1. The farm') && at('## 1. The farm') < at('## 2. Day, night and seasons'), 'in order');
  assert.match(md, /## 1\. The farm\n\nStarts at 0:06\.0 · its clip: `01-the-farm\.mp4` \(1:20\.4\)/, 'chapter 1 runs to chapter 2');
  assert.match(md, /## 2\. Day, night and seasons\n\nStarts at 1:20\.4 · its clip: `02-day-night-and-seasons\.mp4` \(0:49\.6\)/, 'the last runs to the end');
  assert.match(md, /\| 0:00\.0 – 0:05\.5 \| 0:00\.0 – 0:05\.5 \| Agentville \| A local dashboard/, "the opening is at the start of chapter 1's clip");
  assert.match(md, /\| 0:07\.3 – 0:14\.0 \| 0:07\.3 – 0:14\.0 \| Each agent is a farmer/, "chapter 1's clip starts with the video");
  assert.match(md, /\| 1:22\.0 – 1:35\.0 \| 0:01\.6 – 0:14\.6 \| The sky follows your clock \| Or hold day or night from the Menu\. \|/, "in chapter 2's clip, from its start");
  assert.match(md, /The panel \\\| the corner \|  \|/, 'a | in a caption is escaped; an empty line under it stays empty');
});

test('what the tour said becomes captions in video time: each until the next thing said, a chapter, or the end', async () => {
  const { timeline } = await import('../../scripts/demo/recorder.mjs');
  const said = [{ wall: 1000, title: 'Agentville', sub: 'a' }, { wall: 1010, title: 'The panel', sub: 'b' }, { wall: 1015, title: null }, { wall: 1030, title: 'The sky', sub: 'c' }, { wall: 1050, title: 'Last', sub: '' }];
  const got = timeline(said, [{ wall: 1006 }, { wall: 1040 }], 998, 1060);
  assert.deepEqual(got, [
    { at: 2, until: 8, title: 'Agentville', sub: 'a' }, // to chapter 1's start
    { at: 12, until: 17, title: 'The panel', sub: 'b' }, // to "nothing from now"
    { at: 32, until: 42, title: 'The sky', sub: 'c' }, // to chapter 2's start
    { at: 52, until: 62, title: 'Last', sub: '' }, // to the end
  ]);
});

test('pointing at a lookup that found nothing logs "not found" and moves on, not a crash (the short video still points page-side)', async () => {
  const { stage } = await import('../../scripts/demo/recorder.mjs');
  const b = { js: async () => null, send: async () => ({}), inFrame: async () => null };
  const ui = await stage(b, 800, 600);
  assert.equal(await ui.where(null), null);
  assert.equal(await ui.point(null, 0), null);
  assert.equal(await ui.point(ui.spot(null), 0), null, 'spot() of no point is nothing too');
});
