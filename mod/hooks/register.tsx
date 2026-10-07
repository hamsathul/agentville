import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TrackerSnapshot, TrackerView } from '../types'
import { DASHBOARD_URL, elapsed, groups, isFresh, newlyWaiting, rowText, stateFileFor, statusText } from './view'

const PANE = 'agent-tracker'
const EMPTY: TrackerView = { snapshot: null, readAt: 0 }
const view = atom({ plugin: 'agent-tracker', key: 'view' } as const, EMPTY)
const selected = atom({ plugin: 'agent-tracker', key: 'selected' } as const, null as string | null)

export const register: Register = on => {
  let previous: TrackerSnapshot | null = null
  const toasted = new Set<string>()
  let selfId = ''

  on('session.start', async ($, e, next) => {
    selfId = await $.session.id()
    await $.command.register({ name: 'agents', description: 'Show every agent working on this Mac (Agent Tracker)' })

    const poll = async () => {
      const now = await $.clock.now()
      let fresh: TrackerView
      try {
        const snapshot = JSON.parse(await $.fs.read(stateFileFor($.plugin.root))) as TrackerSnapshot
        fresh = { snapshot, readAt: now }
        if (snapshot.settings?.modToasts !== false) {
          for (const agent of newlyWaiting(previous, snapshot, selfId, toasted)) $.ui.toast(`${agent.name}: ${agent.stateReason}`)
        }
        previous = snapshot
      } catch (err) {
        fresh = { snapshot: null, readAt: now, error: String(err) }
      }
      await update($, view, () => fresh)
      $.ui.status(statusText(fresh, now))
    }

    await poll()
    $.clock.every(2000, poll)

    return next(e)
  })

  on('command.run', { command: 'agents' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })

    return { text: 'Agent Tracker pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, view)
    const chosen = await read($, selected)
    const now = await $.clock.now()
    const snapshot = current.snapshot

    if (!snapshot || !isFresh(current, now)) {
      return (
        <Box flexDirection="column">
          <Text color="warning">Agent Tracker: collector not running</Text>
          <Text dimColor>Start it with: agent-tracker start</Text>
        </Box>
      )
    }

    const agent = chosen ? snapshot.agents.find(a => a.id === chosen) : undefined
    if (agent) {
      const repos = [...new Set(agent.touching.map(t => t.repo ?? t.path))].slice(0, 4)
      return (
        <Box flexDirection="column">
          <Box>
            <Button key="back" label="Back" onPress={() => update($, selected, () => null)} />
            <Text bold> {agent.name}</Text>
            <Text dimColor> · {agent.state}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{agent.cwd}</Text>
          {agent.now
            ? <Text color="success" wrap="truncate-end">▶ {agent.now.tool} {agent.now.summary} · {elapsed(agent.now.startedAt, now)}</Text>
            : <Text dimColor>{agent.stateReason}</Text>}
          {agent.lastPrompt ? <Text wrap="truncate-end">» {agent.lastPrompt}</Text> : null}
          <Text bold>Activity</Text>
          {agent.feed.slice(0, 10).map(item => (
            <Text dimColor={item.kind !== 'tool'} wrap="truncate-end">
              {item.kind === 'tool'
                ? `${item.ok === false ? '✗' : item.ok ? '✓' : '…'} ${item.tool ?? ''} ${item.text}`
                : `${item.kind === 'prompt' ? 'You' : 'Claude'}: ${item.text}`}
            </Text>
          ))}
          {agent.children.length > 0 ? <Text bold>Subagents & jobs</Text> : null}
          {agent.children.map(child => <Text wrap="truncate-end">↳ {child.kind} {child.label} · {child.state}</Text>)}
          {repos.length > 0 ? <Text dimColor wrap="truncate-end">Touching: {repos.join(', ')}</Text> : null}
          {agent.proc ? <Text dimColor>CPU {agent.proc.cpu}% · RAM {agent.proc.rssMb} MB</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {snapshot.collisions.map(c => <Text color="warning" wrap="truncate-end">⚠ {c.repo.split('/').pop()}: {c.reason}</Text>)}
        {groups(snapshot).map(group => (
          <Box flexDirection="column">
            <Text bold>{group.title}</Text>
            {group.agents.map(a => (
              <Box>
                <Button key={`agent-${a.id}`} plain label={a.id === selfId ? `${a.name} (this session)` : a.name} onPress={() => update($, selected, () => a.id)} />
                <Text dimColor wrap="truncate-end"> {rowText(a, now)}</Text>
              </Box>
            ))}
          </Box>
        ))}
        {snapshot.counts.stale > 0 ? <Text dimColor>{snapshot.counts.stale} stale (see the dashboard)</Text> : null}
        <Button key="open-browser" label="Open in browser" onPress={() => void $.process.run(['open', DASHBOARD_URL])} />
      </Box>
    )
  })
}
