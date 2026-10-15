import {
  ad,
  biquad,
  brown,
  buf,
  drive,
  env,
  finish,
  gain,
  loopable,
  mix,
  osc,
  pink,
  reverb,
  rng,
  white,
  type Buf,
} from './synth';

/**
 * Placeholder sound effects, synthesised. Names match the keys the game plays
 * (client/src/audio/sounds.ts); `_1`, `_2` ... are random variants.
 */

// ---------------------------------------------------------------- building blocks

/** Short wooden knock: a few decaying resonances plus a noise click. */
function knock(seed: number, pitch = 1, decay = 0.08, body = 1): Buf {
  const len = decay * 6;
  const modes = [180, 410, 730, 1150].map((f) => f * pitch);
  const parts = modes.map((f, i) => env(osc(len, () => f * (1 + 0.02 * i)), ad(0.001, decay / (1 + i * 0.6))));
  const click = env(biquad(white(0.03, seed), 'bandpass', 2400 * pitch, 1.2), ad(0.0005, 0.006));
  return mix(...parts.map((p, i) => gain(p, (i === 0 ? 0.9 : 0.5 / i) * body)), gain(click, 0.6));
}

/** Low thump (feet, objects on planks). */
function thud(seed: number, weight = 1): Buf {
  const len = 0.25 + weight * 0.1;
  const tone = env(osc(len, (t) => 95 * (1 - t * 0.6) * (1.2 - weight * 0.2)), ad(0.002, 0.05 + weight * 0.03));
  const n = env(biquad(brown(len, seed), 'lowpass', 500 + weight * 200), ad(0.001, 0.04 + weight * 0.02));
  return mix(gain(tone, 0.8), gain(n, 1.2), gain(knock(seed + 9, 0.8, 0.03, 0.4), 0.5));
}

/** Water splash: noise burst with a falling lowpass, plus droplets. */
function splash(seed: number, size: number): Buf {
  const len = 0.5 + size * 0.9;
  const r = rng(seed);
  const body = env(
    biquad(white(len, seed), 'lowpass', (t) => 5000 * Math.exp(-t * (3 / size)) + 300),
    (t) => (t < 0.01 ? t / 0.01 : Math.exp(-t / (0.12 + size * 0.25))),
  );
  const drops: [Buf, number][] = [];
  for (let i = 0; i < 6 + size * 10; i++) {
    const f = 900 + r() * 1800;
    const d = env(osc(0.06, (t) => f * (1 + t * 8)), ad(0.001, 0.015));
    drops.push([gain(d, 0.12 + r() * 0.15), 0.05 + r() * (len * 0.8)]);
  }
  return mix(gain(body, 1), ...drops);
}

/** A wooden creak: rough sawtooth at a wandering low pitch through a resonant band. */
function creak(seed: number, seconds: number, pitch: number): Buf {
  const r = rng(seed);
  const wobble = [r() * 6, r() * 6, r() * 6];
  const f = (t: number) => pitch * (1 + 0.25 * Math.sin(t * 7 + wobble[0]!) + 0.12 * Math.sin(t * 23 + wobble[1]!)) * (1 + t * 0.4);
  // stick-slip: the tone is chopped into tiny grains
  const grains = osc(seconds, (t) => 28 + 18 * Math.sin(t * 3 + wobble[2]!), 'square');
  const tone = osc(seconds, f, 'saw');
  for (let i = 0; i < tone.length; i++) tone[i]! *= 0.55 + 0.45 * grains[i]!;
  const shaped = biquad(biquad(tone, 'bandpass', (t) => 600 + 300 * Math.sin(t * 2 + wobble[0]!), 3), 'highpass', 150);
  return env(shaped, (t) => Math.sin(Math.min(1, t / seconds) * Math.PI) ** 0.7);
}

// ---------------------------------------------------------------- sounds

type Sound = { name: string; data: Buf };

