/**
 * Procedural music: a 16th-note step sequencer (lookahead-scheduled by the caller) playing the songs in
 * theory.ts with synthesized drums, bass, Karplus-Strong banjo/guitar and a harmonica-ish lead.
 */
import type { MusicTrack } from './index.ts';
import type { PluckKind, Synth } from './synth.ts';
import {
  SONGS, banjoRoll, chordTones, midiToFreq, noteToMidi, parseChord, parsePattern, songPluckNotes, stepDuration,
  tenseVariant, walkingBass, type Chord, type SongId, type TrackDef,
} from './theory.ts';

// ---------------------------------------------------------------- instruments

function kick(s: Synth, out: AudioNode, t: number, vel: number): void {
  const g = s.gain(0, out);
  const o = s.osc('sine', 150, t, 0.35, g);
  s.sweep(o.frequency, t, 160, 44, 0.12);
  s.perc(g.gain, t, 0.95 * vel, 0.002, 0.3);
  s.cleanup(o, g);
  const cg = s.gain(0, out);
  const c = s.noise('white', t, 0.02, s.filter('highpass', 3000, 0.7, cg));
  s.perc(cg.gain, t, 0.12 * vel, 0.0005, 0.012);
  s.cleanup(c, cg);
}

function snare(s: Synth, out: AudioNode, t: number, vel: number): void {
  const g = s.gain(0, out);
  const bp = s.filter('bandpass', 1900, 0.8, g);
  const n = s.noise('white', t, 0.22, s.filter('highpass', 900, 0.7, bp));
  s.perc(g.gain, t, 0.5 * vel, 0.001, 0.16);
  s.cleanup(n, g, bp);
  const tg = s.gain(0, out);
  const o = s.osc('triangle', 190, t, 0.12, tg);
  s.perc(tg.gain, t, 0.28 * vel, 0.001, 0.08);
  s.cleanup(o, tg);
}

function hat(s: Synth, out: AudioNode, t: number, vel: number, open: boolean): void {
  const g = s.gain(0, out);
  const n = s.noise('white', t, open ? 0.3 : 0.06, s.filter('highpass', 7200, 0.7, g));
  s.perc(g.gain, t, (open ? 0.12 : 0.1) * vel, 0.0008, open ? 0.24 : 0.035);
  s.cleanup(n, g);
}

function shaker(s: Synth, out: AudioNode, t: number, vel: number): void {
  const g = s.gain(0, out);
  const n = s.noise('white', t, 0.05, s.filter('bandpass', 6200, 1.2, g));
  s.perc(g.gain, t, 0.07 * vel, 0.006, 0.03);
  s.cleanup(n, g);
}

function bass(s: Synth, out: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const g = s.gain(0, out);
  const lp = s.filter('lowpass', 900, 1.4, g);
  const f = midiToFreq(midi);
  const a = s.osc('sawtooth', f, t, dur + 0.15, lp);
  const b = s.osc('triangle', f, t, dur + 0.15, s.gain(0.8, lp));
  void b;
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(380, t + Math.min(0.25, dur));
  s.ahr(g.gain, t, 0.3 * vel, 0.006, Math.max(0.02, dur * 0.7), 0.08);
  s.cleanup(a, g, lp);
}

function pluck(s: Synth, out: AudioNode, t: number, midi: number, vel: number, kind: PluckKind, mute = 0): void {
  const g = s.gain(0.34 * vel, out);
  const dest = kind === 'banjo' ? s.filter('highpass', 280, 0.7, g) : g;
  const src = s.play(s.pluckBuffer(midi, kind), t, dest);
  if (mute > 0) {
    g.gain.setValueAtTime(0.34 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + mute);
    src.stop(t + mute + 0.01);
  }
  s.cleanup(src, g, dest);
}

