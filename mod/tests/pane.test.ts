import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }

test('the pane says the collector is not running before any snapshot has been read', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-tracker', surface, component: 'Pane', props: PANE_PROPS, requestId: 'agent-tracker' })
    expect(await ui.find({ type: 'Text', text: /collector not running/ })).toBeDefined()
    await ui.unmount()
  }
})
