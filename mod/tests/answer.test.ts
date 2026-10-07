import { expect, test } from 'claude-code/testing'

import { answerFromDashboard, permitFromDashboard } from '../hooks/register'

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
