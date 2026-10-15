/**
 * A tiny offline synthesizer for placeholder sound effects: noise, oscillators,
 * filters, envelopes, a small reverb and a 16-bit WAV encoder. Everything is
 * deterministic (seeded noise), so `npm run assets` always produces the same files.
 */
export const RATE = 22050;

export type Buf = Float32Array;

export const buf = (seconds: number): Buf => new Float32Array(Math.max(1, Math.round(seconds * RATE)));

/** Seeded random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function white(seconds: number, seed: number): Buf {
  const r = rng(seed);
  const b = buf(seconds);
  for (let i = 0; i < b.length; i++) b[i] = r() * 2 - 1;
  return b;
}

/** Pink noise (Paul Kellet's filter). */
export function pink(seconds: number, seed: number): Buf {
  const w = white(seconds, seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < w.length; i++) {
    const x = w[i]!;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    w[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
  }
  return w;
}

/** Brown noise (integrated white noise). */
export function brown(seconds: number, seed: number): Buf {
  const w = white(seconds, seed);
  let last = 0;
  for (let i = 0; i < w.length; i++) {
    last = (last + 0.02 * w[i]!) / 1.02;
    w[i] = last * 3.5;
  }
  return w;
}

/** Oscillator with a frequency function (Hz over time in seconds). */
export function osc(seconds: number, freq: (t: number) => number, shape: 'sine' | 'saw' | 'square' | 'tri' = 'sine'): Buf {
  const b = buf(seconds);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE;
    ph += freq(t) / RATE;
    ph -= Math.floor(ph);
    switch (shape) {
      case 'sine':
        b[i] = Math.sin(ph * Math.PI * 2);
        break;
      case 'saw':
        b[i] = ph * 2 - 1;
        break;
      case 'square':
        b[i] = ph < 0.5 ? 1 : -1;
        break;
      case 'tri':
        b[i] = 1 - 4 * Math.abs(ph - 0.5);
        break;
    }
  }
  return b;
}

/** RBJ biquad filter; `freq` may change over time. */
export function biquad(input: Buf, type: 'lowpass' | 'highpass' | 'bandpass', freq: number | ((t: number) => number), q = 0.707): Buf {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  const f = typeof freq === 'number' ? () => freq : freq;
  for (let i = 0; i < input.length; i++) {
    if (i % 32 === 0) {
      const w0 = (2 * Math.PI * Math.min(RATE * 0.45, Math.max(10, f(i / RATE)))) / RATE;
      const cs = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      if (type === 'lowpass') {
        b0 = (1 - cs) / 2 / a0;
        b1 = (1 - cs) / a0;
        b2 = b0;
      } else if (type === 'highpass') {
        b0 = (1 + cs) / 2 / a0;
        b1 = -(1 + cs) / a0;
        b2 = b0;
      } else {
        b0 = alpha / a0;
        b1 = 0;
        b2 = -alpha / a0;
      }
      a1 = (-2 * cs) / a0;
      a2 = (1 - alpha) / a0;
    }
    const x = input[i]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Multiplies by an envelope function of time (seconds). */
export function env(b: Buf, e: (t: number) => number): Buf {
  for (let i = 0; i < b.length; i++) b[i]! *= e(i / RATE);
  return b;
}

/** Attack / exponential decay envelope. */
export const ad = (attack: number, decay: number) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

export function gain(b: Buf, g: number): Buf {
  for (let i = 0; i < b.length; i++) b[i]! *= g;
  return b;
}

/** Sums buffers (the result has the length of the longest), each with an optional start offset in seconds. */
export function mix(...parts: (Buf | [Buf, number])[]): Buf {
  const items = parts.map((p) => (Array.isArray(p) ? { b: p[0], at: Math.round(p[1] * RATE) } : { b: p, at: 0 }));
  const len = Math.max(...items.map((p) => p.at + p.b.length));
  const out = new Float32Array(len);
  for (const { b, at } of items) for (let i = 0; i < b.length; i++) out[at + i]! += b[i]!;
  return out;
}

export function concat(...parts: Buf[]): Buf {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Soft saturation. */
export function drive(b: Buf, amount: number): Buf {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i]! * amount) / Math.tanh(amount);
  return b;
}

/** Small Schroeder reverb (mono). `wet` 0..1, `size` ~0.5..1.5. */
export function reverb(input: Buf, wet: number, size = 1, tail = 1): Buf {
  const extra = Math.round(tail * RATE);
  const dry = new Float32Array(input.length + extra);
  dry.set(input);
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.round(d * size * (RATE / 44100)));
  const out = new Float32Array(dry.length);
  for (const d of combs) {
    const line = new Float32Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < dry.length; i++) {
      const y = line[idx]!;
      lp = y * 0.6 + lp * 0.4;
      line[idx] = dry[i]! + lp * 0.8;
      idx = (idx + 1) % d;
      out[i]! += y * 0.25;
    }
  }
  for (const d of [556, 441].map((x) => Math.round(x * (RATE / 44100)))) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const bufd = line[idx]!;
      const y = -out[i]! + bufd;
      line[idx] = out[i]! + bufd * 0.5;
      idx = (idx + 1) % d;
      out[i] = y;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = dry[i]! * (1 - wet * 0.5) + out[i]! * wet;
  return out;
}

/** Scales to a peak level and fades the last few ms to avoid clicks. */
export function finish(b: Buf, peak = 0.8): Buf {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? peak / m : 0;
  const fade = Math.min(b.length, Math.round(0.006 * RATE));
  for (let i = 0; i < b.length; i++) {
    let v = b[i]! * g;
    const fromEnd = b.length - 1 - i;
    if (fromEnd < fade) v *= fromEnd / fade;
    if (i < 32) v *= i / 32;
    b[i] = v;
  }
  return b;
}

/** Makes a buffer loop seamlessly: the last `fade` seconds are crossfaded into the start. */
export function loopable(b: Buf, fade: number, peak = 0.7): Buf {
  const n = Math.round(fade * RATE);
  const out = b.slice(0, b.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i]! * Math.sqrt(t) + b[b.length - n + i]! * Math.sqrt(1 - t);
  }
  let m = 0;
  for (const v of out) m = Math.max(m, Math.abs(v));
  return gain(out, m > 0 ? peak / m : 0);
}

/** 16-bit mono PCM WAV. */
export function encodeWav(b: Buf): Buffer {
  const data = Buffer.alloc(b.length * 2);
  for (let i = 0; i < b.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(b[i]! * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
