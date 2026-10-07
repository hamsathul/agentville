import { expect, test } from 'claude-code/testing'

import { answerAsides, answerFromDashboard, deliverMessages, offerContext, permitFromDashboard, runSettings, usageNow } from '../hooks/register'

// The hook bodies only call $.fs.write and $.process.run, so a small stand-in records them.
type Run = { exitCode: number; stdout: string; stderr: string }
function fake$(onRun: (argv: string[]) => Run | Promise<Run>) {
  const writes: { path: string; text: string }[] = []
  const removed: string[][] = []
  const $ = {
    fs: { write: async (path: string, text: string) => { writes.push({ path, text }) } },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === 'rm') { removed.push(argv.slice(2)); return ok() }
        return onRun(argv)
      },
    },
  }
  return { $, writes, removed }
}

const QUESTIONS = [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }]
const OFFER = { stateDir: '/repo/state', sessionId: 's1', isLive: true, windowSec: 15, now: 1_000 }
const ok = (stdout = ''): Run => ({ exitCode: 0, stdout, stderr: '' })
const never = () => new Promise<never>(() => {})
const ask = (id: string) => ({ tool: 'AskUserQuestion', tool_use_id: id, questions: QUESTIONS })

test("a dashboard answer is handed to Claude as the question's result", async () => {
  const f = fake$(() => ok(JSON.stringify({ answers: { 'Pick a colour?': 'Blue' } })))
  const out = await answerFromDashboard(f.$, ask('toolu_T1'), never, OFFER)
  expect(out).toEqual({ result: { questions: QUESTIONS, answers: { 'Pick a colour?': 'Blue' } } })
  expect(f.writes.map(w => w.path)).toEqual(['/repo/state/pending/toolu_T1.json'])
  expect(JSON.parse(f.writes[0]?.text ?? '{}')).toEqual({ kind: 'question', toolUseId: 'toolu_T1', sessionId: 's1', createdAt: 1_000, questions: QUESTIONS })
  expect(f.removed[0]).toEqual(['/repo/state/pending/toolu_T1.json', '/repo/state/answers/toolu_T1.json'])
})

test('an incomplete dashboard answer is discarded and the wait goes on', async () => {
  let waits = 0
  const f = fake$(() => (++waits === 1 ? ok(JSON.stringify({ answers: {} })) : ok(JSON.stringify({ answers: { 'Pick a colour?': 'Red' } }))))
  const out: any = await answerFromDashboard(f.$, ask('toolu_T4'), never, OFFER)
  expect(out.result.answers).toEqual({ 'Pick a colour?': 'Red' })
  expect(waits).toBe(2)
})

test('an answer typed in the terminal first wins, and the offer is withdrawn', async () => {
  const f = fake$(() => never())
  const terminal = { result: { questions: QUESTIONS, answers: { 'Pick a colour?': 'Red' } } }
  const out = await answerFromDashboard(f.$, ask('toolu_T2'), async () => terminal, OFFER)
  expect(out).toEqual(terminal)
  expect(f.removed[0]).toEqual(['/repo/state/pending/toolu_T2.json', '/repo/state/answers/toolu_T2.json'])
})

test('with the collector down a question goes straight to the terminal, offering nothing', async () => {
  const f = fake$(() => never())
  const terminal = { result: { questions: QUESTIONS, answers: { 'Pick a colour?': 'Red' } } }
  expect(await answerFromDashboard(f.$, ask('toolu_T3'), async () => terminal, { ...OFFER, isLive: false })).toEqual(terminal)
  expect(await answerFromDashboard(f.$, ask('../../etc'), async () => terminal, OFFER)).toEqual(terminal)
  expect(f.writes).toEqual([])
})

test('a permission prompt allowed on the dashboard runs the tool', async () => {
  const f = fake$(() => ok('{"decision":"allow"}'))
  const out: any = await permitFromDashboard(f.$, { tool: 'Bash', tool_use_id: 'toolu_P1', input: { command: 'mkdir /tmp/x' } }, async () => ({ decision: 'ask' }), OFFER)
  expect(out.decision).toBe('allow')
  expect(out.reason).toBe('Answered from the Agent Tracker dashboard')
  expect(JSON.parse(f.writes[0]?.text ?? '{}')).toEqual({ kind: 'permission', toolUseId: 'toolu_P1', sessionId: 's1', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: 1_000, expiresAt: 16_000 })
})

