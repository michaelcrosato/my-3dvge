/**
 * Building models. All stand on y = 0 (their anchor layer), front door on the z = 0 face unless noted.
 * Shells are hollow with 2-voxel walls, floor slabs and roofs so partial destruction still reads well.
 */
import { VoxelVolume } from '../../../voxel/volume.ts';
import type { ArtKit } from './kit.ts';
import { C, type ColorName } from './palette.ts';
import {
  bandsY, box, clear, cylY, hazard, opening, roofX, roofZ, shade, stripes, walls, windowRow, type Fill,
} from './shapes.ts';

type K = (n: ColorName) => number;

export type BuildingKind =
  | 'barn' | 'farmhouse' | 'gasStation' | 'pump' | 'shop' | 'depot' | 'terrace' | 'office'
  | 'waterTower' | 'mechShed' | 'silo' | 'shed' | 'warehouse' | 'house' | 'church' | 'garage' | 'target';

export interface BuildingOptions {
  /** Footprint width (x) / depth (z) in voxels; builders pick sensible defaults. */
  w?: number;
  d?: number;
  floors?: number;
  variant?: number;
}

const gable = (slope: number) => (d: number) => d * slope;

/** Red (or weathered) barn with white trim, X-braced doors on both gable ends and a gambrel roof. */
function barn(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 80, D = o.d ?? 100, wallH = 40;
  const weathered = (o.variant ?? 0) % 2 === 1;
  const plankA = weathered ? k('plankGrey') : k('barnRed');
  const plankB = weathered ? k('plank') : k('barnRedDark');
  const TR = k('trim'), R = k('shingle'), RD = k('shingleDark'), GD = k('glassDark');
  const half = W / 2, kink = half * 0.42;
  const profile = (d: number) => (d <= kink ? d * 1.5 : kink * 1.5 + (d - kink) * 0.5);
  const H = wallH + Math.floor(profile(half)) + 2;
  const v = new VoxelVolume(W, H, D);
  const planks: Fill = (x, _y, z) => (Math.floor((x + z) / 6) % 2 ? plankA : plankB);
  box(v, 0, 0, 0, W, 1, D, k('plankDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, planks);
  roofZ(v, 0, W, 0, D, wallH, profile, 3, (_x, y) => (y % 6 === 0 ? RD : R), planks, 2);
  // White trim: corner posts and the eave line.
  for (const [x0, z0] of [[0, 0], [W - 2, 0], [0, D - 2], [W - 2, D - 2]] as const) box(v, x0, 0, z0, x0 + 2, wallH, z0 + 2, TR);
  box(v, 0, wallH - 2, 0, W, wallH, 2, TR);
  box(v, 0, wallH - 2, D - 2, W, wallH, D, TR);
  // X-braced double doors and hay-loft doors on both gable ends.
  const dw = Math.min(28, W - 20), dh = 30, dx0 = Math.floor((W - dw) / 2);
  const door: Fill = (x, y) => {
    const u = x - dx0, t = y - 1;
    if (u <= 0 || u >= dw - 1 || t <= 0 || t >= dh - 2 || u === Math.floor(dw / 2)) return TR;
    const a = (u / dw) * (dh - 1);
    if (Math.abs(a - t) <= 1 || Math.abs(dh - 1 - a - t) <= 1) return TR;
    return plankB;
  };
  box(v, dx0, 1, 0, dx0 + dw, dh + 1, 2, door);
  box(v, dx0, 1, D - 2, dx0 + dw, dh + 1, D, door);
  for (const z of [0, D - 2]) {
    box(v, half - 6, wallH + 3, z, half + 6, wallH + 15, z + 2, TR);
    box(v, half - 4, wallH + 5, z, half + 4, wallH + 13, z + 2, GD);
  }
  // Small side windows.
  windowRow(v, 'x0', 0, 10, D - 10, 22, 28, 2, 6, 18, GD, TR);
  windowRow(v, 'x1', W - 1, 10, D - 10, 22, 28, 2, 6, 18, GD, TR);
  return v;
}

/** Two-storey clapboard farmhouse with a porch, shutters and a brick chimney (ridge along x). */
function farmhouse(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 70, D = o.d ?? 60, wallH = 50, porch = 12;
  const TR = k('trim'), PL = k('plank'), GL = k('glass'), SH = [k('awningGreen'), k('awningBlue'), k('barnRedDark')][(o.variant ?? 0) % 3]!;
  const R = k('slate'), RD = k('slateDark'), BR = k('brick'), DR = k('door');
  const slope = 0.75, H = wallH + Math.floor((D - porch) / 2 * slope) + 12;
  const v = new VoxelVolume(W, H, D);
  const clap = bandsY(TR, k('cream'), 4);
  box(v, 0, 0, 0, W, 1, D, k('plankDark'));
  walls(v, 0, 0, porch, W, wallH, D, 2, clap);
  box(v, 2, 24, porch + 2, W - 2, 26, D - 2, k('plankDark'));
  roofX(v, 0, W, porch - 2, D, wallH, gable(slope), 3, (_x, y) => (y % 3 === 0 ? RD : R), clap, 2, 0, W);
  // Porch: deck, posts, roof.
  box(v, 0, 0, 0, W, 3, porch, PL);
  for (const x of [2, Math.floor(W / 2) - 1, W - 4]) box(v, x, 3, 1, x + 2, 26, 3, TR);
  box(v, 0, 26, 0, W, 28, porch + 1, R);
  // Front door and windows with shutters on both floors.
  const mid = Math.floor(W / 2);
  opening(v, 'z0', porch, mid - 5, mid + 5, 3, 22, 2, DR, TR);
  for (const [y0, y1] of [[8, 20], [32, 44]] as const) {
    const skip = y0 === 8 ? (a: number, b: number) => b > mid - 8 && a < mid + 8 : undefined;
    for (const face of ['z0', 'z1'] as const) {
      const plane = face === 'z0' ? porch : D - 1;
      windowRow(v, face, plane, 6, W - 6, y0, y1, 2, 8, 18, GL, TR, face === 'z0' ? skip : undefined);
    }
    windowRow(v, 'x0', 0, porch + 6, D - 6, y0, y1, 2, 8, 18, GL, TR);
    windowRow(v, 'x1', W - 1, porch + 6, D - 6, y0, y1, 2, 8, 18, GL, TR);
    // Shutters beside the front windows.
    const span = W - 12, n = Math.max(1, Math.floor((span - 8) / 18) + 1), start = 6 + Math.floor((span - (n - 1) * 18 - 8) / 2);
    for (let i = 0; i < n; i++) {
      const u = start + i * 18;
      if (skip?.(u, u + 8)) continue;
      box(v, u - 3, y0, porch, u - 1, y1, porch + 1, SH);
      box(v, u + 9, y0, porch, u + 11, y1, porch + 1, SH);
    }
  }
  // Chimney.
  box(v, W - 16, wallH - 4, Math.floor((porch + D) / 2) + 2, W - 10, H, Math.floor((porch + D) / 2) + 8, BR);
  return v;
}

/** Suburban house: brick or plaster (variant), gable roof, door canopy, windows all round. */
function house(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 60, D = o.d ?? 50, wallH = 35;
  const variant = (o.variant ?? 0) % 4;
  const wall: Fill = variant === 0 ? shade(k('brick'), k('brickDark'), 6, 3, 6, 3) : [k('plasterBlue'), k('plasterGreen'), k('plasterPink')][variant - 1]!;
  const tile = variant % 2 === 0 ? [k('roofTile'), k('roofTileDark')] : [k('slate'), k('slateDark')];
  const TR = k('trim'), GL = k('glass'), DR = [k('door'), k('awningBlue'), k('awningRed'), k('awningGreen')][variant]!;
  const slope = 0.8, H = wallH + Math.floor((D / 2) * slope) + 3;
  const v = new VoxelVolume(W, H, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, wall);
  box(v, 2, 18, 2, W - 2, 20, D - 2, k('plankDark'));
  roofX(v, 0, W, 0, D, wallH, gable(slope), 3, (_x, y) => (y % 3 === 0 ? tile[1]! : tile[0]!), wall);
  const mid = Math.floor(W / 2);
  opening(v, 'z0', 0, mid - 5, mid + 5, 1, 20, 2, DR, TR);
  box(v, mid - 8, 21, 0, mid + 8, 23, 3, tile[1]!);
  for (const [y0, y1] of [[7, 15], [23, 31]] as const) {
    const skip = y0 === 7 ? (a: number, b: number) => b > mid - 8 && a < mid + 8 : undefined;
    windowRow(v, 'z0', 0, 5, W - 5, y0, y1, 2, 8, 16, GL, TR, skip);
    windowRow(v, 'z1', D - 1, 5, W - 5, y0, y1, 2, 8, 16, GL, TR);
    windowRow(v, 'x0', 0, 6, D - 6, y0, y1, 2, 8, 16, GL, TR);
    windowRow(v, 'x1', W - 1, 6, D - 6, y0, y1, 2, 8, 16, GL, TR);
  }
  return v;
}

/** Terraced row-house unit (brick, two storeys, parapet roof, chimney, colored door). */
function terrace(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 40, D = o.d ?? 60, wallH = 48;
  const variant = (o.variant ?? 0) % 4;
  const brick = shade(k('brick'), k('brickDark'), 5, 3, 5, 11 + variant);
  const TR = k('trim'), GL = k('glass'), DR = [k('awningRed'), k('awningBlue'), k('awningGreen'), k('door')][variant]!;
  const H = wallH + 14;
  const v = new VoxelVolume(W, H, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, brick);
  box(v, 2, 23, 2, W - 2, 25, D - 2, k('plankDark'));
  box(v, 0, wallH, 0, W, wallH + 2, D, k('slate'));
  walls(v, 0, wallH + 2, 0, W, wallH + 5, D, 2, TR);
  // Front: door at one side, bay window, sill band.
  opening(v, 'z0', 0, 4, 12, 1, 20, 2, DR, TR);
  box(v, 3, 20, 0, 13, 21, 3, TR);
  opening(v, 'z0', 0, 17, W - 5, 5, 18, 2, GL, TR);
  box(v, 16, 4, 0, W - 4, 5, 3, TR);
  windowRow(v, 'z0', 0, 4, W - 4, 29, 42, 2, 9, 14, GL, TR);
  windowRow(v, 'z1', D - 1, 4, W - 4, 8, 18, 2, 9, 14, GL, TR);
  windowRow(v, 'z1', D - 1, 4, W - 4, 29, 42, 2, 9, 14, GL, TR);
  box(v, 0, 25, 0, W, 26, 2, TR);
  // Chimney stack at the back.
  box(v, W - 12, wallH, D - 14, W - 4, H, D - 6, shade(k('brick'), k('brickDark'), 3, 3, 3, 5));
  box(v, W - 11, H - 2, D - 13, W - 5, H, D - 7, k('slateDark'));
  return v;
}

/** Corner shop: display window, striped awning (variant color) and a sign band. */
function shop(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 70, D = o.d ?? 60, wallH = 40, front = 8;
  const variant = (o.variant ?? 0) % 3;
  const awn = [k('awningRed'), k('awningGreen'), k('awningBlue')][variant]!;
  const wall = [k('cream'), k('plasterBlue'), k('plasterPink')][variant]!;
  const TR = k('trim'), GL = k('glass'), SY = k('signYellow'), BK = k('hazardBlack');
  const v = new VoxelVolume(W, wallH + 6, D);
  box(v, 0, 0, front, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, front, W, wallH, D, 2, wall);
  box(v, 0, wallH - 2, front, W, wallH, D, k('slate'));
  // Parapet with the sign band.
  box(v, 0, wallH, front, W, wallH + 6, front + 2, TR);
  box(v, 3, 30, front, W - 3, 38, front + 2, (x, y) => (y >= 32 && y <= 35 && x % 6 >= 2 && x % 6 <= 3 ? BK : SY));
  // Display windows and a glass door.
  const mid = Math.floor(W / 2);
  opening(v, 'z0', front, 5, mid - 7, 4, 24, 2, GL, TR);
  opening(v, 'z0', front, mid + 7, W - 5, 4, 24, 2, GL, TR);
  opening(v, 'z0', front, mid - 5, mid + 5, 1, 24, 2, k('glassDark'), TR);
  // Awning sloping over the pavement.
  for (let z = 0; z < front; z++) {
    const y = 28 - Math.floor(z / 2);
    box(v, 2, y, z, W - 2, y + 1, z + 1, (x) => (Math.floor(x / 5) % 2 ? awn : TR));
  }
  windowRow(v, 'x0', 0, front + 8, D - 6, 10, 22, 2, 8, 16, GL, TR);
  windowRow(v, 'x1', W - 1, front + 8, D - 6, 10, 22, 2, 8, 16, GL, TR);
  return v;
}

/** White church: nave with pointed windows, steeple tower with belfry and spire at the front. */
function church(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 60, D = o.d ?? 100, wallH = 45, towerD = 22;
  const WC = k('whiteConcrete'), R = k('slate'), RD = k('slateDark'), SG = k('glassStained'), AG = k('glassAmber');
  const DR = k('door'), TR = k('trim');
  const tx0 = Math.floor(W / 2) - 10, tx1 = tx0 + 20, towerH = 90, spireH = 56;
  const H = towerH + spireH + 4;
  const v = new VoxelVolume(W, H, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, towerD - 2, W, wallH, D, 2, WC);
  roofZ(v, 0, W, towerD - 2, D, wallH, gable(1), 3, (_x, y) => (y % 3 === 0 ? RD : R), WC, 2);
  // Pointed stained-glass windows along the nave.
  for (const face of ['x0', 'x1'] as const) {
    const plane = face === 'x0' ? 0 : W - 1;
    for (let z = towerD + 8; z + 6 < D - 6; z += 14) {
      opening(v, face, plane, z, z + 6, 10, 32, 2, (x, y, zz) => ((x + y + zz) % 5 === 0 ? AG : SG), TR);
      opening(v, face, plane, z + 1, z + 5, 32, 35, 2, SG);
      opening(v, face, plane, z + 2, z + 4, 35, 37, 2, SG);
    }
  }
  opening(v, 'z1', D - 1, Math.floor(W / 2) - 6, Math.floor(W / 2) + 6, 18, 36, 2, SG, TR);
  // Steeple: tower, belfry openings, clock band, spire.
  box(v, tx0, 0, 0, tx1, towerH, towerD, WC);
  clear(v, tx0 + 2, 1, 2, tx1 - 2, towerH - 2, towerD - 2);
  opening(v, 'z0', 0, tx0 + 5, tx1 - 5, 1, 24, 2, DR, TR);
  box(v, tx0 + 7, 24, 0, tx1 - 7, 28, 2, DR);
  for (const face of ['z0', 'x0', 'x1', 'z1'] as const) {
    const plane = face === 'z0' ? 0 : face === 'z1' ? towerD - 1 : face === 'x0' ? tx0 : tx1 - 1;
    const [u0, u1] = face === 'z0' || face === 'z1' ? [tx0 + 5, tx1 - 5] : [5, towerD - 5];
    opening(v, face, plane, u0, u1, 68, 82, 2, 0);
  }
  box(v, tx0, 56, 0, tx1, 60, 1, AG);
  for (let y = towerH; y < towerH + spireH; y++) {
    const r = 10 * (1 - (y - towerH) / spireH);
    const c = Math.floor(W / 2);
    box(v, c - r, y, towerD / 2 - r, c + r, y + 1, towerD / 2 + r, (y - towerH) % 6 < 1 ? RD : R);
  }
  box(v, Math.floor(W / 2) - 1, towerH + spireH, towerD / 2 - 1, Math.floor(W / 2) + 1, H, towerD / 2 + 1, AG);
  return v;
}

/** Garage: brick box with two roll-up doors (wood, painted steel-grey) and a flat roof. */
function garage(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 60, D = o.d ?? 60, wallH = 35;
  const wall = (o.variant ?? 0) % 2 ? k('concrete') : shade(k('brick'), k('brickDark'), 6, 3, 6, 21);
  const v = new VoxelVolume(W, wallH + 4, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, wall);
  box(v, 0, wallH, 0, W, wallH + 2, D, k('slate'));
  box(v, 0, wallH + 2, 0, W, wallH + 4, 2, k('trim'));
  const doorW = Math.floor((W - 18) / 2);
  for (const x0 of [6, W - 6 - doorW]) opening(v, 'z0', 0, x0, x0 + doorW, 1, 26, 2, bandsY(k('rollDoor'), k('rollDoorDark'), 2), k('trim'));
  box(v, 4, 28, 0, W - 4, 32, 2, k('signYellow'));
  windowRow(v, 'x1', W - 1, 10, D - 10, 14, 24, 2, 10, 20, k('glass'), k('trim'));
  return v;
}

/** Gas station: canopy on four pillars over the forecourt, kiosk at the back (pumps are separate). */
function gasStation(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 100, D = o.d ?? 80, canopyY = 40, canopyD = 48;
  const WC = k('whiteConcrete'), RP = k('paintRed'), CO = k('concrete'), CD = k('concreteDark');
  const GL = k('glass'), SY = k('signYellow');
  const v = new VoxelVolume(W, canopyY + 7, D);
  box(v, 0, 0, 0, W, 1, D, CD);
  // Canopy with a red fascia band.
  box(v, 0, canopyY, 0, W, canopyY + 7, canopyD, (x, y, z) => {
    const edge = x < 2 || x >= W - 2 || z < 2 || z >= canopyD - 2;
    return edge && y >= canopyY + 2 && y < canopyY + 5 ? RP : WC;
  });
  clear(v, 3, canopyY, 3, W - 3, canopyY + 2, canopyD - 3);
  for (const [x, z] of [[8, 8], [W - 12, 8], [8, canopyD - 12], [W - 12, canopyD - 12]] as const) box(v, x, 1, z, x + 4, canopyY, z + 4, CO);
  // Kiosk.
  const kz0 = canopyD + 6, kx0 = 20, kx1 = W - 20;
  walls(v, kx0, 0, kz0, kx1, 32, D, 2, k('cream'));
  box(v, kx0, 32, kz0, kx1, 35, D, RP);
  opening(v, 'z0', kz0, kx0 + 5, kx1 - 16, 4, 24, 2, GL, k('trim'));
  opening(v, 'z0', kz0, kx1 - 12, kx1 - 4, 1, 24, 2, k('glassDark'), k('trim'));
  box(v, kx0 + 4, 26, kz0, kx1 - 4, 31, kz0 + 1, (x) => (x % 5 < 2 ? RP : SY));
  // Forecourt markings.
  box(v, 4, 1, canopyD - 1, W - 4, 1, canopyD, SY);
  return v;
}

/** Gas-pump island: concrete base and two red pumps whose bodies are explosive. */
function pump(k: K): VoxelVolume {
  const v = new VoxelVolume(30, 18, 12);
  const T = k('tnt'), WH = k('tntLabel'), DK = k('pumpDark');
  box(v, 0, 0, 0, 30, 3, 12, (x, _y, z) => (x < 1 || x >= 29 || z < 1 || z >= 11 ? (Math.floor((x + z) / 2) % 2 ? k('chevronYellow') : k('chevronBlack')) : k('concrete')));
  for (const x0 of [3, 19]) {
    box(v, x0, 3, 3, x0 + 8, 18, 9, (x, y, z) => ((z === 3 || z === 8) && y >= 12 && y < 16 && x > x0 && x < x0 + 7 ? WH : y >= 16 ? DK : T));
    box(v, x0 + 8, 6, 5, x0 + 9, 13, 7, DK);
  }
  return v;
}

/** Stone depot: thick stone walls (too strong to ram), steel doors, high slit windows. */
function depot(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 100, D = o.d ?? 80, wallH = 45;
  const ST = shade(k('stone'), k('stoneDark'), 8, 5, 8, 31);
  const SD = k('steelDoor'), SL = k('stoneLight');
  const v = new VoxelVolume(W, wallH + 5, D);
  box(v, 0, 0, 0, W, 1, D, k('stoneDark'));
  walls(v, 0, 0, 0, W, wallH, D, 3, ST);
  box(v, 0, wallH - 3, 0, W, wallH, D, k('stoneDark'));
  walls(v, 0, wallH, 0, W, wallH + 5, D, 3, SL);
  box(v, 0, 0, 0, W, 4, 3, SL);
  const dw = Math.floor((W - 30) / 2);
  for (const x0 of [10, W - 10 - dw]) opening(v, 'z0', 0, x0, x0 + dw, 1, 32, 3, (_x, y) => (y % 4 === 0 ? k('steelDark') : SD), SL);
  box(v, Math.floor(W / 2) - 10, 36, 0, Math.floor(W / 2) + 10, 42, 1, k('signYellow'));
  for (const face of ['x0', 'x1', 'z1'] as const) {
    const plane = face === 'x0' ? 0 : face === 'x1' ? W - 1 : D - 1;
    const u1 = face === 'z1' ? W - 8 : D - 8;
    windowRow(v, face, plane, 8, u1, 34, 39, 3, 6, 16, k('glassDark'), SL);
  }
  return v;
}

/** Office tower: `floors` storeys of glass curtain wall with mullions, concrete core, roof plant. */
function office(k: K, o: BuildingOptions): VoxelVolume {
  const floors = Math.max(1, Math.min(8, o.floors ?? 8));
  const W = o.w ?? 110, D = o.d ?? 110, H = floors * 30 + 10;
  const FR = k('officeFrame'), CD = k('concreteDark'), CO = k('concrete'), G1 = k('glass'), G2 = k('glassDark');
  const v = new VoxelVolume(W, H, D);
  for (let f = 0; f < floors; f++) {
    const y0 = f * 30;
    box(v, 0, y0, 0, W, y0 + 3, D, CD);
    const glass = f % 2 ? G2 : G1;
    walls(v, 0, y0 + 3, 0, W, y0 + 30, D, 2, (x, y, z) => {
      const u = x === 0 || x === 1 || x === W - 1 || x === W - 2 ? z : x;
      return y < y0 + 7 || u % 12 < 2 ? FR : glass;
    });
  }
  // Corner columns, central core, roof slab, parapet and plant.
  for (const [x, z] of [[0, 0], [W - 4, 0], [0, D - 4], [W - 4, D - 4]] as const) box(v, x, 0, z, x + 4, floors * 30, z + 4, FR);
  const cx = Math.floor(W / 2), cz = Math.floor(D / 2);
  walls(v, cx - 10, 0, cz - 10, cx + 10, floors * 30, cz + 10, 2, CO);
  box(v, 0, floors * 30, 0, W, floors * 30 + 3, D, CD);
  walls(v, 0, floors * 30 + 3, 0, W, floors * 30 + 5, D, 2, FR);
  box(v, cx - 15, floors * 30 + 3, cz - 12, cx + 15, H, cz + 12, (x) => (x % 4 === 0 ? k('steelDark') : k('steel')));
  // Lobby entrance with a canopy.
  opening(v, 'z0', 0, cx - 10, cx + 10, 3, 22, 2, G2, FR);
  box(v, cx - 14, 22, 0, cx + 14, 24, 6, FR);
  return v;
}

/** Water tower: tank on steel legs over a wooden maintenance shed with a rammable hazard door. */
function waterTower(k: K, o: BuildingOptions): VoxelVolume {
  const W = 60, D = 60, H = 110;
  const PL = (x: number, _y: number, z: number) => (Math.floor((x + z) / 4) % 2 ? k('plank') : k('plankDark'));
  const S = k('steel'), SD = k('steelDark'), TK = k('tank'), TD = k('tankDark'), O = k('orange');
  const v = new VoxelVolume(W, H, D);
  // Shed with a hazard-striped wooden door on the -z face (the mech waits inside).
  box(v, 12, 0, 12, 48, 1, 48, k('concreteDark'));
  walls(v, 12, 0, 12, 48, 28, 48, 2, PL);
  box(v, 11, 28, 11, 49, 30, 49, k('shingle'));
  opening(v, 'z0', 12, 18, 42, 1, 23, 2, hazard(k('hazardOrange'), k('hazardBlack'), 4), k('trim'));
  // Legs and bracing.
  const legs = [[4, 4], [52, 4], [4, 52], [52, 52]] as const;
  for (const [x, z] of legs) box(v, x, 0, z, x + 4, 64, z + 4, S);
  for (const y of [32, 50]) {
    box(v, 4, y, 5, 56, y + 2, 7, SD);
    box(v, 4, y, 53, 56, y + 2, 55, SD);
    box(v, 5, y, 4, 7, y + 2, 56, SD);
    box(v, 53, y, 4, 55, y + 2, 56, SD);
  }
  // Tank (hollow), walkway ring, orange band, conical roof and finial.
  cylY(v, 30, 30, 27, 62, 64, TD);
  cylY(v, 30, 30, 27, 64, 96, (_x, y) => (y >= 84 && y < 88 ? O : TK), 25);
  cylY(v, 30, 30, 29.5, 64, 65, SD, 27);
  for (let y = 96; y < 108; y++) cylY(v, 30, 30, 27 * (1 - (y - 96) / 12) + 0.5, y, y + 1, (y - 96) % 4 === 0 ? TD : TK);
  box(v, 29, 108, 29, 31, 110, 31, O);
  // Ladder up one leg.
  box(v, 8, 2, 3, 10, 62, 4, SD);
  void o;
  return v;
}

/** Hangar with an arched corrugated roof and a big hazard-striped door that can be rammed open. */
function mechShed(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 50, D = o.d ?? 50, wallH = 30;
  const corr = stripes(k('corrugated'), k('corrugatedDark'), 2);
  const half = W / 2;
  const profile = (d: number) => Math.sqrt(Math.max(0, half * half - (half - d) * (half - d))) * 0.4;
  const v = new VoxelVolume(W, wallH + Math.ceil(profile(half)) + 2, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, corr);
  roofZ(v, 0, W, 0, D, wallH, profile, 2, bandsY(k('steel'), k('steelDark'), 3), corr, 2);
  opening(v, 'z0', 0, 7, W - 7, 1, wallH - 3, 2, hazard(k('hazardOrange'), k('hazardBlack'), 5), k('steelDark'));
  box(v, Math.floor(half) - 8, wallH - 1, 0, Math.floor(half) + 8, wallH + 4, 1, k('signYellow'));
  return v;
}

/** Concrete grain silo (or blue metal, variant 1) with a domed cap and a ladder. */
function silo(k: K, o: BuildingOptions): VoxelVolume {
  const metal = (o.variant ?? 0) % 2 === 1;
  const W = 30, D = 30, bodyH = 76, H = 91;
  const A = metal ? k('blue') : k('concrete'), B = metal ? k('blueDark') : k('concreteDark');
  const v = new VoxelVolume(W, H, D);
  cylY(v, 15, 15, 14, 0, 2, B);
  cylY(v, 15, 15, 14, 2, bodyH, (_x, y) => (y === 26 || y === 51 ? B : A), 12);
  for (let y = bodyH; y < H - 1; y++) {
    const r = Math.sqrt(Math.max(0, 14 * 14 - (y - bodyH) * (y - bodyH) * (196 / 225)));
    cylY(v, 15, 15, r + 0.3, y, y + 1, (y - bodyH) % 4 === 0 ? k('steelDark') : k('chrome'));
  }
  box(v, 14, H - 1, 14, 16, H, 16, k('steelDark'));
  box(v, 14, 3, 0, 16, bodyH, 1, k('steelDark'));
  return v;
}

/** Wooden shed with a single-pitch roof. */
function shed(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 40, D = o.d ?? 30, front = 22, back = 17;
  const PL = (x: number, _y: number, z: number) => (Math.floor((x + z) / 3) % 2 ? k('plank') : k('plankDark'));
  const v = new VoxelVolume(W, front + 3, D);
  box(v, 0, 0, 0, W, 1, D, k('plankDark'));
  for (let z = 0; z < D; z++) {
    const top = Math.round(front - ((front - back) * z) / (D - 1));
    const wall = z < 2 || z >= D - 2;
    box(v, 0, 0, z, W, top, z + 1, (x, y, zz) => (wall || x < 2 || x >= W - 2 ? PL(x, y, zz) : 0));
    box(v, -1, top, z, W + 1, top + 2, z + 1, (x) => (x % 5 === 0 ? k('shingleDark') : k('shingle')));
  }
  opening(v, 'z0', 0, Math.floor(W / 2) - 6, Math.floor(W / 2) + 6, 1, 17, 2, k('door'), k('trim'));
  opening(v, 'x1', W - 1, 10, 18, 9, 15, 2, k('glassDark'), k('trim'));
  return v;
}

/** Warehouse: corrugated walls, roller doors, high windows, flat roof with parapet and skylights. */
function warehouse(k: K, o: BuildingOptions): VoxelVolume {
  const W = o.w ?? 120, D = o.d ?? 90, wallH = 44;
  const corr = stripes(k('corrugated'), k('corrugatedDark'), 2);
  const v = new VoxelVolume(W, wallH + 6, D);
  box(v, 0, 0, 0, W, 1, D, k('concreteDark'));
  walls(v, 0, 0, 0, W, wallH, D, 2, (x, y, z) => (y < 6 ? k('concreteDark') : at(corr, x, y, z)));
  box(v, 0, wallH, 0, W, wallH + 2, D, k('slate'));
  for (let z = 12; z + 6 < D - 8; z += 18) box(v, 10, wallH, z, W - 10, wallH + 2, z + 6, k('glass'));
  walls(v, 0, wallH + 2, 0, W, wallH + 6, D, 2, k('corrugatedDark'));
  const dw = 28;
  const doors = Math.max(1, Math.floor((W - 12) / 36));
  const gap = (W - 12 - doors * dw) / (doors + 1);
  for (let i = 0; i < doors; i++) {
    const x0 = Math.round(6 + gap + i * (dw + gap));
    opening(v, 'z0', 0, x0, x0 + dw, 1, 32, 2, bandsY(k('rollDoor'), k('rollDoorDark'), 2), k('hazardBlack'));
  }
  for (const face of ['x0', 'x1'] as const) windowRow(v, face, face === 'x0' ? 0 : W - 1, 6, D - 6, 34, 40, 2, 10, 16, k('glass'), k('steelDark'));
  box(v, 6, 36, 0, 34, 42, 1, k('signYellow'));
  return v;
}

function at(f: Fill, x: number, y: number, z: number): number {
  return typeof f === 'number' ? f : f(x, y, z);
}

/** Bonus-stage target: a bullseye board on a post. */
function target(k: K, o: BuildingOptions): VoxelVolume {
  const v = new VoxelVolume(30, 40, 10);
  const RD = k('awningRed'), WH = k('trim'), BK = k('hazardBlack');
  box(v, 5, 0, 2, 25, 2, 9, k('plankDark'));
  box(v, 13, 2, 4, 17, 20, 7, k('plank'));
  const alt = (o.variant ?? 0) % 2 === 1;
  for (let y = 13; y < 40; y++)
    for (let x = 1; x < 29; x++) {
      const d = Math.hypot(x + 0.5 - 15, y + 0.5 - 26);
      if (d > 13) continue;
      const ring = alt ? (Math.floor((x + y) / 4) % 2 ? RD : WH) : d > 12 ? BK : Math.floor(d / 3) % 2 ? WH : RD;
      box(v, x, y, 3, x + 1, y + 1, 5, ring);
    }
  return v;
}

export function buildBuildingModel(kind: BuildingKind, kit: ArtKit, opts: BuildingOptions = {}): VoxelVolume {
  const k: K = (n) => C(kit, n);
  switch (kind) {
    case 'barn':
      return barn(k, opts);
    case 'farmhouse':
      return farmhouse(k, opts);
    case 'gasStation':
      return gasStation(k, opts);
    case 'pump':
      return pump(k);
    case 'shop':
      return shop(k, opts);
    case 'depot':
      return depot(k, opts);
    case 'terrace':
      return terrace(k, opts);
    case 'office':
      return office(k, opts);
    case 'waterTower':
      return waterTower(k, opts);
    case 'mechShed':
      return mechShed(k, opts);
    case 'silo':
      return silo(k, opts);
    case 'shed':
      return shed(k, opts);
    case 'warehouse':
      return warehouse(k, opts);
    case 'house':
      return house(k, opts);
    case 'church':
      return church(k, opts);
    case 'garage':
      return garage(k, opts);
    case 'target':
      return target(k, opts);
  }
}
