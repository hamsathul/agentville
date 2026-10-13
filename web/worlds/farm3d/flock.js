// Subagents on the 3D farm, by the 2D farm's rules (web/worlds/farm/world.js: follow, the henhouse's labels): each
// farmer's running subagents (four at most) follow it as hens, an Explore one as a dog that circles and sniffs; the
// henhouse keeps the eggs (subagents done lately) and the hens no farmer can lead. Pure: build/flock.js draws them.

/**
 * Where a farmer's kid k is, on the 2D map, at clock T: hens either side of it (the third and fourth a step behind),
 * swaying; the Explore dog round it, 30 px out (the 2D farm's follow, its distances the 3D map's).
 */
export function kidSpot([x, y], k, T, dog) {
  if (dog) return [x + Math.cos(T * 0.9 + k) * 30, y + 3 + Math.sin(T * 1.8) * 6];
  return [x + (k % 2 ? 1 : -1) * 10 + Math.sin(T * 1.3 + k) * 3, y + 2 - (k > 1 ? 8 : 0)];
}
/** The henhouse: its eggs (six at most), its roosting hens (three at most), and its labels with their tooltips. */
export function henhouseView(h) {
  const eggs = h?.eggs ?? 0, roosting = h?.roosting ?? 0;
  return {
    eggs: Math.min(6, eggs), roosting: Math.min(3, roosting),
    plus: roosting > 0 ? { text: `+${roosting}`, tip: `${roosting} more subagent${roosting === 1 ? '' : 's'} running than the farmers can lead` } : null,
    eggsLabel: eggs > 0 ? { text: `${eggs} egg${eggs === 1 ? '' : 's'}`, tip: 'Eggs: subagents that finished lately' } : null,
  };
}