function effects(): Sound[] {
  const out: Sound[] = [];
  const add = (name: string, data: Buf, peak = 0.8) => out.push({ name, data: finish(data, peak) });

  // footsteps on planks (4 variants), ladder rungs, jump / land
  for (let i = 1; i <= 4; i++) add(`step_${i}`, mix(gain(thud(10 + i, 0.4), 0.8), gain(knock(20 + i, 1.2 + i * 0.08, 0.025, 0.6), 0.5)), 0.5);
  for (let i = 1; i <= 2; i++) add(`ladder_${i}`, knock(30 + i, 1.5 + i * 0.1, 0.04, 1), 0.45);
  add('jump', mix(gain(env(biquad(white(0.18, 40), 'bandpass', (t) => 900 + t * 3000, 1.5), ad(0.02, 0.05)), 0.6), gain(thud(41, 0.3), 0.6)), 0.5);
  add('land', thud(42, 1.2), 0.75);

  // objects
  add('pickup', mix(knock(50, 1.6, 0.03, 0.8), [gain(env(biquad(white(0.08, 51), 'bandpass', 2000, 2), ad(0.005, 0.02)), 0.3), 0.01]), 0.5);
  add('drop', mix(thud(52, 0.9), [knock(53, 1.1, 0.05, 0.8), 0.02]), 0.7);
  add('station', mix(knock(54, 1.0, 0.05, 1), [knock(55, 1.3, 0.04, 0.6), 0.07]), 0.55);

  // hatch: open = creak + clunk, close = clunk + thump
  add('hatch_open', mix(gain(creak(60, 0.35, 140), 0.5), [thud(61, 0.8), 0.28], [knock(62, 0.9, 0.06, 1), 0.3]), 0.7);
  add('hatch_close', mix(thud(63, 1.3), knock(64, 0.85, 0.08, 1.2), [gain(creak(65, 0.2, 180), 0.3), 0.0]), 0.8);

  // pump: iron squeak + a gush of water
  add(
    'pump',
    mix(
      gain(env(biquad(osc(0.3, (t) => 900 + 500 * Math.sin(t * 18) - t * 600, 'saw'), 'bandpass', 1400, 4), ad(0.02, 0.1)), 0.35),
      [gain(splash(70, 0.35), 0.8), 0.12],
      [knock(71, 0.7, 0.05, 0.8), 0.0],
    ),
    0.7,
  );

  // leak: wood cracks, water starts
  add(
    'leak_start',
    mix(
      gain(env(biquad(white(0.5, 80), 'bandpass', 1800, 0.8), (t) => Math.exp(-t / 0.06) * (1 + Math.sin(t * 900) * 0.3)), 1),
      [knock(82, 0.6, 0.12, 1.4), 0.0],
      [gain(splash(83, 0.6), 0.7), 0.15],
    ),
    0.85,
  );

  // repair: hammer blows, done = three knocks + a little chord
  for (let i = 1; i <= 3; i++) add(`hammer_${i}`, mix(knock(90 + i, 2.2 + i * 0.1, 0.05, 1), gain(env(osc(0.2, () => 2900 + i * 120), ad(0.001, 0.03)), 0.25)), 0.7);
  {
    const chord = [523.25, 659.25, 783.99].map((f, i) => [env(osc(1.2, () => f, 'tri'), ad(0.01, 0.35)), 0.25 + i * 0.07] as [Buf, number]);
    add('repaired', mix(knock(95, 2.2, 0.05), [knock(96, 2.3, 0.05), 0.12], ...chord.map(([b, at]) => [gain(b, 0.25), at] as [Buf, number])), 0.6);
  }

  // splashes
  add('splash_small', splash(100, 0.4), 0.55);
  add('splash_big', splash(101, 1.2), 0.85);

  // cannon: crack + falling boom + rumble tail
  {
    const boom = env(osc(1.6, (t) => 85 * Math.exp(-t * 2.2) + 32), ad(0.003, 0.35));
    const crack = env(biquad(white(0.3, 110), 'lowpass', (t) => 7000 * Math.exp(-t * 18) + 400), ad(0.001, 0.06));
    const rumble = env(biquad(brown(1.8, 111), 'lowpass', 300), ad(0.01, 0.6));
    add('cannon', reverb(drive(mix(gain(boom, 1.2), gain(crack, 1.3), gain(rumble, 1.4)), 2.2), 0.35, 1.3, 1), 0.95);
  }

  // rocks: hull crunch, rock breaking
  {
    const crunch = env(biquad(white(1.2, 120), 'bandpass', (t) => 900 - t * 500, 0.7), (t) => Math.exp(-t / 0.25) * (0.6 + 0.4 * Math.sin(t * 140) ** 2));
    const hit = mix(gain(thud(121, 2.5), 1.4), gain(crunch, 1), [gain(creak(122, 0.9, 90), 0.6), 0.15], [knock(123, 0.5, 0.15, 1.5), 0.0]);
    add('rock_hit', reverb(drive(hit, 1.8), 0.25, 1.1, 0.8), 0.95);
    const r = rng(124);
    const bits: [Buf, number][] = [];
    for (let i = 0; i < 14; i++) bits.push([gain(knock(125 + i, 1.8 + r() * 1.5, 0.02, 0.6), 0.4 + r() * 0.4), r() * 0.5]);
    add('rock_break', mix(gain(env(biquad(white(0.7, 140), 'lowpass', 2500), ad(0.002, 0.15)), 0.8), gain(thud(141, 1.5), 0.8), ...bits), 0.85);
  }

  // kraken: a growl (formant-filtered saw with wobble), a squelch when hit
  {
    const growl = (seed: number, seconds: number, pitch: number) => {
      const r = rng(seed);
      const p = r() * 5;
      const src = osc(seconds, (t) => pitch * (1 + 0.15 * Math.sin(t * 9 + p) + 0.08 * Math.sin(t * 31)) * (1 - t * 0.15), 'saw');
      const noise = gain(brown(seconds, seed + 1), 0.6);
      const raw = mix(src, noise);
      const f1 = biquad(raw, 'bandpass', (t) => 420 + 160 * Math.sin(t * 2.5 + p), 4);
      const f2 = biquad(raw, 'bandpass', (t) => 900 + 300 * Math.sin(t * 1.7), 5);
      return env(drive(mix(gain(f1, 1.4), gain(f2, 0.7), gain(biquad(raw, 'lowpass', 200), 0.8)), 2.5), (t) => Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - seconds * 0.55) / 0.35));
    };
    add('kraken_roar', reverb(growl(150, 2.2, 62), 0.4, 1.4, 1.2), 0.9);
    add('kraken_hit', mix(gain(env(biquad(white(0.4, 160), 'lowpass', (t) => 1500 - t * 2500), ad(0.005, 0.07)), 1), [gain(growl(161, 0.6, 110), 0.7), 0.05], gain(thud(162, 1), 0.6)), 0.85);
  }

  // ping: a clear bell blip (two partials), shout: a short chirp
  {
    const bell = (f: number) => mix(gain(env(osc(0.9, () => f), ad(0.002, 0.22)), 0.7), gain(env(osc(0.9, () => f * 2.76), ad(0.002, 0.08)), 0.25), gain(env(osc(0.9, () => f * 5.4), ad(0.001, 0.03)), 0.1));
    add('ping', reverb(mix(bell(1046.5), [bell(1568), 0.09]), 0.25, 0.8, 0.4), 0.55);
    add('shout', mix(gain(env(osc(0.18, (t) => 520 + t * 1800, 'tri'), ad(0.01, 0.06)), 0.7), [gain(env(osc(0.14, (t) => 780 + t * 1500, 'tri'), ad(0.01, 0.05)), 0.5), 0.07]), 0.45);
    add('ui_click', knock(170, 3, 0.012, 0.6), 0.35);
  }

  // weather and ending
  add('thunder', reverb(mix(gain(env(biquad(white(0.4, 180), 'lowpass', 4000), ad(0.002, 0.05)), 0.8), [env(biquad(brown(3.5, 181), 'lowpass', (t) => 220 - t * 40), (t) => Math.min(1, t / 0.2) * Math.exp(-t / 1.1) * (0.7 + 0.3 * Math.sin(t * 5) ** 2)), 0.05]), 0.3, 1.5, 1), 0.9);
  {
    // foghorn: two detuned saws, slow swell
    const horn = mix(osc(3, () => 110, 'saw'), osc(3, () => 110.7, 'saw'), gain(osc(3, () => 220.4, 'saw'), 0.4));
    add('foghorn', reverb(env(biquad(horn, 'lowpass', 700, 1.2), (t) => Math.min(1, t / 0.35) * (t > 2.2 ? Math.exp(-(t - 2.2) / 0.25) : 1)), 0.35, 1.5, 1.2), 0.8);
  }
  {
    // arrival fanfare: C-E-G-C' on a soft square with echo
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const parts = notes.map((f, i) => [env(biquad(osc(0.9, () => f, 'square'), 'lowpass', 2400), ad(0.01, 0.25)), i * 0.16] as [Buf, number]);
    const final = [env(biquad(mix(osc(1.6, () => 523.25, 'square'), osc(1.6, () => 659.25, 'square'), osc(1.6, () => 783.99, 'square')), 'lowpass', 1800), ad(0.02, 0.6)), 0.7] as [Buf, number];
    add('arrive', reverb(mix(...parts.map(([b, at]) => [gain(b, 0.4), at] as [Buf, number]), [gain(final[0], 0.35), final[1]]), 0.35, 1.2, 1), 0.7);
  }
  add('sink', reverb(mix(gain(env(osc(2.2, (t) => 220 * Math.exp(-t * 0.9), 'tri'), ad(0.05, 0.9)), 0.6), gain(splash(190, 1.4), 0.8)), 0.4, 1.4, 1), 0.8);

  // phase 5: saw, crates, coins, rat, fire, steam, wave, hook, ring, loading, oil
  for (let i = 1; i <= 2; i++) {
    const rasp = env(biquad(white(0.32, 400 + i), 'bandpass', (t) => 2600 + (i === 1 ? 1 : -1) * t * 1800, 2.5), (t) => Math.sin(Math.min(1, t / 0.32) * Math.PI) * (0.6 + 0.4 * Math.sin(t * 220) ** 2));
    add(`saw_${i}`, mix(gain(rasp, 1), gain(knock(402 + i, 1.4, 0.02, 0.4), 0.3)), 0.5);
  }
  {
    const squeal = env(biquad(osc(0.35, (t) => 1500 + 900 * Math.sin(t * 30) + t * 800, 'saw'), 'bandpass', 2200, 6), ad(0.02, 0.12));
    add('crate_open', mix(gain(creak(410, 0.5, 160), 0.7), [gain(squeal, 0.35), 0.25], [thud(411, 0.9), 0.5], [knock(412, 0.9, 0.06, 1), 0.52]), 0.75);
    const r = rng(413);
    const clinks: [Buf, number][] = [];
    for (let i = 0; i < 9; i++) {
      const f = 2800 + r() * 2200;
      clinks.push([gain(mix(env(osc(0.25, () => f), ad(0.001, 0.05)), gain(env(osc(0.25, () => f * 1.52), ad(0.001, 0.03)), 0.5)), 0.4 + r() * 0.3), r() * 0.35]);
    }
    add('coins', reverb(mix(...clinks), 0.2, 0.6, 0.3), 0.55);
    add('rat', mix(gain(env(osc(0.12, (t) => 3200 + Math.sin(t * 160) * 600, 'tri'), ad(0.005, 0.05)), 0.6), [gain(env(osc(0.1, (t) => 3600 - t * 4000, 'tri'), ad(0.005, 0.04)), 0.5), 0.15]), 0.45);
  }
  {
    const whoosh = env(biquad(white(0.7, 420), 'bandpass', (t) => 400 + t * 1600, 0.8), ad(0.05, 0.25));
    add('fire_start', mix(gain(whoosh, 1), [gain(env(biquad(brown(0.6, 421), 'lowpass', 600), ad(0.02, 0.2)), 0.8), 0.05]), 0.7);
    add('steam', env(biquad(white(0.9, 422), 'highpass', (t) => 2000 + t * 2000), (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.3)), 0.55);
  }
  add('wave_crash', reverb(mix(gain(splash(430, 2.2), 1.2), gain(env(biquad(brown(2, 431), 'lowpass', 400), ad(0.05, 0.6)), 1)), 0.35, 1.2, 0.9), 0.9);
  add('hook', mix(gain(env(osc(0.5, () => 1320), ad(0.001, 0.12)), 0.4), gain(env(osc(0.5, () => 1980), ad(0.001, 0.06)), 0.25), knock(440, 1.6, 0.04, 1), [thud(441, 0.6), 0.03]), 0.7);
  add('ring_throw', env(biquad(white(0.45, 450), 'bandpass', (t) => 900 + 1200 * Math.sin(t * 6), 1.2), ad(0.03, 0.18)), 0.5);
  add('cannon_load', mix(gain(env(osc(0.4, () => 620), ad(0.001, 0.08)), 0.3), knock(460, 0.7, 0.07, 1.2), [thud(461, 1), 0.08]), 0.7);
  {
    const glug: [Buf, number][] = [];
    for (let i = 0; i < 6; i++) glug.push([gain(env(osc(0.12, (t) => 260 + i * 25 + t * 900), ad(0.005, 0.05)), 0.5), i * 0.11]);
    add('glug', mix(...glug), 0.55);
  }

  // ship creaks (random one-shots over the sea)
  for (let i = 1; i <= 4; i++) add(`creak_${i}`, creak(200 + i, 0.6 + i * 0.25, 70 + i * 22), 0.5);
  return out;
}

