import { describe, expect, it } from 'vitest';
import {
  SONGS, banjoRoll, chordTones, midiToFreq, noteToMidi, parseChord, parsePattern, pickVoiceToDrop, songPluckNotes,
  spatialize, stepDuration, tenseVariant, walkingBass, type SongId,
} from '../../src/game/client/audio/theory.ts';

describe('audio theory', () => {
  it('converts notes and MIDI to frequencies', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('Bb2')).toBe(46);
    expect(() => noteToMidi('H2')).toThrow();
  });

  it('parses chords into tones', () => {
    expect(chordTones(parseChord('G'))).toEqual([55, 59, 62]);
    expect(chordTones(parseChord('Em'))).toEqual([52, 55, 59]);
    expect(chordTones(parseChord('B7'))).toEqual([59, 63, 66, 69]);
    expect(parseChord('F#m', 4)).toEqual({ root: 66, quality: 'min' });
    expect(parseChord('Cmaj7').quality).toBe('maj7');
    expect(() => parseChord('X')).toThrow();
  });

  it('parses rhythm patterns with velocities', () => {
    expect(parsePattern('x...X...g...')).toEqual([[0, 0.8], [4, 1], [8, 0.35]]);
    expect(parsePattern('')).toEqual([]);
  });

  it('computes 16th-note step durations', () => {
    expect(stepDuration(120)).toBeCloseTo(0.125, 9);
    expect(stepDuration(116) * 16).toBeCloseTo((60 / 116) * 4, 9);
  });

  it('walks the bass toward the next chord', () => {
    const g = parseChord('G'), c = parseChord('C');
    const line = walkingBass(g, c);
    expect(line).toHaveLength(4);
    expect(line[0]).toBe(g.root - 12);
    // The approach note is a semitone from the next root (in the nearest octave).
    const target = c.root - 12;
    expect(Math.min(Math.abs(line[3]! - target), Math.abs(line[3]! - (target - 12)), Math.abs(line[3]! - (target + 12)))).toBe(1);
  });

  it('builds 16-step banjo rolls from chord tones', () => {
    const chord = parseChord('D');
    const tones = new Set(chordTones(chord).flatMap((m) => [m + 12, m + 24]));
    for (const v of [0, 1]) {
      const roll = banjoRoll(chord, v);
      expect(roll).toHaveLength(16);
      for (const n of roll) expect(tones.has(n)).toBe(true);
    }
  });

  it('defines valid songs (chords, patterns, lead notes inside the bar)', () => {
    for (const id of Object.keys(SONGS) as SongId[]) {
      const s = SONGS[id];
      expect(s.bpm).toBeGreaterThan(60);
      for (const c of s.progression) expect(() => parseChord(c)).not.toThrow();
      for (const p of [s.kick, s.snare, s.hat, s.openHat ?? '', s.stabs ?? '']) expect(p.length === 0 || p.length === 16).toBe(true);
      for (const [bar, notes] of Object.entries(s.lead)) {
        expect(Number(bar)).toBeLessThan(s.progression.length);
        for (const [step, note, len] of notes) {
          expect(step).toBeGreaterThanOrEqual(0);
          expect(step + len).toBeLessThanOrEqual(16);
          expect(() => noteToMidi(note)).not.toThrow();
        }
      }
      if (s.pluck !== 'none') expect(songPluckNotes(s).length).toBeGreaterThan(2);
    }
    // The tense variant is faster (collision imminent).
    expect(SONGS.missionTense.bpm / SONGS.mission.bpm).toBeGreaterThan(1.15);
  });

  it('switches to the tense variant with hysteresis', () => {
    expect(tenseVariant(false, 0.7)).toBe(false);
    expect(tenseVariant(false, 0.75)).toBe(true);
    expect(tenseVariant(true, 0.65)).toBe(true);
    expect(tenseVariant(true, 0.5)).toBe(false);
  });

  it('caps voices by dropping the quietest (oldest on ties) or skipping', () => {
    const voices = [
      { volume: 0.5, start: 1 },
      { volume: 0.2, start: 3 },
      { volume: 0.2, start: 2 },
      { volume: 0.9, start: 0 },
    ];
    expect(pickVoiceToDrop(voices, 0.1, 8)).toBeNull();
    expect(pickVoiceToDrop(voices, 0.5, 4)).toBe(2); // quietest, older of the two 0.2s
    expect(pickVoiceToDrop(voices, 0.1, 4)).toBe('skip');
    expect(pickVoiceToDrop([], 0.3, 0)).toBe('skip');
  });

  it('attenuates with distance and pans relative to the listener yaw', () => {
    const near = spatialize([0, 0, 0], 0, [0, 0, -4]);
    const far = spatialize([0, 0, 0], 0, [0, 0, -80]);
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(near.gain).toBeLessThanOrEqual(1);
    expect(spatialize([0, 0, 0], 0, [0, 0, -500]).gain).toBe(0);
    // Facing -z (yaw 0): +x is right.
    expect(spatialize([0, 0, 0], 0, [10, 0, 0]).pan).toBeGreaterThan(0.5);
    expect(spatialize([0, 0, 0], 0, [-10, 0, 0]).pan).toBeLessThan(-0.5);
    // Turned left 90° (yaw +π/2 looks down -x): +z is now on the left... and -z on the right.
    expect(spatialize([0, 0, 0], Math.PI / 2, [0, 0, -10]).pan).toBeGreaterThan(0.5);
    expect(spatialize([0, 0, 0], 0, [0, 0, -10]).pan).toBeCloseTo(0, 6);
  });
});
