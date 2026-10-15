/**
 * Sound playback with the Web Audio API.
 *
 * - Files come from assets/sfx/ (list in index.json). Names ending in _1, _2 ...
 *   are variants of one sound and picked at random. A missing or broken file is
 *   simply silent, so sounds can be replaced or removed freely.
 * - Browsers (above all iOS Safari) only allow audio after a user gesture: the
 *   context is resumed on the first tap / click / key.
 * - Two busses: effects and ambience. The ambience bus has a lowpass that closes
 *   when the listener is below deck (muffled sea and storm).
 */
export interface PlayOptions {
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback rate (pitch). */
  rate?: number;
  /** Start delay in seconds. */
  delay?: number;
}

interface LoopVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const SETTINGS_KEY = 'lw.audio.v1';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private ambience!: GainNode;
  private muffle!: BiquadFilterNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly variants = new Map<string, string[]>();
  private readonly loops = new Map<string, LoopVoice>();
  private loading: Promise<void> | null = null;
  volume = 0.8;
  muted = false;

  constructor(private readonly base = 'assets/sfx/') {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { volume?: number; muted?: boolean };
      if (typeof s.volume === 'number') this.volume = Math.max(0, Math.min(1, s.volume));
      if (typeof s.muted === 'boolean') this.muted = s.muted;
    } catch {
      /* storage unavailable */
    }
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Creates / resumes the audio context (must happen inside a user gesture on iOS). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.fx = this.ctx.createGain();
      this.fx.connect(this.master);
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.muffle.connect(this.master);
      this.ambience = this.ctx.createGain();
      this.ambience.connect(this.muffle);
      this.applyVolume();
      // iOS: a silent buffer started inside the gesture really unlocks output
      const silent = this.ctx.createBufferSource();
      silent.buffer = this.ctx.createBuffer(1, 1, 22050);
      silent.connect(this.ctx.destination);
      silent.start();
      this.loading = this.load();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private async load(): Promise<void> {
    const ctx = this.ctx!;
    let names: string[] = [];
    try {
      names = (await (await fetch(`${this.base}index.json`)).json()) as string[];
    } catch {
      return;
    }
    await Promise.all(
      names.map(async (name) => {
        try {
          // an entry may name its file type ("loop_sea.m4a"), default is .wav
          const file = /\.\w+$/.test(name) ? name : `${name}.wav`;
          const id = name.replace(/\.\w+$/, '');
          const data = await (await fetch(`${this.base}${file}`)).arrayBuffer();
          const buffer = await new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(data, res, rej));
          this.buffers.set(id, buffer);
          const key = id.replace(/_\d+$/, '');
          if (key !== id) this.variants.set(key, [...(this.variants.get(key) ?? []), id]);
        } catch {
          /* missing or undecodable: stays silent */
        }
      }),
    );
  }

  private pick(name: string): AudioBuffer | null {
    const v = this.variants.get(name);
    const real = v && v.length ? v[Math.floor(Math.random() * v.length)]! : name;
    return this.buffers.get(real) ?? null;
  }

  /** Plays a one-shot sound effect. */
  play(name: string, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buffer = this.pick(name);
    if (!buffer) return;
    const vol = opts.volume ?? 1;
    if (vol < 0.01) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = vol;
    let node: AudioNode = g;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(this.fx);
    src.start(ctx.currentTime + (opts.delay ?? 0));
  }

  /** Sets the volume of an ambience loop (started on demand, smoothed). */
  loop(name: string, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let v = this.loops.get(name);
    if (!v) {
      if (volume < 0.005) return;
      const buffer = this.buffers.get(name);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.ambience);
      // start somewhere inside the loop so several loops do not line up
      source.start(0, Math.random() * buffer.duration);
      v = { source, gain };
      this.loops.set(name, v);
    }
    v.gain.gain.setTargetAtTime(Math.max(0, volume), ctx.currentTime, 0.25);
  }

  /** Below deck the sea and the storm sound muffled. */
  setMuffled(amount: number): void {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(600 / 20000, Math.max(0, Math.min(1, amount)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.3);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.save();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyVolume();
    this.save();
  }

  private applyVolume(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, this.ctx.currentTime, 0.05);
  }

  private save(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      /* storage unavailable */
    }
  }

  /** Resolves when all sounds are decoded (tests). */
  whenLoaded(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }
}