test('a permission prompt denied on the dashboard is refused', async () => {
  const f = fake$(() => ok('{"decision":"deny"}'))
  const out: any = await permitFromDashboard(f.$, { tool: 'Bash', tool_use_id: 'toolu_P3', input: { command: 'rm -rf x' } }, async () => ({ decision: 'ask' }), OFFER)
  expect(out.decision).toBe('deny')
})

test('no dashboard decision within the window falls back to the terminal prompt', async () => {
  const f = fake$(() => ({ exitCode: 1, stdout: '', stderr: '' }))
  const out: any = await permitFromDashboard(f.$, { tool: 'Bash', tool_use_id: 'toolu_P2', input: { command: 'x' } }, async () => ({ decision: 'ask' }), OFFER)
  expect(out.decision).toBe('ask')
  expect(f.removed[0]).toEqual(['/repo/state/pending/toolu_P2.json', '/repo/state/answers/toolu_P2.json'])
})

test('calls that would not prompt, questions, a zero window or a stopped collector are left alone', async () => {
  const f = fake$(() => never())
  const check = async (e: object, verdict: string, offer = OFFER) => ((await permitFromDashboard(f.$, e, async () => ({ decision: verdict }), offer)) as any).decision
  expect(await check({ tool: 'Bash', tool_use_id: 'toolu_A', input: {} }, 'allow')).toBe('allow')
  expect(await check({ tool: 'AskUserQuestion', tool_use_id: 'toolu_B', input: {} }, 'ask')).toBe('ask')
  expect(await check({ tool: 'Bash', tool_use_id: 'toolu_C', input: {} }, 'ask', { ...OFFER, windowSec: 0 })).toBe('ask')
  expect(await check({ tool: 'Bash', tool_use_id: 'toolu_D', input: {} }, 'ask', { ...OFFER, isLive: false })).toBe('ask')
  expect(await check({ tool: 'Bash', input: {} }, 'ask')).toBe('ask')
  expect(f.writes).toEqual([])
})

test('while waiting, the mod refreshes its offer every second so the dashboard knows it is alive', async () => {
  let script = ''
  const f = fake$(argv => { script = argv[2] ?? ''; return ok(JSON.stringify({ answers: { 'Pick a colour?': 'Blue' } })) })
  await answerFromDashboard(f.$, ask('toolu_T5'), never, OFFER)
  expect(/touch "\$2"/.test(script)).toBe(true)
})

test('a dashboard wait that fails is logged, the terminal still answers, and the offer is withdrawn', async () => {
  const logs: string[] = []
  const f = fake$(() => { throw new Error('process refused') })
  const $ = { ...f.$, ui: { log: (text: string) => { logs.push(text) } } }
  const terminal = { result: { questions: QUESTIONS, answers: { 'Pick a colour?': 'Red' } } }
  const out = await answerFromDashboard($, ask('toolu_T6'), async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); return terminal }, OFFER)
  expect(out).toEqual(terminal)
  expect(logs.some(l => l.includes('process refused'))).toBe(true)
  expect(f.removed[0]).toEqual(['/repo/state/pending/toolu_T6.json', '/repo/state/answers/toolu_T6.json'])
})

test('the mod checks the collector itself when a question arrives, even if its poll never started', async () => {
  const fresh = JSON.stringify({ generatedAt: 50_000, settings: { modToasts: true, permissionDashboardSec: 15 }, counts: {}, agents: [], collisions: [] })
  const reads: string[] = []
  const $ = {
    plugin: { root: '/repo/mod' },
    clock: { now: async () => 52_000 },
    session: { id: async () => 's9' },
    fs: { read: async (path: string) => { reads.push(path); return fresh } },
  }
  const offer = await offerContext($)
  expect(offer).toEqual({ stateDir: '/repo/state', sessionId: 's9', isLive: true, windowSec: 15, now: 52_000 })
  expect(reads).toEqual(['/repo/state/state.json'])
})

test('with no collector state at all, the mod stays out of the way', async () => {
  const $ = {
    plugin: { root: '/repo/mod' },
    clock: { now: async () => 500_000 },
    session: { id: async () => 's9' },
    fs: { read: async () => { throw new Error('ENOENT') } },
  }
  const offer = await offerContext($)
  expect(offer.isLive).toBe(false)
  expect(offer.windowSec).toBe(0)
})

