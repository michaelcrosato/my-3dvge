/**
 * Pure helpers for the procedural audio: pitch math, chord parsing, pattern tables, song definitions,
 * the voice-cap policy and listener-relative spatialization. No WebAudio here, so it's unit-testable.
 */

export type XYZLike = readonly [number, number, number];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'F#3' → 54, 'Bb2' → 46. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note "${name}"`);
  const base = NOTE_INDEX[m[1]!.toUpperCase()]!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export type ChordQuality = 'maj' | 'min' | '7' | 'min7' | 'maj7' | 'dim' | '5';

export interface Chord {
  /** MIDI root. */
  root: number;
  quality: ChordQuality;
}

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  '5': [0, 7],
};

/** 'G' | 'Em' | 'D7' | 'Bb' | 'F#m' | 'Am7' | 'Cmaj7' | 'Bdim' | 'E5', root placed in `octave`. */
export function parseChord(symbol: string, octave = 3): Chord {
  const m = /^([A-G])([#b]?)(maj7|min7|m7|m|7|dim|5)?$/.exec(symbol);
  if (!m) throw new Error(`Bad chord "${symbol}"`);
  const root = noteToMidi(`${m[1]}${m[2] ?? ''}${octave}`);
  const q = m[3];
  const quality: ChordQuality = q === 'm' ? 'min' : q === 'm7' || q === 'min7' ? 'min7' : q === 'maj7' ? 'maj7' : q === '7' ? '7' : q === 'dim' ? 'dim' : q === '5' ? '5' : 'maj';
  return { root, quality };
}

export function chordTones(c: Chord): number[] {
  return QUALITY_INTERVALS[c.quality].map((i) => c.root + i);
}

/**
 * Drum/rhythm pattern strings, one char per 16th: 'x' hit, 'X' accent, 'g' ghost, anything else rest.
 * Returns [step, velocity] pairs.
 */
export function parsePattern(p: string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === 'x') out.push([i, 0.8]);
    else if (c === 'X') out.push([i, 1]);
    else if (c === 'g') out.push([i, 0.35]);
  }
  return out;
}

/** Seconds per 16th note. */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

/** Four quarter-note bass notes: root, third/fifth, fifth, chromatic approach to the next root. */
export function walkingBass(chord: Chord, next: Chord): number[] {
  const tones = chordTones(chord);
  const root = chord.root - 12;
  const third = tones[1]! - 12;
  const fifth = tones[2]! - 12;
  let target = next.root - 12;
  while (target - root > 6) target -= 12;
  while (root - target > 6) target += 12;
  const approach = target === root ? root + 2 : target > root ? target - 1 : target + 1;
  return [root, third, fifth, approach];
}

/** 16 banjo-roll notes (one per 16th) built from the chord: a forward roll with an octave on top. */
export function banjoRoll(chord: Chord, variant = 0): number[] {
  const t = chordTones(chord);
  const r = t[0]! + 12, third = (t[1] ?? t[0]! + 4) + 12, fifth = (t[2] ?? t[0]! + 7) + 12, oct = r + 12;
  const forward = [r, fifth, oct, third, fifth, oct, r, fifth];
  const backward = [oct, fifth, third, oct, fifth, third, r, fifth];
  const roll = variant % 2 === 0 ? forward : backward;
  return [...roll, ...roll];
}

export interface VoiceInfo {
  volume: number;
  start: number;
}

/**
 * Voice-cap policy: `null` when there's room; otherwise the index of the quietest voice (oldest on ties)
 * if the new one is louder, or 'skip' to drop the new sound.
 */
export function pickVoiceToDrop(voices: readonly VoiceInfo[], newVolume: number, cap: number): number | 'skip' | null {
  if (voices.length < cap) return null;
  let best = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!;
    if (best < 0) best = i;
    else {
      const b = voices[best]!;
      if (v.volume < b.volume || (v.volume === b.volume && v.start < b.start)) best = i;
    }
  }
  if (best < 0) return 'skip';
  return voices[best]!.volume <= newVolume ? best : 'skip';
}

/**
 * Listener-relative gain (roughly inverse-distance, clamped) and stereo pan. Yaw 0 looks down -z; the
 * listener's right is +x at yaw 0.
 */
export function spatialize(listener: XYZLike, yaw: number, at: XYZLike, ref = 8, maxDistance = 220): { gain: number; pan: number } {
  const dx = at[0] - listener[0];
  const dy = at[1] - listener[1];
  const dz = at[2] - listener[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= maxDistance) return { gain: 0, pan: 0 };
  const gain = Math.min(1, Math.pow(ref / Math.max(dist, 0.001), 0.9)) * (1 - dist / maxDistance);
  const flat = Math.hypot(dx, dz);
  if (flat < 0.5) return { gain, pan: 0 };
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / flat) * 0.85));
  return { gain, pan };
}

// ---------------------------------------------------------------- songs

export type BassStyle = 'walk' | 'root5' | 'pulse' | 'surf';
export type PluckStyle = 'banjo' | 'guitar' | 'surf' | 'none';

/** [step, note name, length in 16ths]. */
export type LeadNote = [number, string, number];

export interface TrackDef {
  bpm: number;
  /** One chord symbol per bar. */
  progression: string[];
  kick: string;
  snare: string;
  hat: string;
  openHat?: string;
  bass: BassStyle;
  pluck: PluckStyle;
  /** Bars (index into the progression) that carry a lead phrase, with its notes. */
  lead: Record<number, LeadNote[]>;
  leadStyle: 'harmonica' | 'urgent' | 'tremolo' | 'bell';
  /** Minor stabs on these steps (tension variant). */
  stabs?: string;
  /** Overall level of this arrangement. */
  level: number;
}

export type SongId = 'title' | 'mission' | 'missionTense' | 'bonus' | 'results';

export const SONGS: Record<SongId, TrackDef> = {
  title: {
    bpm: 96,
    progression: ['D', 'G', 'A', 'D', 'Bm', 'G', 'A', 'D'],
    kick: 'x.......x.......',
    snare: '....g.......g...',
    hat: 'x.x.x.x.x.x.x.x.',
    bass: 'root5',
    pluck: 'banjo',
    lead: {
      6: [[0, 'E5', 4], [4, 'C#5', 4], [8, 'A4', 8]],
      7: [[0, 'F#5', 6], [8, 'D5', 8]],
    },
    leadStyle: 'bell',
    level: 0.75,
  },
  mission: {
    bpm: 116,
    progression: ['G', 'G', 'C', 'G', 'D', 'C', 'G', 'D'],
    kick: 'X.......x.x.....',
    snare: '....X.......X..g',
    hat: 'x.x.x.x.x.x.x.x.',
    openHat: '..............x.',
    bass: 'walk',
    pluck: 'banjo',
    lead: {
      4: [[0, 'A4', 2], [2, 'B4', 2], [4, 'D5', 4], [10, 'B4', 2], [12, 'A4', 4]],
      5: [[0, 'G4', 2], [2, 'E4', 2], [4, 'G4', 6], [12, 'A4', 4]],
      6: [[0, 'B4', 4], [4, 'D5', 2], [6, 'B4', 2], [8, 'G4', 6], [14, 'A4', 2]],
      7: [[0, 'F#4', 4], [4, 'A4', 4], [8, 'D5', 8]],
    },
    leadStyle: 'harmonica',
    level: 0.85,
  },
  missionTense: {
    bpm: 139,
    progression: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'B7', 'B7'],
    kick: 'X...x...X...x...',
    snare: '....X.......X.gg',
    hat: 'xgxgxgxgxgxgxgxg',
    bass: 'pulse',
    pluck: 'guitar',
    lead: {
      2: [[0, 'E5', 1], [2, 'E5', 1], [4, 'G5', 2], [6, 'E5', 2], [8, 'D5', 2], [10, 'E5', 6]],
      3: [[0, 'F#5', 2], [2, 'D5', 2], [4, 'A4', 4], [8, 'F#5', 2], [10, 'A5', 6]],
      6: [[0, 'B5', 2], [2, 'A5', 2], [4, 'G5', 2], [6, 'F#5', 2], [8, 'D#5', 8]],
      7: [[0, 'B4', 1], [2, 'B4', 1], [4, 'D#5', 1], [6, 'F#5', 1], [8, 'A5', 2], [12, 'B5', 4]],
    },
    leadStyle: 'urgent',
    stabs: 'X.....x.....x...',
    level: 0.9,
  },
  bonus: {
    bpm: 150,
    progression: ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'E', 'E'],
    kick: 'X.....x.X.......',
    snare: '....X.......X...',
    hat: 'xxxxxxxxxxxxxxxx',
    bass: 'surf',
    pluck: 'surf',
    lead: {
      0: [[0, 'A4', 8], [8, 'C5', 8]],
      1: [[0, 'B4', 8], [8, 'A4', 8]],
      2: [[0, 'A4', 8], [8, 'F4', 8]],
      3: [[0, 'G4', 8], [8, 'B4', 8]],
      4: [[0, 'E5', 8], [8, 'D5', 8]],
      5: [[0, 'C5', 8], [8, 'B4', 8]],
      6: [[0, 'G#4', 16]],
      7: [[0, 'B4', 8], [8, 'E5', 8]],
    },
    leadStyle: 'tremolo',
    level: 0.8,
  },
  results: {
    bpm: 108,
    progression: ['C', 'F', 'G', 'C'],
    kick: 'x.......x.......',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    bass: 'root5',
    pluck: 'banjo',
    lead: {
      3: [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 8]],
    },
    leadStyle: 'bell',
    level: 0.75,
  },
};

/** Every MIDI note a song's plucked instrument may play (for pre-rendering pluck buffers). */
export function songPluckNotes(song: TrackDef): number[] {
  const notes = new Set<number>();
  if (song.pluck === 'none') return [];
  song.progression.forEach((sym, i) => {
    const c = parseChord(sym);
    if (song.pluck === 'banjo') for (const n of banjoRoll(c, i)) notes.add(n);
    else for (const n of chordTones(c)) notes.add(n + 12);
  });
  if (song.pluck === 'surf' || song.leadStyle === 'tremolo') for (const bar of Object.values(song.lead)) for (const [, n] of bar) notes.add(noteToMidi(n));
  return [...notes].sort((a, b) => a - b);
}

/** Tension hysteresis for the "collision imminent" variant. */
export function tenseVariant(current: boolean, tension: number): boolean {
  return current ? tension >= 0.6 : tension >= 0.75;
}
