export type TrackerState = 'waiting' | 'working' | 'yourTurn' | 'stale' | 'idle'

export type TrackerAgent = {
  id: string
  kind: 'interactive' | 'background' | 'codex'
  name: string
  cwd: string
  state: TrackerState
  stateReason: string
  stateSince: number
  remoteUrl?: string
  now?: { tool: string; summary: string; startedAt: number }
  lastPrompt?: string
  lastReply?: string
  feed: { at: number; kind: 'prompt' | 'reply' | 'tool'; text: string; tool?: string; ok?: boolean; durationMs?: number }[]
  children: { id: string; kind: string; label: string; state: string; startedAt: number }[]
  touching: { path: string; repo?: string; mode: 'read' | 'write' | 'git'; lastAt: number }[]
  proc?: { cpu: number; rssMb: number; childCount: number; children: string[] }
}

export type TrackerSnapshot = {
  generatedAt: number
  settings?: { modToasts: boolean }
  counts: { waiting: number; working: number; yourTurn: number; stale: number; idle: number; collisions: number }
  agents: TrackerAgent[]
  collisions: { repo: string; agentIds: string[]; severity: 'normal' | 'high'; since: number; reason: string }[]
}

export type TrackerView = { snapshot: TrackerSnapshot | null; readAt: number; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-tracker': { view: TrackerView; selected: string | null }
  }
}
