/**
 * Vehicle and carrier models. Every model faces -z (its front is the z = 0 side), origin at the min
 * corner, sized exactly to VEHICLE_DIMS / CARRIER_DIMS.
 */
import { VoxelVolume } from '../../../voxel/volume.ts';
import type { VehicleKind } from '../../shared/types.ts';
import { CARRIER_DIMS, VEHICLE_DIMS, type ArtKit } from './kit.ts';
import { C, type ColorName } from './palette.ts';
import { box, clear, cylX, cylZ, ellipsoid, hazard, wheelX } from './shapes.ts';

type K = (n: ColorName) => number;

function volumeFor(kind: VehicleKind): VoxelVolume {
  const [w, h, d] = VEHICLE_DIMS[kind];
  return new VoxelVolume(w, h, d);
}

/** PLOWHORSE — yellow bulldozer: big front blade, tracks, cab with hazard roof. */
function dozer(k: K): VoxelVolume {
  const v = volumeFor('dozer'); // 30 × 22 × 46
  const Y = k('yellow'), YD = k('yellowDark'), BK = k('black'), T = k('tire'), S = k('steel'), SD = k('steelDark');
  const G = k('glass'), HL = k('headlight'), TL = k('taillight'), O = k('orange');
  // Tracks with tread bands, rounded ends and road wheels on the outer faces.
  for (const [x0, x1, outer] of [[1, 8, 1], [22, 29, 28]] as const) {
    box(v, x0, 0, 10, x1, 8, 46, (x, y, z) => (y === 0 || y === 7 || z === 10 || z === 45 ? (Math.floor(z / 2) % 2 ? T : BK) : SD));
    clear(v, x0, 0, 10, x1, 2, 12);
    clear(v, x0, 6, 10, x1, 8, 12);
    clear(v, x0, 0, 44, x1, 2, 46);
    clear(v, x0, 6, 44, x1, 8, 46);
    for (const z of [15, 22, 29, 36, 42]) cylX(v, 4, z, 1.8, outer, outer + 1, S);
  }
  // Body, engine hood with grille and exhaust stack.
  box(v, 3, 7, 12, 27, 13, 46, Y);
  box(v, 3, 7, 12, 27, 8, 46, YD);
  box(v, 5, 13, 12, 25, 15, 26, Y);
  box(v, 7, 8, 12, 23, 12, 13, (x) => (x % 2 ? BK : SD));
  box(v, 18, 15, 16, 21, 21, 19, BK);
  // Cab: yellow frame, glass all round, hazard-striped roof.
  box(v, 6, 13, 26, 24, 21, 42, Y);
  box(v, 8, 15, 26, 22, 20, 27, G);
  box(v, 6, 15, 28, 7, 20, 40, G);
  box(v, 23, 15, 28, 24, 20, 40, G);
  box(v, 8, 15, 41, 22, 20, 42, G);
  box(v, 5, 21, 25, 25, 22, 43, hazard(O, BK, 3));
  // Counterweight and tail lights.
  box(v, 4, 7, 42, 26, 14, 46, YD);
  box(v, 5, 11, 45, 8, 13, 46, TL);
  box(v, 22, 11, 45, 25, 13, 46, TL);
  // Blade arms and hydraulic rams.
  box(v, 3, 5, 3, 7, 8, 13, SD);
  box(v, 23, 5, 3, 27, 8, 13, SD);
  box(v, 9, 9, 4, 11, 12, 14, S);
  box(v, 19, 9, 4, 21, 12, 14, S);
  // Headlights on the hood front.
  box(v, 5, 11, 11, 8, 13, 12, HL);
  box(v, 22, 11, 11, 25, 13, 12, HL);
  // The blade: dark cutting edge, curved face, hazard-striped top lip, side plates.
  box(v, 0, 0, 0, 30, 3, 3, BK);
  box(v, 0, 3, 1, 30, 13, 4, Y);
  box(v, 0, 13, 0, 30, 16, 3, hazard(O, BK, 3));
  box(v, 0, 0, 0, 1, 16, 5, YD);
  box(v, 29, 0, 0, 30, 16, 5, YD);
  return v;
}

