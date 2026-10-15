// The task fence drawn (fence.js says where): along the front of a field, a post for each stake, a flag in the
// agent's colour on each done one, a lantern hanging on the one in progress (glowing at night). Three instanced meshes
// over all fields; none casts a shadow.
import { makePool } from './util.js';
import { SOIL_Y } from './beds.js';

export function makeFence(THREE, mats, S) {
  const group = new THREE.Group(), m4 = new THREE.Matrix4(), c = new THREE.Color();
  const posts = makePool(THREE, group, new THREE.BoxGeometry(0.08, 1.1, 0.08).translate(0, 0.55, 0), mats.std('#8b5a2b'));
  const flags = makePool(THREE, group, new THREE.BoxGeometry(0.45, 0.3, 0.02).translate(0.225, 0, 0), mats.std('#ffffff'));
  const lanterns = makePool(THREE, group, new THREE.SphereGeometry(0.12, 8, 6), mats.glow('#ffe08a', '#ffd43b', { day: 0.6, night: 2.4 }));
  let shown = { stakes: 0, flags: 0, lanterns: 0 };
  /** The stakes (fenceOf's) on a ground H px tall. */
  function sync(stakes, H) {
    const nf = stakes.filter(s => s.done).length, nl = stakes.filter(s => s.lantern).length;
    posts.use(stakes.length); flags.use(nf); lanterns.use(nl); // room first: a pool that grows starts afresh
    let f = 0, l = 0;
    stakes.forEach((s, i) => {
      const p = S.at(s.x, s.y, H);
      posts.at(i, m4.makeTranslation(p.x, SOIL_Y - 0.05, p.z));
      if (s.done) flags.at(f++, m4.makeTranslation(p.x + 0.04, SOIL_Y + 0.92, p.z), c.set(s.colour ?? '#e04a3a'));
      if (s.lantern) lanterns.at(l++, m4.makeTranslation(p.x + 0.18, SOIL_Y + 0.75, p.z));
    });
    posts.flush(); flags.flush(); lanterns.flush();
    shown = { stakes: stakes.length, flags: nf, lanterns: nl };
  }
  return { group, sync, count: () => ({ ...shown }) };
}
