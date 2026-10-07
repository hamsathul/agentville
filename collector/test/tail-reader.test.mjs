import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TailReader } from '../lib/tail-reader.mjs';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'tracker-tail-')), 't.jsonl');

test('first read of a small file returns every complete line', () => {
  const f = tmpFile();
  writeFileSync(f, 'a\nb\n');
  assert.deepEqual(new TailReader().read(f), ['a', 'b']);
});

test('later reads return only appended lines', () => {
  const f = tmpFile();
  writeFileSync(f, 'a\n');
  const r = new TailReader();
  r.read(f);
  appendFileSync(f, 'b\nc\n');
  assert.deepEqual(r.read(f), ['b', 'c']);
  assert.deepEqual(r.read(f), []);
});

test('a line without its newline yet is held back until complete', () => {
  const f = tmpFile();
  writeFileSync(f, 'a\npart');
  const r = new TailReader();
  assert.deepEqual(r.read(f), ['a']);
  appendFileSync(f, 'ial\n');
  assert.deepEqual(r.read(f), ['partial']);
});

test('first read of a big file returns only whole lines from the tail', () => {
  const f = tmpFile();
  const lines = Array.from({ length: 1000 }, (_, i) => `line-${i}-${'x'.repeat(50)}`);
  writeFileSync(f, `${lines.join('\n')}\n`);
  const got = new TailReader({ initialBytes: 1024 }).read(f);
  assert.ok(got.length > 0 && got.length < 30, `got ${got.length} lines`);
  assert.equal(got.at(-1), lines.at(-1));
  for (const l of got) assert.match(l, /^line-\d+-x+$/);
});

test('a jump bigger than maxChunkBytes skips to the tail instead of reading it all', () => {
  const f = tmpFile();
  writeFileSync(f, 'first\n');
  const r = new TailReader({ initialBytes: 64, maxChunkBytes: 1024 });
  r.read(f);
  appendFileSync(f, `${Array.from({ length: 200 }, (_, i) => `row-${i}`).join('\n')}\n`);
  const got = r.read(f);
  assert.ok(got.length < 20, `got ${got.length} lines`);
  assert.equal(got.at(-1), 'row-199');
});

test('a truncated file is read again from the start', () => {
  const f = tmpFile();
  writeFileSync(f, 'a\nb\nc\n');
  const r = new TailReader();
  r.read(f);
  writeFileSync(f, 'z\n');
  assert.deepEqual(r.read(f), ['z']);
});

test('a missing file reads as no lines', () => {
  assert.deepEqual(new TailReader().read('/nonexistent/x.jsonl'), []);
});

test('multi-byte characters survive being split across reads', () => {
  const f = tmpFile();
  const r = new TailReader();
  const e = Buffer.from('é', 'utf8');
  writeFileSync(f, e.subarray(0, 1));
  assert.deepEqual(r.read(f), []);
  appendFileSync(f, Buffer.concat([e.subarray(1), Buffer.from('\n')]));
  assert.deepEqual(r.read(f), ['é']);
});
