// What the 3D farm's animals and farmers say to each other, and to you: who is near whom (talkers), a few lines in
// each one's voice about what is happening (exchange), and conversations over time, as bubbles (createTalk). No
// three.js: app.js gives it the scene (where everyone is, what is happening) and draws its bubbles; the tests run it.
// Haiku's exchanges (the ✨ Helper's, through the collector) come in by take() and are used when they fit who is
// talking; otherwise its own lines. It never touches an agent: a farmer only says lines here, and only one that isn't
// waiting on you.

/**
 * Each one's voice, by situation: idle, night, rain, snow, deployFailed, deployOk, arrive, reply (an answer), you (to
 * you), and for a farmer working (by its step). Blanks: {name} the farmer, {repo} its repo, {step} what it is doing
 * (editing, running…), {animal} the animal it talks with. 60 characters at most with the blanks filled.
 */
export const VOICES = {
  cow: {
    idle: ['Grass again. Lovely.', 'Moo. That means hello.', 'I could chew this all day. I will.', 'Nice fence. Very fencey.', 'Have you tried lying down? Bliss.'],
    night: ['Moo… night already?', 'Counting sheep. We have no sheep.'],
    rain: ['Rain is just sky grass water.', 'Wet grass tastes greener.'],
    snow: ['Cold hooves, warm heart.', 'Is the grass under there?'],
    deployFailed: ['{repo} fell over? Chew on it a while.', 'Moo. Someone check {repo}.'],
    deployOk: ['{repo} is out. Moo-velous.', 'Good grass, good deploy.'],
    arrive: ['Someone new! Moo!'],
    reply: ['Moo, quite.', 'If you say so.', 'Mm-hm. Chewing.', 'True. Grass is true.'],
    you: ['Moo? Oh, hello you.', 'You look like you need grass.'],
  },
  bull: {
    idle: ['Hmph.', 'This is MY patch.', 'I am not grumpy. I am thorough.', 'Who moved the fence?', 'Snort.'],
    night: ['Nobody move till morning.', 'I sleep standing. Strong.'],
    rain: ['Rain does not scare me.', 'Hmph. Wet.'],
    snow: ['Snow. Hmph.', 'I will headbutt the winter.'],
    deployFailed: ['Who broke {repo}? Hmph.', '{repo} needs a firm word.'],
    deployOk: ['{repo} works. As it should.', 'Hmph. Fine. Good job.'],
    reply: ['Hmph.', 'Agreed. Grudgingly.', 'Do not push it.', 'Snort. Fine.'],
    you: ['What? Hmph.', 'You. Stand back a bit.'],
  },
  alpaca: {
    idle: ['Have you seen my fluff today?', 'I am fabulous and I know it.', 'Hum hum hum.', 'Spitting is a last resort.', 'My neck sees everything.'],
    night: ['Beauty sleep. Do not wake me.', 'Fluff and stars.'],
    rain: ['My fluff! Not the fluff!', 'Damp alpaca is sad alpaca.'],
    snow: ['Snow on fluff: very chic.', 'Built for this, darling.'],
    deployFailed: ['{repo} broke? How unfabulous.'],
    deployOk: ['{repo} shipped. Hum of joy.'],
    reply: ['Hum.', 'Darling, yes.', 'Fluffily agreed.', 'How very true.'],
    you: ['Admire the fluff. Go on.', 'Hum? Hello, lovely.'],
  },
  donkey: {
    idle: ['Hee-haw. That is all.', 'Kick first, ask later.', 'I am a donkey, not a horse.', 'Ears up, ears down. Busy day.', 'Got a carrot? No? Hmm.'],
    night: ['Hee… haw… sleepy.', 'Night. Ears down.'],
    rain: ['Rain on my ears. Rude.'],
    snow: ['Snow. My ears are cold.'],
    deployFailed: ['{repo} broke. Not my fault.', 'Kick {repo}. Works on fences.'],
    deployOk: ['{repo} out! Hee-haw!'],
    reply: ['Hee-haw.', 'Stubbornly agreed.', 'Nope. Fine, yes.', 'Ears say yes.'],
    you: ['Hee-haw! Carrot?', 'You again. Hi.'],
  },
  horse: {
    idle: ['Fancy a gallop?', 'Wind in my mane. Perfect.', 'Neigh. Means let us run.', 'I could do laps all day.', 'Fresh hay is the best.'],
    night: ['Rest now, run at dawn.', 'Stars over the pasture. Nice.'],
    rain: ['A good gallop dries you off.'],
    snow: ['Snow gallops are the best.'],
    deployFailed: ['{repo} stumbled. Back in the saddle.'],
    deployOk: ['{repo} crossed the line!'],
    reply: ['Neigh, right.', 'Quite so.', 'Race you to it.', 'Steady, yes.'],
    you: ['Neigh! Ride? No? Hello then.'],
  },
  whitehorse: {
    idle: ['I keep my coat this white.', 'Do not splash mud near me.', 'Elegance is a lot of work.', 'Brush me later, please.', 'A gentle trot is enough.'],
    night: ['I glow a little at night.', 'Moonlight suits me.'],
    rain: ['Mud season. Dreadful.'],
    snow: ['I blend in. Ha.'],
    deployFailed: ['{repo} again? Do keep up.'],
    deployOk: ['{repo} out. Very elegant.'],
    reply: ['Indeed.', 'Naturally.', 'How refined.', 'Quite right.'],
    you: ['Hello. Mind the mud.'],
  },
  deer: {
    idle: ['Shh. I am listening.', 'Was that a twig?', 'The forest smells of moss.', 'I only come out for the clover.', 'Soft steps, soft ears.'],
    night: ['Night is when I wander.', 'The forest whispers at night.'],
    rain: ['Rain hides my steps.'],
    snow: ['Tracks in the snow. Mine.'],
    deployFailed: ['Something broke. {repo}?'],
    deployOk: ['{repo} is out. Quietly happy.'],
    reply: ['Shh, yes.', 'Gently, yes.', 'Mm.', 'Softly agreed.'],
    you: ['Oh! You startled me.'],
  },
  stag: {
    idle: ['Behold, my antlers.', 'This edge of the forest is mine.', 'I bow to no fence.', 'Majestic. As usual.', 'I heard a branch. It feared me.'],
    night: ['The night bows to me.', 'I keep watch.'],
    rain: ['Rain only polishes antlers.'],
    snow: ['Antlers in the snow. Grand.'],
    deployFailed: ['{repo} has fallen. Rise again.'],
    deployOk: ['{repo} stands tall. Like me.'],
    reply: ['So it is.', 'As I said.', 'Majestically agreed.', 'Hmm. Noble.'],
    you: ['You stand before a stag.'],
  },
  fox: {
    idle: ['I know where the hens are.', 'Clever is my middle name.', 'Shh. Mice under the snow.', 'I was never here.', 'Sly? Me? Never.'],
    night: ['Night is my day.', 'The henhouse is quiet. Hmm.'],
    rain: ['Wet fur, sharp mind.'],
    snow: ['Pounce! Missed. Again.'],
    deployFailed: ['{repo} broke? I saw nothing.'],
    deployOk: ['{repo} shipped. Clever lot.'],
    reply: ['Mm, cunning.', 'I knew that.', 'Shh, yes.', 'Sly agreement.'],
    you: ['I was not near the hens.'],
  },
  wolf: {
    idle: ['I am just a big dog. Honest.', 'Awoo… practising.', 'The pack is busy. So am I.', 'Do not mind the teeth.', 'I smell sheep. None here.'],
    night: ['Moon! Awoooo!', 'The night is long. Good.'],
    rain: ['Rain hides the scent.'],
    snow: ['Snow is my blanket.'],
    deployFailed: ['{repo} limps. The pack helps.'],
    deployOk: ['{repo} hunts well today.'],
    reply: ['Awoo, yes.', 'The pack agrees.', 'Grr. Fine.', 'True.'],
    you: ['Awoo. Hello, two-legs.'],
  },
  husky: {
    idle: ['Run? Run! Let us run!', 'I am a good dog. The best.', 'Snow would be nice. Any snow?', 'Throw something! Anything!', 'AWOO! Sorry. Excited.'],
    night: ['Sleepy… but ready to run.', 'I guard the yard. Zzz.'],
    rain: ['Puddles! Best day!'],
    snow: ['SNOW! FINALLY! ZOOMIES!'],
    deployFailed: ['{repo} broke? I will fetch it!'],
    deployOk: ['{repo} shipped! Tail wags!'],
    arrive: ['New friend! New friend!'],
    reply: ['Yes! Yes yes!', 'Woof!', 'Wag wag.', 'Agreed! Run now?'],
    you: ['Hi! Hi! Stick? Have a stick?'],
  },
  shiba: {
    idle: ['Much farm. Very grass.', 'I am too cute to work.', 'Such sky. Wow.', 'I nap, therefore I am.', 'Treat? Treat. Treat!'],
    night: ['Very night. Much sleep.'],
    rain: ['Wet. Very no.'],
    snow: ['Snow. Much cold. Wow.'],
    deployFailed: ['{repo} broke. Much sad.'],
    deployOk: ['{repo} ship. Very wow.'],
    reply: ['Wow.', 'Much agree.', 'Very yes.', 'Such true.'],
    you: ['Wow. A human. Treat?'],
  },
  frog: {
    idle: ['Ribbit. I own this pad.', 'Flies taste of sunshine.', 'I am the king of the pond.', 'Croak. Means good day.', 'Hop, sit, ribbit, repeat.'],
    night: ['Night chorus: ribbit ribbit!', 'The moon on the water. Mine.'],
    rain: ['Rain! Best weather ever!'],
    snow: ['Zzz. Wake me in spring.'],
    deployFailed: ['{repo} sank? Ribbit.'],
    deployOk: ['{repo} leapt out! Ribbit!'],
    reply: ['Ribbit.', 'Croak, yes.', 'Obviously.', 'Ribbit, quite.'],
    you: ['Ribbit. Kiss me? No? Fine.'],
  },
  trout: {
    idle: ['Blub.', 'Swim, swim, swim.', 'The water is perfect.', 'I jumped once. Twice!'],
    night: ['Blub… sleepy blub.'],
    reply: ['Blub.', 'Blub blub.', 'Swimmingly.'],
    you: ['Blub? Hello up there.'],
  },
  koi: {
    idle: ['I am the prettiest fish.', 'Orange is my colour.', 'Bubbles for luck.', 'I glide. I do not swim.'],
    night: ['Even at night, I sparkle.'],
    reply: ['Blub, darling.', 'Bubbles agree.', 'Gracefully.'],
    you: ['Admire my scales. Blub.'],
  },
  roach: {
    idle: ['Just a fish. A shy one.', 'Red fins. My best side.', 'Under the pad is cosy.', 'Blub. Hi.'],
    night: ['Night. Hide under a pad.'],
    reply: ['Blub.', 'Mm, blub.', 'Quietly yes.'],
    you: ['Blub! Do not look at me.'],
  },
  farmer: {
    idle: ['Morning, {animal}.', 'Nice day for it, {animal}.', 'Taking five, {animal}.', 'You lot have it easy.', 'Hey {animal}, how goes it?'],
    working: ['{step} in {repo}, {animal}.', 'Busy with {repo}, {animal}.', '{step} away. Talk later.', 'Almost done with {repo}.'],
    night: ['Late one, {animal}. Night.', 'Lights on in {repo}.'],
    rain: ['Rain on {repo} again.', 'Wet one today, {animal}.'],
    snow: ['Cold out, {animal}.'],
    deployFailed: ['{repo} did not deploy. Ugh.', 'Back to {repo}. It broke.'],
    deployOk: ['{repo} is out, {animal}!', 'Shipped {repo}. Feels good.'],
    reply: ['Ha, fair.', 'Right you are.', 'Can not argue.', 'Good one, {animal}.'],
    you: ['Hi there.'],
  },
};