/** TAILWHIP — blue dump truck with a heavy armored, hazard-striped rear. */
function truck(k: K): VoxelVolume {
  const v = volumeFor('truck'); // 26 × 26 × 56
  const B = k('blue'), BD = k('blueDark'), BK = k('black'), T = k('tire'), S = k('steel'), SD = k('steelDark');
  const G = k('glass'), HL = k('headlight'), TL = k('taillight'), O = k('orange'), ST = k('stone'), STD = k('stoneDark');
  box(v, 5, 4, 2, 21, 8, 54, SD);
  // Front bumper and headlights.
  box(v, 3, 3, 0, 23, 7, 2, BK);
  box(v, 4, 5, 0, 7, 7, 1, HL);
  box(v, 19, 5, 0, 22, 7, 1, HL);
  // Cab.
  box(v, 3, 7, 2, 23, 21, 16, B);
  box(v, 3, 7, 2, 23, 10, 16, BD);
  box(v, 5, 13, 2, 21, 19, 3, G);
  box(v, 3, 13, 5, 4, 19, 13, G);
  box(v, 22, 13, 5, 23, 19, 13, G);
  box(v, 3, 20, 2, 23, 21, 16, BD);
  box(v, 1, 14, 3, 3, 18, 4, BK);
  box(v, 23, 14, 3, 25, 18, 4, BK);
  // Dump bed: ribbed walls, cab guard canopy, gravel load.
  const ribbed = (_x: number, _y: number, z: number) => (z % 6 === 0 ? BD : B);
  box(v, 1, 8, 17, 25, 11, 51, BD);
  box(v, 1, 11, 17, 3, 22, 51, ribbed);
  box(v, 23, 11, 17, 25, 22, 51, ribbed);
  box(v, 1, 8, 16, 25, 26, 19, B);
  box(v, 3, 23, 6, 23, 26, 19, BD);
  box(v, 3, 11, 19, 23, 17, 50, (x, y, z) => ((x * 7 + z * 3 + y) % 11 < 5 ? ST : STD));
  // Armored rear plate — the damage end.
  box(v, 0, 6, 51, 26, 23, 56, hazard(O, BK, 4));
  box(v, 0, 23, 50, 26, 25, 56, S);
  box(v, 1, 8, 55, 4, 10, 56, TL);
  box(v, 22, 8, 55, 25, 10, 56, TL);
  // Wheels (front + tandem rear).
  for (const cz of [9, 36, 46]) {
    wheelX(v, 0, 5, 5, cz, 5, T, S);
    wheelX(v, 21, 26, 5, cz, 5, T, S);
  }
  return v;
}

/** SKYLARK — red dune buggy: open roll cage, big wheels, rocket booster. */
function buggy(k: K): VoxelVolume {
  const v = volumeFor('buggy'); // 20 × 14 × 34
  const R = k('red'), RD = k('redDark'), BK = k('black'), T = k('tire'), S = k('steel'), SD = k('steelDark');
  const HL = k('headlight'), O = k('orange'), W = k('white'), SH = k('shirtOrange'), V = k('visor');
  box(v, 4, 3, 2, 16, 5, 32, RD);
  box(v, 5, 5, 0, 15, 8, 9, R);
  box(v, 6, 6, 0, 8, 8, 1, HL);
  box(v, 12, 6, 0, 14, 8, 1, HL);
  box(v, 4, 5, 10, 6, 8, 25, R);
  box(v, 14, 5, 10, 16, 8, 25, R);
  // Seat and driver.
  box(v, 7, 5, 14, 13, 7, 20, BK);
  box(v, 7, 7, 19, 13, 11, 21, BK);
  box(v, 8, 7, 15, 12, 10, 18, SH);
  box(v, 8, 10, 15, 12, 13, 18, W);
  box(v, 8, 11, 15, 12, 12, 16, V);
  // Roll cage.
  for (const [x0, z0] of [[4, 9], [14, 9], [4, 22], [14, 22]] as const) box(v, x0, 5, z0, x0 + 2, 14, z0 + 2, R);
  box(v, 4, 12, 9, 6, 14, 24, R);
  box(v, 14, 12, 9, 16, 14, 24, R);
  box(v, 4, 12, 9, 16, 14, 11, R);
  box(v, 4, 12, 22, 16, 14, 24, R);
  // Engine, booster nozzle, spoiler.
  box(v, 6, 5, 25, 14, 10, 32, S);
  box(v, 8, 6, 32, 12, 10, 34, BK);
  box(v, 9, 7, 33, 11, 9, 34, O);
  box(v, 7, 10, 29, 9, 12, 31, SD);
  box(v, 11, 10, 29, 13, 12, 31, SD);
  box(v, 3, 12, 28, 17, 13, 33, RD);
  // Wheels.
  wheelX(v, 0, 4, 4.5, 7, 4.5, T, S);
  wheelX(v, 16, 20, 4.5, 7, 4.5, T, S);
  wheelX(v, 0, 4, 5, 26, 5, T, S);
  wheelX(v, 16, 20, 5, 26, 5, T, S);
  return v;
}

