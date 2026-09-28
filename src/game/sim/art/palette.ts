/**
 * The PATHBREAKERS art palette: every color the models use, with the physics material it carries.
 * Kept small (~110 entries) because the level shares the engine's 255-entry palette.
 */
import type { MaterialName } from '../../../voxel/materials.ts';
import { color, type ArtKit } from './kit.ts';

export const COLORS = {
  // Vehicle metals.
  yellow: [0xf2b91d, 'metal'],
  yellowDark: [0xcf9612, 'metal'],
  orange: [0xff7a1a, 'metal'],
  black: [0x1e2023, 'metal'],
  tire: [0x2c2e33, 'metal'],
  steel: [0x7c858e, 'metal'],
  steelDark: [0x4f5760, 'metal'],
  chrome: [0xcdd5dc, 'metal'],
  white: [0xeef0f2, 'metal'],
  blue: [0x3f7cc7, 'metal'],
  blueDark: [0x2c5a96, 'metal'],
  red: [0xd8432f, 'metal'],
  redDark: [0xa3301f, 'metal'],
  green: [0x2f9e5a, 'metal'],
  greenDark: [0x1f6e3e, 'metal'],
  brown: [0x7d3b2a, 'metal'],
  rust: [0x9c5a3c, 'metal'],
  rustDark: [0x74402a, 'metal'],
  headlight: [0xfff2b0, 'metal'],
  taillight: [0xff3b2f, 'metal'],
  core: [0xd6ff4a, 'metal'],
  coreDark: [0x93c923, 'metal'],
  visor: [0x35d0ff, 'metal'],
  rduOn: [0x7dff6a, 'metal'],
  tank: [0x9bb4c4, 'metal'],
  tankDark: [0x7f98a8, 'metal'],
  steelDoor: [0x5a6570, 'metal'],
  // Glass.
  glass: [0x8fcde6, 'glass'],
  glassDark: [0x4f8fb3, 'glass'],
  glassStained: [0xc86ad2, 'glass'],
  glassAmber: [0xf2b640, 'glass'],
  // Wood.
  barnRed: [0xb3322a, 'wood'],
  barnRedDark: [0x952820, 'wood'],
  trim: [0xf0ece0, 'wood'],
  plank: [0xc49a62, 'wood'],
  plankDark: [0x9c7443, 'wood'],
  plankGrey: [0x9a948a, 'wood'],
  door: [0x6b4426, 'wood'],
  shingle: [0x5b5048, 'wood'],
  shingleDark: [0x483f38, 'wood'],
  awningRed: [0xd23b2c, 'wood'],
  awningGreen: [0x2f8f4f, 'wood'],
  awningBlue: [0x2f63b5, 'wood'],
  signYellow: [0xf2c12e, 'wood'],
  hazardOrange: [0xff7a1a, 'wood'],
  hazardBlack: [0x1e2023, 'wood'],
  rollDoor: [0xa3abb3, 'wood'],
  rollDoorDark: [0x8a929a, 'wood'],
  skin: [0xf1c08d, 'wood'],
  hair: [0x4a3222, 'wood'],
  pants: [0x2b3b66, 'wood'],
  shirtOrange: [0xf2a03d, 'wood'],
  shirtBlue: [0x3a7bd5, 'wood'],
  shirtPink: [0xe86aa0, 'wood'],
  shirtGreen: [0x49b35a, 'wood'],
  trunk: [0x6b4a2e, 'wood'],
  ammoBlue: [0x3a6ea5, 'wood'],
  // Masonry.
  brick: [0xa4533c, 'brick'],
  brickDark: [0x8c4230, 'brick'],
  roofTile: [0xa33f2f, 'brick'],
  roofTileDark: [0x86331f, 'brick'],
  cream: [0xe8dcc0, 'concrete'],
  plasterBlue: [0xa9c4d8, 'concrete'],
  plasterGreen: [0xb6d1a2, 'concrete'],
  plasterPink: [0xe0a8a0, 'concrete'],
  concrete: [0xb2aea5, 'concrete'],
  concreteDark: [0x938f87, 'concrete'],
  whiteConcrete: [0xf2f1ec, 'concrete'],
  slate: [0x4a4f58, 'concrete'],
  slateDark: [0x3b4048, 'concrete'],
  officeFrame: [0xd9dde0, 'concrete'],
  corrugated: [0xa7b0b8, 'concrete'],
  corrugatedDark: [0x8c959e, 'concrete'],
  paintRed: [0xd23b2c, 'concrete'],
  stone: [0x8c8a84, 'stone'],
  stoneDark: [0x6f6d68, 'stone'],
  stoneLight: [0xa6a39b, 'stone'],
  // Explosives.
  tnt: [0xc8321e, 'tnt'],
  tntBand: [0x5e160c, 'tnt'],
  tntLabel: [0xf0e6c8, 'tnt'],
  pumpDark: [0x2c2e33, 'tnt'],
  // Soft stuff.
  hay: [0xe5c35a, 'hay'],
  hayDark: [0xc9a640, 'hay'],
  leaf: [0x4f8f3a, 'foliage'],
  leafDark: [0x3c7530, 'foliage'],
  leafLight: [0x6aa84a, 'foliage'],
  pine: [0x2f6b3a, 'foliage'],
  // Indestructible gameplay pieces.
  block: [0x9a9a92, 'reinforced'],
  blockDark: [0x7f7f78, 'reinforced'],
  chevronYellow: [0xf2c12e, 'reinforced'],
  chevronBlack: [0x2a2a2a, 'reinforced'],
  dirt: [0x8a6a45, 'reinforced'],
  dirtDark: [0x735636, 'reinforced'],
  dirtGrass: [0x6e8f3c, 'reinforced'],
  rampGrey: [0x8d8d86, 'reinforced'],
  rampGreyDark: [0x76766f, 'reinforced'],
  sleeper: [0x5a4a3a, 'reinforced'],
  rail: [0xa4acb4, 'reinforced'],
} as const satisfies Record<string, readonly [number, MaterialName]>;

export type ColorName = keyof typeof COLORS;

/** Palette index for a named art color. */
export function C(kit: ArtKit, name: ColorName): number {
  const [hex, material] = COLORS[name];
  return color(kit, hex, material);
}