/** Ambience loops (seamless). */
function loops(): Sound[] {
  const out: Sound[] = [];
  // sea: deep rumble + slow washing waves
  {
    const len = 12;
    const base = biquad(brown(len + 2, 300), 'lowpass', 380);
    const wash = biquad(pink(len + 2, 301), 'bandpass', (t) => 700 + 400 * Math.sin(t * 0.9), 0.6);
    const swell = (t: number) => 0.35 + 0.65 * Math.max(0, Math.sin((t / (len + 2)) * Math.PI * 2 * 5 + 1)) ** 2;
    out.push({ name: 'loop_sea', data: loopable(mix(gain(base, 1), env(gain(wash, 0.9), swell)), 2, 0.6) });
  }
  // wind: whistling band-passed noise, gusting
  {
    const len = 10;
    const n = pink(len + 2, 310);
    const howl = biquad(n, 'bandpass', (t) => 520 + 260 * Math.sin(t * 0.7) + 120 * Math.sin(t * 2.3), 6);
    const rush = biquad(n, 'highpass', 900);
    const gust = (t: number) => 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.8 + Math.sin(t * 0.33) * 2));
    out.push({ name: 'loop_wind', data: loopable(env(mix(gain(howl, 2.2), gain(rush, 0.5)), gust), 2, 0.6) });
  }
  // rain: dense crackle + hiss
  {
    const len = 6;
    const r = rng(320);
    const b = buf(len + 1);
    for (let i = 0; i < b.length; i++) if (r() < 0.06) b[i] = (r() * 2 - 1) * (0.3 + r());
    const crackle = biquad(b, 'highpass', 1500);
    const hiss = biquad(white(len + 1, 321), 'bandpass', 5000, 0.5);
    out.push({ name: 'loop_rain', data: loopable(mix(gain(crackle, 1), gain(hiss, 0.35)), 1, 0.5) });
  }
  // leak: spray hiss + gurgling bubbles
  {
    const len = 3;
    const r = rng(330);
    const hiss = biquad(white(len + 0.5, 331), 'bandpass', (t) => 2600 + 600 * Math.sin(t * 11), 1.2);
    const bubbles: [Buf, number][] = [];
    for (let i = 0; i < 40; i++) {
      const f = 300 + r() * 500;
      bubbles.push([gain(env(osc(0.08, (t) => f * (1 + t * 12)), ad(0.002, 0.02)), 0.3 + r() * 0.3), r() * len]);
    }
    // fire: crackle (random pops) over a soft roar
    {
      const len2 = 3;
      const r2 = rng(470);
      const pops: [Buf, number][] = [];
      for (let i = 0; i < 70; i++) pops.push([gain(env(biquad(white(0.02, 471 + i), 'bandpass', 1500 + r2() * 3000, 1.5), ad(0.0005, 0.006)), 0.3 + r2() * 0.7), r2() * (len2 - 0.05)]);
      const roar = biquad(brown(len2 + 1, 472), 'lowpass', 500);
      out.push({ name: 'loop_fire', data: finish(loopable(mix(gain(roar, 0.8), ...pops), 0.5, 0.5), 0.6) });
    }
    out.push({ name: 'loop_leak', data: loopable(mix(gain(hiss, 0.8), ...bubbles), 0.5, 0.55) });
  }
  return out;
}

export function drawSounds(): Sound[] {
  return [...effects(), ...loops()];
}