// A small in-memory inbox: `mv` claims a file (failing if it is already gone), `rm` deletes.
function inbox$(initial: Record<string, string>, submit?: (input: { text: string }) => Promise<unknown>) {
  const files = new Map(Object.entries(initial))
  const submitted: { text: string; asUser?: boolean }[] = []
  const events: string[] = []
  const base = (path: string) => path.split('/').pop() ?? ''
  const $ = {
    fs: {
      list: async () => [...files.keys()].map(name => ({ name, kind: 'file' })),
      read: async (path: string) => {
        const text = files.get(base(path))
        if (text === undefined) throw new Error('ENOENT')
        return text
      },
    },
    prompt: {
      submit: async (input: { text: string; asUser?: boolean }) => {
        events.push(`submit ${input.text}`)
        submitted.push(input)
        return submit ? submit(input) : { text: input.text }
      },
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === 'mv') {
          const from = base(argv[1] ?? '')
          const text = files.get(from)
          if (text === undefined) return { exitCode: 1, stdout: '', stderr: 'No such file or directory' }
          files.delete(from)
          files.set(base(argv[2] ?? ''), text)
          events.push(`claim ${from}`)
          return ok()
        }
        if (argv[0] === 'rm') for (const path of argv.slice(2)) files.delete(base(path))
        return ok()
      },
    },
  }
  return { $, files, submitted, events }
}
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

test('dashboard chat messages are all claimed first, then submitted as the person’s own words, oldest first', async () => {
  const f = inbox$({ '2000-b.json': '{"text":"second"}', '1000-a.json': '{"text":"first"}', '3000-c.json.tmp': '{"text":"half"}' })
  await deliverMessages(f.$, '/repo/state', 's1')
  expect(f.submitted).toEqual([{ text: 'first', asUser: true }, { text: 'second', asUser: true }])
  expect(f.events).toEqual(['claim 1000-a.json', 'claim 2000-b.json', 'submit first', 'submit second'])
  expect([...f.files.keys()]).toEqual(['3000-c.json.tmp'])
})

test('an unreadable or empty message is discarded without being sent', async () => {
  const f = inbox$({ '1000-a.json': '{ broken', '2000-b.json': '{"text":"   "}' })
  await deliverMessages(f.$, '/repo/state', 's1')
  expect(f.submitted).toEqual([])
  expect([...f.files.keys()]).toEqual([])
})

test('a busy session holding the submit does not get the message twice, and the dashboard sees it taken at once', async () => {
  const f = inbox$({ '1000-a.json': '{"text":"first"}' }, never)
  void deliverMessages(f.$, '/repo/state', 's1')
  await settle()
  expect(f.files.has('1000-a.json')).toBe(false)
  await deliverMessages(f.$, '/repo/state', 's1')
  expect(f.submitted).toEqual([{ text: 'first', asUser: true }])
})

test('a message sent while an earlier one is still waiting is taken and submitted too', async () => {
  const f = inbox$({ '1000-a.json': '{"text":"first"}' }, never)
  void deliverMessages(f.$, '/repo/state', 's1')
  await settle()
  f.files.set('2000-b.json', '{"text":"second"}')
  void deliverMessages(f.$, '/repo/state', 's1')
  await settle()
  expect(f.submitted.map(x => x.text)).toEqual(['first', 'second'])
  expect([...f.files.keys()]).toEqual([])
})

test('a message the dashboard already withdrew is not sent', async () => {
  const f = inbox$({ '1000-a.json': '{"text":"late"}' })
  const list = f.$.fs.list
  f.$.fs.list = async () => { const names = await list(); f.files.delete('1000-a.json'); return names }
  await deliverMessages(f.$, '/repo/state', 's1')
  expect(f.submitted).toEqual([])
})

test('no inbox folder means nothing to deliver', async () => {
  const $ = { fs: { list: async () => { throw new Error('ENOENT') } } }
  await deliverMessages($, '/repo/state', 's1')
})

test("the beacon carries the session's usage as the status line has it: cost, context and the plan's windows", async () => {
  const $ = { session: { usage: async () => ({
    startedAt: 1, context: { window: 200_000, tokens: 83_000, percent: 41.5 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 34.5, resetsAt: '2026-10-07T16:00:00Z' }, { kind: 'seven_day', percentUsed: 61 }],
    cost: { usd: 2.5 },
  }) } }
  expect(await usageNow($)).toEqual({
    costUsd: 2.5, contextPercent: 41.5,
    rateLimits: [{ kind: 'five_hour', percentUsed: 34.5, resetsAt: '2026-10-07T16:00:00Z' }, { kind: 'seven_day', percentUsed: 61, resetsAt: undefined }],
  })
  expect(await usageNow({ session: { usage: async () => { throw new Error('no usage here') } } })).toBe(undefined)
})

