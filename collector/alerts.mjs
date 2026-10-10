import { notifyMac } from './platform/mac.mjs';
import { platformFor } from './platform/index.mjs';

export { notifyMac };

export function cpuSustained(history, now, cfg) {
  const windowMs = cfg.cpuAlertSustainSec * 1000;
  const inWindow = history.filter(s => now - s.at <= windowMs);
  if (!inWindow.length || now - inWindow[0].at < windowMs * 0.9) return false;
  return inWindow.every(s => s.cpu > cfg.cpuAlertPct);
}

const STICKY = new Set(['waiting', 'yourTurn']);
const STICKY_TTL_MS = 24 * 3_600_000;

export class AlertEngine {
  constructor({ cfg, notify = platformFor().notify, startedAt, warmupMs = 10_000 }) {
    this.cfg = cfg;
    this.notify = notify;
    this.startedAt = startedAt;
    this.warmupMs = warmupMs;
    this.fired = new Map();
    this.sentAt = []; // when the recent pop-ups went out, for notifyMaxPerMin
  }

  setConfig(cfg) {
    this.cfg = cfg;
  }

  overCap(now) {
    const max = this.cfg.notifyMaxPerMin ?? 0;
    this.sentAt = this.sentAt.filter(t => now - t < 60_000);
    return max > 0 && this.sentAt.length >= max;
  }

  process(snapshot, now, cpuHistories = new Map()) {
    const cfg = this.cfg;
    const want = [];
    const holding = new Set();
    const limitMb = cfg.memoryAlertGb * 1024;

    for (const a of snapshot.agents) {
      if (a.state === 'stale') continue;
      if (a.state === 'waiting') {
        want.push({ key: `waiting:${a.id}:${a.stateSince}`, family: 'waiting', title: `${a.name} needs you`, message: a.stateReason });
      }
      if (a.state === 'yourTurn') {
        want.push({ key: `yourturn:${a.id}:${a.stateSince}`, family: 'yourTurn', title: `${a.name} finished`, message: a.lastReply || 'Your turn' });
      }
      const rss = a.proc?.rssMb ?? 0;
      if (rss > limitMb) {
        want.push({ key: `mem:${a.id}`, family: 'memory', title: `${a.name} is using ${(rss / 1024).toFixed(1)} GB`, message: `Above ${cfg.memoryAlertGb} GB` });
      } else if (rss >= limitMb * 0.8) {
        holding.add(`mem:${a.id}`);
      }
      if (cpuSustained(cpuHistories.get(a.id) ?? [], now, cfg)) {
        want.push({ key: `cpu:${a.id}`, family: 'cpu', title: `${a.name} at ${Math.round(a.proc?.cpu ?? 0)}% CPU`, message: `Above ${cfg.cpuAlertPct}% for ${cfg.cpuAlertSustainSec}s` });
      } else if ((a.proc?.cpu ?? 0) > cfg.cpuAlertPct) {
        holding.add(`cpu:${a.id}`);
      }
    }
    for (const c of snapshot.collisions) {
      want.push({ key: `collision:${c.repo}:${c.agentIds.join(',')}`, family: 'collision', title: `Collision in ${c.repo.split('/').pop()}`, message: c.reason });
    }

    const isWarm = now - this.startedAt >= this.warmupMs;
    const raised = [];
    let suppressed = 0;
    for (const w of want) {
      holding.add(w.key);
      if (this.fired.has(w.key)) continue;
      this.fired.set(w.key, { family: w.family, at: now });
      if (!isWarm || cfg.notify[w.family] === false) continue;
      raised.push(w);
      if (this.overCap(now)) { suppressed++; continue; }
      this.sentAt.push(now);
      this.notify(w.title, w.message);
    }
    if (suppressed > 0) this.notify(`${suppressed} more alert${suppressed === 1 ? '' : 's'}`, 'See the dashboard');
    for (const [key, f] of this.fired) {
      const isExpired = STICKY.has(f.family) ? now - f.at > STICKY_TTL_MS : !holding.has(key);
      if (isExpired) this.fired.delete(key);
    }
    return raised;
  }
}