const SPEAKER_NEAR = 48; // animals within 6 m talk
const FARMER_NEAR = 64; // a farmer and an animal within 8 m (over a fence is fine)
const BUSY = new Set(['waiting', 'yourTurn', 'turn', 'stale']); // a farmer who needs you, whose turn ended, or a scarecrow, isn't drawn into chatter
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = t => t.i ?? t.id ?? t.kind;

/** Pairs who could talk now, nearest first: two animals near each other; a farmer (not waiting on you) and an animal near it. */
export function talkers(scene) {
  const out = [], animals = scene?.animals ?? [], farmers = (scene?.farmers ?? []).filter(f => !BUSY.has(f.state));
  for (let i = 0; i < animals.length; i++) for (let j = i + 1; j < animals.length; j++) if (dist(animals[i], animals[j]) <= SPEAKER_NEAR) out.push([animals[i], animals[j], dist(animals[i], animals[j])]);
  for (const f of farmers) for (const a of animals) if (dist(f, a) <= FARMER_NEAR) out.push([f, a, dist(f, a)]);
  return out.sort((p, q) => p[2] - q[2]).map(([a, b]) => [a, b]);
}

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];
/** A name as said: 16 characters at most, and never a path (only its last part). */
const short = v => { const s = String(v ?? ''), parts = s.split(/[\\/]/).filter(Boolean); return (parts.at(-1) ?? s).slice(0, 16); };
/** A voice's line for a situation (its idle line if it has none), its blanks filled. */
function line(t, other, when, facts, rand) {
  const v = VOICES[t.kind ?? 'farmer'] ?? VOICES.cow, list = v[when]?.length ? v[when] : v.idle;
  const event = facts?.events?.[0];
  const words = { name: short(t.name), repo: short(t.repo ?? event?.repo ?? 'the farm'), step: short(t.step ?? 'working'), animal: short(other?.kind ?? other?.name ?? 'friend') };
  return pick(list, rand).replace(/\{(\w+)\}/g, (_, k) => words[k] ?? '').slice(0, 60);
}
/** What a conversation is about now: a fresh event, the night, the weather, or nothing much. */
function situation(facts, rand) {
  const event = facts?.events?.[0];
  if (event && rand() < 0.6) return event.kind;
  if (facts?.night) return 'night';
  if (facts?.weather && rand() < 0.6) return facts.weather;
  return 'idle';
}

