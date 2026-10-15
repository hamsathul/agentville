// The farm's mood (spec 2026-10-15 alive §7, §8): clouds gather while agents wait on you (and the sky dims when three or
// more do), smoke rises from a farmhouse's chimney while its porch has someone on it, machines' headlights come on at
// night. Pure: build/life.js draws them, build/sky.js dims.
/** How many clouds for how many farmers waiting on you. */
export const cloudsFor = n => (n <= 0 ? 0 : n === 1 ? 2 : n === 2 ? 4 : 6);
/** How much the sky and the light dim (three or more waiting). */
export const dimFor = n => (n >= 3 ? 0.15 : 0);
/** The farms (0 yours, 1 the neighbour's) with someone on the porch (waiting, or their turn ended), in order. */
export const smokeFarms = farmers => [...new Set(farmers.filter(f => f.group === 'desk' || f.group === 'turn').map(f => f.farm ?? 0))].sort();
/** Whether the machines' headlights are on: at night. */
export const headlightsOn = night => night > 0.5;