function lead(s: Synth, out: AudioNode, t: number, midi: number, dur: number, vel: number, style: TrackDef['leadStyle']): void {
  const f = midiToFreq(midi);
  if (style === 'tremolo') {
    const step = 0.055;
    for (let tt = t; tt < t + dur - 0.02; tt += step) pluck(s, out, tt, midi, vel * 0.8, 'surf', 0.09);
    return;
  }
  if (style === 'bell') {
    const g = s.gain(0, out);
    const o = s.osc('sine', f, t, dur + 1, g);
    const o2 = s.osc('triangle', f * 2, t, dur + 1, s.gain(0.25, g));
    void o2;
    s.perc(g.gain, t, 0.16 * vel, 0.004, 0.5 + dur);
    s.cleanup(o, g);
    return;
  }
  const g = s.gain(0, out);
  const lp = s.filter('lowpass', style === 'urgent' ? 2400 : 3000, style === 'urgent' ? 3 : 0.8, g);
  const bp = style === 'harmonica' ? s.filter('bandpass', 1150, 1.3, lp) : lp;
  const a = s.osc(style === 'urgent' ? 'sawtooth' : 'square', f, t, dur + 0.15, bp);
  const b = s.osc('sawtooth', f * 1.004, t, dur + 0.15, s.gain(0.5, bp));
  void b;
  s.lfo('sine', 5.6, f * 0.007, a.frequency, t + 0.12, Math.max(0.05, dur));
  if (style === 'urgent') s.ahr(g.gain, t, 0.13 * vel, 0.005, Math.max(0.03, dur * 0.6), 0.05);
  else s.ahr(g.gain, t, 0.2 * vel, 0.035, Math.max(0.03, dur - 0.06), 0.09);
  s.cleanup(a, g, lp, bp);
}

function stab(s: Synth, out: AudioNode, t: number, chord: Chord, vel: number): void {
  const g = s.gain(0, out);
  const lp = s.filter('lowpass', 1800, 1.6, g);
  const tones = chordTones(chord).map((m) => m + 12);
  let first: OscillatorNode | null = null;
  for (const m of tones) {
    const o = s.osc('sawtooth', midiToFreq(m), t, 0.3, s.gain(1 / tones.length, lp));
    first ??= o;
  }
  s.perc(g.gain, t, 0.22 * vel, 0.004, 0.2);
  if (first) s.cleanup(first, g, lp);
}

// ---------------------------------------------------------------- sequencer

interface ParsedSong {
  def: TrackDef;
  kick: [number, number][];
  snare: [number, number][];
  hat: [number, number][];
  openHat: [number, number][];
  stabs: [number, number][];
  chords: Chord[];
}

const parsed = new Map<SongId, ParsedSong>();

function parse(id: SongId): ParsedSong {
  let p = parsed.get(id);
  if (!p) {
    const def = SONGS[id];
    p = {
      def,
      kick: parsePattern(def.kick),
      snare: parsePattern(def.snare),
      hat: parsePattern(def.hat),
      openHat: parsePattern(def.openHat ?? ''),
      stabs: parsePattern(def.stabs ?? ''),
      chords: def.progression.map((c) => parseChord(c)),
    };
    parsed.set(id, p);
  }
  return p;
}

const velAt = (list: [number, number][], step: number) => list.find(([s]) => s === step)?.[1] ?? 0;

export class MusicSequencer {
  readonly out: GainNode;
  private readonly s: Synth;
  private desired: MusicTrack = 'none';
  private tension = 0;
  private tense = false;
  private song: ParsedSong | null = null;
  private songId: SongId | null = null;
  private running = false;
  private switchNow = false;
  private nextTime = 0;
  private step = 0;
  private bar = 0;

  constructor(s: Synth, dest: AudioNode) {
    this.s = s;
    this.out = s.gain(0, dest);
  }

  get current(): SongId | null {
    return this.running ? this.songId : null;
  }

  set(track: MusicTrack, tension: number): void {
    const trackChanged = track !== this.desired;
    this.desired = track;
    this.tension = Math.max(0, Math.min(1, tension));
    if (track === 'none') return; // fades at the next step
    if (!this.running) {
      this.running = true;
      this.nextTime = this.s.now + 0.06;
      this.step = 0;
      this.bar = 0;
      this.songId = null;
      this.chooseSong();
      const g = this.out.gain;
      g.cancelScheduledValues(this.s.now);
      g.setValueAtTime(0.0001, this.s.now);
      g.linearRampToValueAtTime(this.song?.def.level ?? 0.8, this.s.now + 0.4);
    } else if (trackChanged) {
      this.switchNow = true;
    }
  }

