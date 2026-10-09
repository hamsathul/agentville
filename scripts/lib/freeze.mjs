// One moment in time and the same "random" numbers, set before any script of a page or a frame runs, so
// pictures repeat (scripts/world-golden.mjs, scripts/world-shots.mjs). Animations are held at their start.
export const freezeScript = now => `(() => {
  const NOW = ${now}, Real = Date;
  globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  let seed = 7;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // The "need you" button and the status dots pulse in CSS whatever the media query says: hold every animation at its start.
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.documentElement.append(s);
  });
})();`;