/** An exchange between two (the first speaks first): 2 to 4 lines in turn, each in its own voice. */
export function exchange([a, b], facts, rand) {
  const when = situation(facts, rand), n = 2 + Math.floor(rand() * 3), out = [];
  for (let k = 0; k < n; k++) {
    const t = k % 2 ? b : a, other = k % 2 ? a : b;
    const w = k === 0 ? (t.kind ? when : t.state === 'working' && when === 'idle' ? 'working' : when) : rand() < 0.6 ? 'reply' : t.kind ? when : 'idle';
    out.push({ who: keyOf(t), text: line(t, other, w, { ...facts, events: t.repo ? [{ repo: t.repo }] : facts?.events }, rand) });
  }
  return out;
}

const LINE_S = 3.5; // how long a line shows
const GAP_S = 40; // about how often a conversation starts by itself
/**
 * The conversations under way: `tick(scene, dt)` moves them on (and now and then starts one), `start(i, scene)` is the
 * Talk button (animal i talks to the nearest in range, or to you), `take(exchanges)` keeps Haiku's for when they fit,
 * `bubbles()` what shows now: { who (an animal's index or a farmer's id), text, toYou?, conversation, to? }.
 */
export function createTalk({ rand = Math.random } = {}) {
  let talks = [], stockList = [], wait = GAP_S * (0.3 + rand() * 0.7), seq = 0, facts = {};
  /** Haiku's exchange for these two, if one fits (its speakers their kinds or names), taken once. */
  function fresh(a, b) {
    const name = t => t.kind ?? t.name, k = stockList.findIndex(ex => {
      const who = new Set(ex.lines.map(l => l.who));
      return who.size <= 2 && [...who].every(w => w === name(a) || w === name(b)) && who.has(name(a));
    });
    if (k < 0) return null;
    const ex = stockList.splice(k, 1)[0];
    const first = ex.lines[0].who === name(a) ? a : b;
    return ex.lines.map(l => ({ who: keyOf(l.who === name(first) ? first : first === a ? b : a), text: String(l.text).slice(0, 60) }));
  }
  function begin(a, b) {
    const ids = new Set([keyOf(a), keyOf(b)]);
    talks = talks.filter(c => !c.ids.some(id => ids.has(id))); // whoever is talking again stops the old one
    const lines = fresh(a, b) ?? exchange([a, b], facts, rand);
    talks.push({ n: ++seq, lines, ids: [...ids], to: { [keyOf(a)]: b, [keyOf(b)]: a }, at: 0 });
    if (talks.length > 2) talks.shift();
  }
  return {
    tick(scene, dt) {
      facts = scene?.facts ?? facts;
      for (const c of talks) c.at += dt;
      talks = talks.filter(c => c.at < c.lines.length * LINE_S);
      wait -= dt;
      if (wait > 0 || talks.length >= 2) return;
      wait = GAP_S * (0.5 + rand());
      const busy = new Set(talks.flatMap(c => c.ids)), pairs = talkers(scene).filter(([a, b]) => !busy.has(keyOf(a)) && !busy.has(keyOf(b)));
      if (pairs.length) { const [a, b] = pick(pairs.slice(0, 4), rand); rand() < 0.5 ? begin(a, b) : begin(b, a); }
    },
    start(i, scene) {
      facts = scene?.facts ?? facts;
      const me = (scene?.animals ?? []).find(a => a.i === i);
      if (!me) return;
      const near = talkers(scene).filter(p => p.some(t => t === me)).map(p => (p[0] === me ? p[1] : p[0]))[0];
      if (near) { begin(me, near); return; }
      talks = talks.filter(c => !c.ids.includes(i));
      talks.push({ n: ++seq, lines: [{ who: i, text: line(me, null, 'you', facts, rand), toYou: true }], ids: [i], to: {}, at: 0 });
      if (talks.length > 2) talks.shift();
    },
    take(exchanges) {
      for (const ex of exchanges ?? []) if (Array.isArray(ex?.lines) && ex.lines.length >= 2) stockList.push({ lines: ex.lines.filter(l => l && typeof l.text === 'string').slice(0, 4) });
      stockList = stockList.slice(-24);
    },
    stock: () => stockList.length,
    bubbles: () => talks.map(c => {
      const l = c.lines[Math.min(c.lines.length - 1, Math.floor(c.at / LINE_S))];
      return { who: l.who, text: l.text, ...(l.toYou ? { toYou: true } : {}), conversation: c.n, to: c.to[l.who] ?? null };
    }),
  };
}
