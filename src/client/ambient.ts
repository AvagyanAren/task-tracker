/**
 * Calm background sounds, synthesised in the browser with Web Audio: no files,
 * no internet, no video. Each sound is looping noise shaped by filters and slow
 * modulation; several can be mixed.
 */
export interface SoundDef {
  id: string;
  label: string;
  hint: string;
}

export const SOUNDS: SoundDef[] = [
  { id: 'rain', label: 'Дождь', hint: 'Ровный дождь с редкими каплями' },
  { id: 'waves', label: 'Волны', hint: 'Медленный прибой' },
  { id: 'wind', label: 'Ветер', hint: 'Мягкие порывы' },
  { id: 'fire', label: 'Камин', hint: 'Низкий гул и потрескивание' },
  { id: 'brown', label: 'Коричневый шум', hint: 'Глубокий, глушит разговоры вокруг' },
  { id: 'pink', label: 'Розовый шум', hint: 'Ровный «шум воды»' }
];

export interface AmbientParams {
  /** 0..1 per sound id; 0 or missing = off. */
  mix: Record<string, number>;
  master: number;
  playing: boolean;
}

type Kind = 'white' | 'pink' | 'brown';

function noise(ctx: AudioContext, kind: Kind, seconds = 10): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      // Paul Kellet's pink-noise filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

/** Sparse short pops: raindrops (soft, frequent) or fire crackle (sharper, irregular). */
function pops(ctx: AudioContext, perSecond: number, loud: number, decayMs: number, seconds = 10): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const tail = Math.floor((decayMs / 1000) * ctx.sampleRate);
  const count = Math.floor(perSecond * seconds);
  for (let n = 0; n < count; n++) {
    const at = Math.floor(Math.random() * (len - tail));
    const amp = loud * (0.2 + Math.random() * Math.random() * 0.8);
    for (let i = 0; i < tail; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-6 * i) / tail);
  }
  return buf;
}

interface Voice {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

function build(ctx: AudioContext, id: string, to: AudioNode): Voice {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(to);
  const sources: AudioScheduledSourceNode[] = [];

  const loop = (buf: AudioBuffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    sources.push(s);
    return s;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const amp = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const lfo = (hz: number, depth: number, target: AudioParam) => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    const g = amp(depth);
    o.connect(g).connect(target);
    o.start();
    sources.push(o);
  };

  switch (id) {
    case 'rain': {
      loop(noise(ctx, 'white')).connect(filter('highpass', 500)).connect(filter('lowpass', 9000)).connect(amp(0.45)).connect(gain);
      loop(pops(ctx, 70, 0.7, 14)).connect(filter('highpass', 2200)).connect(amp(0.8)).connect(gain);
      break;
    }
    case 'waves': {
      const swell = amp(0.45);
      loop(noise(ctx, 'pink')).connect(filter('lowpass', 1000)).connect(swell).connect(gain);
      lfo(0.085, 0.33, swell.gain);
      lfo(0.13, 0.15, swell.gain);
      break;
    }
    case 'wind': {
      const band = filter('bandpass', 520, 0.8);
      loop(noise(ctx, 'white')).connect(band).connect(amp(1.1)).connect(gain);
      lfo(0.07, 300, band.frequency);
      lfo(0.19, 110, band.frequency);
      break;
    }
    case 'fire': {
      loop(noise(ctx, 'brown')).connect(filter('lowpass', 420)).connect(amp(0.9)).connect(gain);
      loop(pops(ctx, 9, 1, 9)).connect(filter('highpass', 1400)).connect(amp(0.9)).connect(gain);
      break;
    }
    case 'brown':
      loop(noise(ctx, 'brown')).connect(filter('lowpass', 1100)).connect(amp(0.8)).connect(gain);
      break;
    default:
      loop(noise(ctx, 'pink')).connect(filter('lowpass', 9000)).connect(amp(0.8)).connect(gain);
  }
  return { gain, sources };
}

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private params: AmbientParams = { mix: {}, master: 0.6, playing: false };
  private preview = false;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;

  set(p: AmbientParams) {
    this.params = p;
    this.apply();
  }

  /** While the mixer is open the sounds play so they can be tuned by ear. */
  setPreview(v: boolean) {
    this.preview = v;
    this.apply();
  }

  /** Browsers only start audio after a click or key press; retry on the next one. */
  unlock() {
    if (this.ctx && this.on && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get on() {
    return this.params.playing || this.preview;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const C = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private apply() {
    if (!this.on) {
      const ctx = this.ctx;
      if (!ctx || !this.master) return;
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => {
        if (!this.on && ctx.state === 'running') void ctx.suspend();
      }, 2500);
      return;
    }

    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    clearTimeout(this.suspendTimer);
    void ctx.resume();
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, this.params.master)), t, 0.6);

    for (const s of SOUNDS) {
      const v = Math.min(1, Math.max(0, this.params.mix[s.id] ?? 0));
      let voice = this.voices.get(s.id);
      if (v > 0) {
        if (!voice) {
          voice = build(ctx, s.id, this.master);
          this.voices.set(s.id, voice);
        }
        voice.gain.gain.setTargetAtTime(v, t, 0.5);
      } else if (voice) {
        const gone = voice;
        gone.gain.gain.setTargetAtTime(0, t, 0.3);
        this.voices.delete(s.id);
        setTimeout(() => {
          gone.sources.forEach((src) => {
            try {
              src.stop();
            } catch {
              /* already stopped */
            }
          });
          gone.gain.disconnect();
        }, 2000);
      }
    }
  }
}

export const ambient = new Engine();

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => ambient.unlock(), { passive: true });
}

export interface AmbientSettings {
  enabled: boolean;
  master: number;
  mix: Record<string, number>;
  /** Only while working (Pomodoro work interval or a running timer), or always. */
  when: 'work' | 'always';
}

export const DEFAULT_AMBIENT: AmbientSettings = { enabled: false, master: 0.6, mix: { rain: 0.7 }, when: 'work' };