  /** Schedules every step that starts before `until` (context time). */
  schedule(until: number): void {
    if (!this.running) return;
    if (this.desired === 'none') {
      const t = this.s.now;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0, t + 1.2);
      this.running = false;
      this.songId = null;
      return;
    }
    if (this.nextTime < this.s.now - 0.25) this.nextTime = this.s.now + 0.05; // resumed after a stall
    while (this.nextTime < until) {
      if (this.switchNow) {
        this.switchNow = false;
        this.step = 0;
        this.bar = 0;
        this.chooseSong();
      } else if (this.step === 0) {
        this.chooseSong();
      }
      const song = this.song!;
      this.playStep(this.nextTime, song);
      this.nextTime += stepDuration(song.def.bpm);
      if (++this.step === 16) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private chooseSong(): void {
    let id: SongId;
    if (this.desired === 'mission') {
      this.tense = tenseVariant(this.tense, this.tension);
      id = this.tense ? 'missionTense' : 'mission';
    } else {
      id = this.desired === 'none' ? 'title' : this.desired;
    }
    if (id === this.songId) return;
    this.songId = id;
    this.song = parse(id);
    const kind = this.song.def.pluck;
    const leadKind = this.song.def.leadStyle === 'tremolo' ? 'surf' : null;
    for (const m of songPluckNotes(this.song.def)) {
      if (kind !== 'none') this.s.pluckBuffer(m, kind);
      if (leadKind) this.s.pluckBuffer(m, leadKind);
    }
    this.out.gain.setTargetAtTime(this.song.def.level, this.s.now, 0.2);
  }

  private playStep(t: number, song: ParsedSong): void {
    const s = this.s, out = this.out, def = song.def, step = this.step;
    const n = song.chords.length;
    const chord = song.chords[this.bar % n]!;
    const next = song.chords[(this.bar + 1) % n]!;
    const sd = stepDuration(def.bpm);

    const k = velAt(song.kick, step);
    if (k) kick(s, out, t, k);
    const sn = velAt(song.snare, step);
    if (sn) snare(s, out, t, sn);
    const oh = velAt(song.openHat, step);
    const h = velAt(song.hat, step);
    if (oh) hat(s, out, t, oh, true);
    else if (h) hat(s, out, t, h, false);
    if (this.songId === 'mission' && this.tension >= 0.4 && step % 2 === 1) shaker(s, out, t, 0.6 + this.tension * 0.4);

    // Bass.
    switch (def.bass) {
      case 'walk':
        if (step % 4 === 0) bass(s, out, t, walkingBass(chord, next)[step / 4]!, sd * 3.5, step === 0 ? 1 : 0.85);
        break;
      case 'root5':
        if (step === 0) bass(s, out, t, chord.root - 12, sd * 7, 1);
        if (step === 8) bass(s, out, t, chordTones(chord)[2]! - 12, sd * 7, 0.85);
        break;
      case 'pulse':
        if (step % 2 === 0) bass(s, out, t, chord.root - 12 + (step === 6 || step === 14 ? 12 : 0), sd * 1.6, step % 4 === 0 ? 1 : 0.8);
        break;
      case 'surf':
        if (step % 2 === 0) bass(s, out, t, chord.root - 12 + (step % 4 === 2 ? 12 : 0), sd * 1.7, 0.9);
        break;
    }

    // Plucked rhythm.
    if (def.pluck === 'banjo') {
      pluck(s, out, t, banjoRoll(chord, this.bar)[step]!, step % 4 === 0 ? 0.75 : 0.5, 'banjo');
    } else if (def.pluck === 'guitar') {
      if (step % 2 === 0) {
        const tones = [chord.root, chord.root + 7, chord.root + 12];
        tones.forEach((m, i) => pluck(s, out, t + i * 0.006, m, 0.55, 'guitar', 0.11));
      }
    } else if (def.pluck === 'surf') {
      if (step % 4 === 0 || step === 6 || step === 14) chordTones(chord).forEach((m, i) => pluck(s, out, t + i * 0.012, m + 12, 0.45, 'surf'));
    }

    // Lead.
    const phrase = def.lead[this.bar % n];
    if (phrase) for (const [st, note, len] of phrase) if (st === step) lead(s, out, t, noteToMidi(note), len * sd, 1, def.leadStyle);

    // Stabs.
    const st = velAt(song.stabs, step);
    if (st) stab(s, out, t, { root: chord.root, quality: chord.quality === '7' ? '7' : 'min' }, st);
  }
}