/** HAMMERHEAD — chrome stomp mech with a jetpack. */
function mech(k: K): VoxelVolume {
  const v = volumeFor('mech'); // 18 × 30 × 16
  const CH = k('chrome'), S = k('steel'), SD = k('steelDark'), BK = k('black'), O = k('orange'), V = k('visor'), W = k('white');
  // Feet, shins, knees, thighs.
  box(v, 2, 0, 1, 8, 3, 14, SD);
  box(v, 10, 0, 1, 16, 3, 14, SD);
  box(v, 3, 3, 5, 7, 10, 11, S);
  box(v, 11, 3, 5, 15, 10, 11, S);
  box(v, 3, 8, 4, 7, 11, 6, CH);
  box(v, 11, 8, 4, 15, 11, 6, CH);
  box(v, 3, 10, 5, 7, 13, 11, CH);
  box(v, 11, 10, 5, 15, 13, 11, CH);
  // Pelvis, torso with hazard chest band, shoulders, arms and fists.
  box(v, 3, 12, 5, 15, 15, 11, SD);
  box(v, 2, 15, 3, 16, 25, 13, CH);
  box(v, 4, 17, 3, 14, 23, 4, W);
  box(v, 2, 23, 3, 16, 25, 4, hazard(O, BK, 2));
  box(v, 0, 21, 4, 3, 25, 11, SD);
  box(v, 15, 21, 4, 18, 25, 11, SD);
  box(v, 0, 14, 5, 2, 21, 10, S);
  box(v, 16, 14, 5, 18, 21, 10, S);
  box(v, 0, 10, 4, 2, 14, 10, SD);
  box(v, 16, 10, 4, 18, 14, 10, SD);
  // Head with visor.
  box(v, 6, 25, 4, 12, 30, 11, CH);
  box(v, 6, 26, 4, 12, 28, 5, V);
  box(v, 8, 29, 6, 10, 30, 9, O);
  // Jetpack with two thrusters (glowing nozzles).
  box(v, 4, 15, 13, 14, 27, 16, SD);
  box(v, 5, 24, 13, 13, 26, 16, hazard(O, BK, 2));
  box(v, 5, 12, 13, 8, 15, 16, BK);
  box(v, 10, 12, 13, 13, 15, 16, BK);
  box(v, 6, 12, 14, 7, 13, 15, O);
  box(v, 11, 12, 14, 12, 13, 15, O);
  return v;
}

/** LONGBOW — green missile bike with side launch pods. */
function bike(k: K): VoxelVolume {
  const v = volumeFor('bike'); // 10 × 14 × 24
  const G = k('green'), GD = k('greenDark'), BK = k('black'), T = k('tire'), S = k('steel');
  const HL = k('headlight'), TL = k('taillight'), R = k('red'), W = k('white'), SH = k('shirtOrange'), V = k('visor');
  wheelX(v, 4, 6, 4, 5, 4, T, S);
  wheelX(v, 4, 6, 4, 19, 4, T, S);
  box(v, 4, 4, 4, 6, 11, 6, S);
  box(v, 3, 5, 7, 7, 9, 18, G);
  box(v, 3, 9, 7, 7, 11, 12, G);
  box(v, 3, 9, 12, 7, 10, 17, BK);
  box(v, 1, 11, 5, 9, 12, 7, BK);
  box(v, 4, 9, 3, 6, 11, 4, HL);
  box(v, 4, 9, 23, 6, 10, 24, TL);
  box(v, 7, 4, 16, 8, 6, 22, S);
  // Launch pods with red missile tips.
  box(v, 0, 6, 8, 2, 10, 16, GD);
  box(v, 8, 6, 8, 10, 10, 16, GD);
  box(v, 0, 7, 7, 2, 9, 8, R);
  box(v, 8, 7, 7, 10, 9, 8, R);
  // Rider.
  box(v, 3, 9, 11, 7, 11, 14, k('pants'));
  box(v, 3, 10, 12, 7, 13, 15, SH);
  box(v, 4, 11, 10, 6, 14, 13, W);
  box(v, 4, 12, 10, 6, 13, 11, V);
  return v;
}