// Model and effort switches, and side questions, asked on the dashboard.
function asker$(files: Record<string, string>, { run, fork }: { run?: (c: any) => Promise<any>; fork?: (r: any) => Promise<any> } = {}) {
  const f = inbox$(files)
  const written: { path: string; value: any }[] = []
  const ran: any[] = []
  const forked: any[] = []
  const $: any = {
    ...f.$,
    fs: { ...f.$.fs, write: async (path: string, text: string) => { written.push({ path, value: JSON.parse(text) }) } },
    clock: { now: async () => 5_000 },
    command: { run: async (c: any) => { ran.push(c); return run ? run(c) : { text: `Set ${c.command} to ${c.args}` } } },
    model: { fork: async (r: any) => { forked.push(r); return fork ? fork(r) : { isAnswered: true, text: 'It is the parser.' } } },
  }
  return { $, files: f.files, written, ran, forked }
}

test('a model or effort switch from the dashboard runs as /model or /effort, and what Claude Code said goes back', async () => {
  const f = asker$({ '1-a.json': '{"command":"model","args":"sonnet","id":"1-a"}', '2-b.json': '{"command":"effort","args":"high","id":"2-b"}' })
  await runSettings(f.$, '/repo/state', 's1')
  await settle()
  expect(f.ran).toEqual([{ command: 'model', args: 'sonnet' }, { command: 'effort', args: 'high' }])
  expect(f.written.map(w => w.path)).toEqual(['/repo/state/command-results/s1.1-a.json', '/repo/state/command-results/s1.2-b.json'])
  expect(f.written[0]?.value).toEqual({ id: '1-a', sessionId: 's1', command: 'model', args: 'sonnet', ok: true, text: 'Set model to sonnet', at: 5_000 })
  expect([...f.files.keys()]).toEqual([])
})

test('only /model and /effort, with an alias or a level, are run from the dashboard', async () => {
  const f = asker$({ '1-a.json': '{"command":"clear","args":"","id":"1-a"}', '2-b.json': '{"command":"model","args":"sonnet; rm -rf ~","id":"2-b"}', '3-c.json': '{"command":"effort","args":"turbo","id":"3-c"}', '4-d.json': '{"command":"model","args":"opus[1m]","id":"4-d"}' })
  await runSettings(f.$, '/repo/state', 's1')
  await settle()
  expect(f.ran).toEqual([{ command: 'model', args: 'opus[1m]' }])
})

test('a switch that fails says why', async () => {
  const f = asker$({ '1-a.json': '{"command":"model","args":"fable","id":"1-a"}' }, { run: async () => { throw new Error('Unknown model') } })
  await runSettings(f.$, '/repo/state', 's1')
  await settle()
  expect(f.written[0]?.value).toMatchObject({ ok: false, text: 'Error: Unknown model' })
})

test("a side question is answered over the session's own transcript, like /btw, and the answer goes back", async () => {
  const f = asker$({ '1-a.json': '{"id":"1-a","question":"Which file holds the parser?","at":4000}' })
  await answerAsides(f.$, '/repo/state', 's1')
  await settle()
  expect(f.forked.length).toBe(1)
  expect(String(f.forked[0]?.prompt)).toContain('side question')
  expect(String(f.forked[0]?.prompt).endsWith('Which file holds the parser?')).toBe(true)
  expect(f.written).toEqual([{ path: '/repo/state/asides/s1.1-a.json', value: { id: '1-a', sessionId: 's1', question: 'Which file holds the parser?', text: 'It is the parser.', at: 4000, answeredAt: 5_000 } }])
})

test('a side question with no answer says why', async () => {
  const f = asker$({ '1-a.json': '{"id":"1-a","question":"Anything?"}' }, { fork: async () => ({ isAnswered: false, reason: 'nothing-to-fork' }) })
  await answerAsides(f.$, '/repo/state', 's1')
  await settle()
  expect(f.written[0]?.value).toMatchObject({ reason: 'nothing-to-fork' })
})