/** FREIGHT HOPPER — brown locomotive (front, z 0..40) + wooden flatbed deck (rear 50, top at y = 12). */
function train(k: K): VoxelVolume {
  const v = volumeFor('train'); // 30 × 26 × 90
  const BR = k('brown'), RU = k('rust'), BK = k('black'), S = k('steel'), SD = k('steelDark'), G = k('glass');
  const HL = k('headlight'), O = k('orange'), Y = k('yellow'), PL = k('plank'), PD = k('plankDark');
  // Locomotive.
  box(v, 1, 4, 1, 29, 7, 40, SD);
  box(v, 3, 0, 0, 27, 5, 2, hazard(O, BK, 3));
  box(v, 4, 7, 2, 26, 19, 26, (_x, y) => (y === 10 || y === 11 ? Y : y >= 17 ? RU : BR));
  clear(v, 4, 17, 2, 6, 19, 26);
  clear(v, 24, 17, 2, 26, 19, 26);
  box(v, 13, 15, 1, 17, 18, 2, HL);
  box(v, 12, 19, 8, 15, 23, 11, BK);
  box(v, 8, 19, 16, 22, 20, 22, S);
  box(v, 2, 7, 26, 28, 24, 40, (_x, y) => (y === 10 || y === 11 ? Y : BR));
  box(v, 4, 16, 26, 26, 21, 27, G);
  box(v, 2, 16, 29, 3, 21, 37, G);
  box(v, 27, 16, 29, 28, 21, 37, G);
  box(v, 1, 24, 25, 29, 26, 40, SD);
  // Bogies (loco and flatbed).
  for (const cz of [6, 14, 26, 34, 46, 54, 76, 84]) {
    wheelX(v, 1, 4, 3, cz, 3, BK, S);
    wheelX(v, 26, 29, 3, cz, 3, BK, S);
  }
  // Flatbed: frame, coupler, plank deck with hazard edges — flat on top at y = 12.
  box(v, 1, 4, 40, 29, 8, 90, SD);
  box(v, 13, 5, 38, 17, 7, 42, BK);
  box(v, 0, 8, 40, 30, 12, 90, (x, _y, z) => (x < 2 || x >= 28 ? (Math.floor(z / 4) % 2 ? Y : BK) : Math.floor(z / 6) % 2 ? PL : PD));
  return v;
}

/** COMMAND RIG — white semi cab and trailer in PATHBREAKERS orange livery. */
function semi(k: K): VoxelVolume {
  const v = volumeFor('semi'); // 28 × 34 × 120
  const W = k('white'), O = k('orange'), BK = k('black'), T = k('tire'), S = k('steel'), SD = k('steelDark');
  const CH = k('chrome'), G = k('glass'), HL = k('headlight'), TL = k('taillight');
  box(v, 4, 4, 2, 24, 8, 118, SD);
  // Tractor: bumper, hood, grille, cab, fairing, stacks.
  box(v, 2, 3, 0, 26, 7, 2, CH);
  box(v, 3, 4, 0, 6, 6, 1, HL);
  box(v, 22, 4, 0, 25, 6, 1, HL);
  box(v, 4, 7, 1, 24, 17, 12, W);
  box(v, 8, 8, 1, 20, 16, 2, (_x, y) => (y % 2 ? CH : SD));
  box(v, 3, 7, 10, 25, 30, 30, W);
  box(v, 5, 19, 10, 23, 26, 11, G);
  box(v, 3, 19, 12, 4, 26, 20, G);
  box(v, 24, 19, 12, 25, 26, 20, G);
  box(v, 4, 30, 14, 24, 34, 30, W);
  box(v, 3, 12, 1, 25, 15, 30, (x, _y, z) => (x === 3 || x === 24 || z <= 1 ? O : W));
  box(v, 2, 18, 26, 4, 32, 28, CH);
  box(v, 24, 18, 26, 26, 32, 28, CH);
  // Coupling gap, then the trailer with livery stripes and chevrons.
  box(v, 10, 8, 30, 18, 10, 36, BK);
  box(v, 1, 9, 36, 27, 32, 120, (x, y, z) => {
    const side = x < 2 || x >= 25;
    if (y >= 12 && y < 15) return O;
    if (y === 15) return BK;
    if (side && y >= 18 && y < 29 && z >= 56 && z < 100) return Math.floor((z + Math.abs(y - 23)) / 5) % 2 ? O : W;
    return W;
  });
  box(v, 2, 10, 118, 26, 31, 120, (x) => (x === 13 || x === 14 ? SD : S));
  box(v, 3, 10, 119, 6, 12, 120, TL);
  box(v, 22, 10, 119, 25, 12, 120, TL);
  // Wheels.
  for (const cz of [9, 24, 33, 98, 110]) {
    wheelX(v, 0, 5, 5, cz, 5, T, S);
    wheelX(v, 23, 28, 5, cz, 5, T, S);
  }
  return v;
}

/** The Hazard Carrier: 6-wheeled transporter, cab at the front, two glowing fusion cores. */
export function buildCarrierModel(kit: ArtKit): VoxelVolume {
  const k: K = (n) => C(kit, n);
  const [w, h, d] = CARRIER_DIMS; // 30 × 26 × 76
  const v = new VoxelVolume(w, h, d);
  const Y = k('yellow'), BK = k('black'), T = k('tire'), S = k('steel'), SD = k('steelDark'), W = k('white');
  const G = k('glassDark'), O = k('orange'), CO = k('core'), COD = k('coreDark'), TL = k('taillight'), HL = k('headlight');
  // Chassis with hazard side skirts.
  box(v, 4, 4, 1, 26, 10, 75, SD);
  box(v, 3, 6, 1, 27, 10, 75, (x, y, z) => (x === 3 || x === 26 ? (Math.floor((y + z) / 3) % 2 ? Y : BK) : SD));
  box(v, 3, 3, 0, 27, 8, 2, hazard(Y, BK, 3));
  box(v, 4, 4, 0, 7, 6, 1, HL);
  box(v, 23, 4, 0, 26, 6, 1, HL);
  // Cab with dark glass, door warning panels and an orange light bar.
  box(v, 3, 10, 1, 27, 23, 18, W);
  box(v, 5, 15, 1, 25, 21, 2, G);
  box(v, 3, 15, 4, 4, 21, 12, G);
  box(v, 26, 15, 4, 27, 21, 12, G);
  box(v, 3, 11, 12, 4, 14, 17, Y);
  box(v, 26, 11, 12, 27, 14, 17, Y);
  box(v, 6, 23, 5, 24, 25, 9, (x) => (x < 9 || x >= 21 ? O : S));
  box(v, 6, 25, 6, 9, 26, 8, O);
  box(v, 21, 25, 6, 24, 26, 8, O);
  // Deck, cradles and the two fusion cores (glowing capsules with containment rings).
  box(v, 3, 10, 18, 27, 12, 75, SD);
  for (const z0 of [28, 44, 60]) box(v, 3, 12, z0, 27, 14, z0 + 3, S);
  const coreFill = (_x: number, y: number, z: number) => (z % 8 < 2 ? S : y >= 18 ? CO : COD);
  for (const cx of [9.5, 20.5]) {
    cylZ(v, cx, 17, 5, 26, 70, coreFill);
    ellipsoid(v, cx, 17, 26, 5, 5, 4, CO);
    ellipsoid(v, cx, 17, 70, 5, 5, 4, CO);
  }
  // Rear bumper with hazard stripes and tail lights.
  box(v, 3, 8, 73, 27, 14, 76, hazard(Y, BK, 3));
  box(v, 4, 11, 75, 7, 13, 76, TL);
  box(v, 23, 11, 75, 26, 13, 76, TL);
  // Six wheels.
  for (const cz of [12, 38, 62]) {
    wheelX(v, 0, 5, 5, cz, 5, T, S);
    wheelX(v, 25, 30, 5, cz, 5, T, S);
  }
  return v;
}

export function buildVehicleModel(kind: VehicleKind, kit: ArtKit): VoxelVolume {
  const k: K = (n) => C(kit, n);
  switch (kind) {
    case 'dozer':
      return dozer(k);
    case 'truck':
      return truck(k);
    case 'buggy':
      return buggy(k);
    case 'mech':
      return mech(k);
    case 'bike':
      return bike(k);
    case 'train':
      return train(k);
    case 'semi':
      return semi(k);
  }
}
