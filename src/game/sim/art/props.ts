/** Prop models: gameplay pieces (TNT, blocks, beacons, ramps, track) and set dressing. */
import { hash3 } from '../../../voxel/build.ts';
import { VoxelVolume } from '../../../voxel/volume.ts';
import { PROP_DIMS, type ArtKit } from './kit.ts';
import { C, type ColorName } from './palette.ts';
import { box, clear, cylX, cylY, ellipsoid, shade, type Fill } from './shapes.ts';

type K = (n: ColorName) => number;

export type PropKind =
  | 'fence' | 'hay' | 'tree' | 'bush' | 'rduOff' | 'rduOn' | 'survivor' | 'tnt' | 'block' | 'mound'
  | 'ramp' | 'track' | 'loadingRamp' | 'ammo' | 'dish' | 'lamp' | 'wreck' | 'rock' | 'sign' | 'safePad';

export interface PropOptions {
  /** Size overrides in voxels (meaning depends on the prop: e.g. fence length along x, track length along z). */
  w?: number;
  h?: number;
  d?: number;
  length?: number;
  variant?: number;
}

/** Picket/rail fence along x: posts every 8 voxels and two rails. */
function fence(k: K, o: PropOptions): VoxelVolume {
  const L = o.length ?? o.w ?? 40;
  const c = (o.variant ?? 0) % 2 ? k('plank') : k('trim');
  const post = (o.variant ?? 0) % 2 ? k('plankDark') : k('plankGrey');
  const v = new VoxelVolume(L, 10, 2);
  for (let x = 0; x < L; x += 8) box(v, x, 0, 0, x + 2, 10, 2, post);
  box(v, 0, 3, 0, L, 5, 2, c);
  box(v, 0, 7, 0, L, 9, 2, c);
  return v;
}

/** Round hay bale (axis x) with twine bands; variant 1 is a square bale. */
function hay(k: K, o: PropOptions): VoxelVolume {
  const H = k('hay'), HD = k('hayDark');
  if ((o.variant ?? 0) % 2 === 1) {
    const v = new VoxelVolume(14, 9, 10);
    box(v, 0, 0, 0, 14, 9, 10, (x) => (x === 3 || x === 10 ? HD : H));
    return v;
  }
  const v = new VoxelVolume(12, 14, 14);
  cylX(v, 7, 7, 7, 0, 12, (x) => (x === 3 || x === 8 ? HD : H));
  cylX(v, 7, 7, 3, 0, 1, HD);
  cylX(v, 7, 7, 3, 11, 12, HD);
  return v;
}

/** Leafy tree (variant 0) or pine (variant 1). */
function tree(k: K, o: PropOptions, rng: () => number): VoxelVolume {
  const v = new VoxelVolume(28, 44, 28);
  const TR = k('trunk');
  if ((o.variant ?? 0) % 2 === 1) {
    box(v, 12, 0, 12, 16, 10, 16, TR);
    const P = k('pine'), PD = k('leafDark');
    for (let y = 8; y < 42; y++) {
      const t = (y - 8) / 34;
      const r = 12 * (1 - t) * (0.8 + 0.2 * ((y % 6) / 6)) + 1;
      cylY(v, 14, 14, r, y, y + 1, (y % 6) < 2 ? PD : P);
    }
    box(v, 13, 42, 13, 15, 44, 15, P);
    return v;
  }
  box(v, 12, 0, 12, 16, 22, 16, TR);
  const L = shade(k('leaf'), k('leafDark'), 8, 8, 8, 41);
  const j = () => (rng() - 0.5) * 3;
  ellipsoid(v, 14, 28, 14, 13, 11, 13, L);
  ellipsoid(v, 14 + j(), 33, 14 + j(), 9, 9, 9, (x, y, z) => (y > 36 ? k('leafLight') : typeof L === 'number' ? L : L(x, y, z)));
  ellipsoid(v, 8 + j(), 27, 16 + j(), 6, 6, 6, L);
  ellipsoid(v, 20 + j(), 27, 11 + j(), 6, 6, 6, L);
  return v;
}

function bush(k: K): VoxelVolume {
  const v = new VoxelVolume(16, 10, 16);
  ellipsoid(v, 8, 3, 8, 8, 7, 8, shade(k('leaf'), k('leafDark'), 4, 4, 4, 51));
  box(v, 5, 7, 5, 11, 9, 11, k('leafLight'));
  clear(v, 0, 9, 0, 16, 10, 16);
  return v;
}

/** RDU beacon: base, pole and a lamp — grey when off, bright green when on. */
function rdu(k: K, on: boolean): VoxelVolume {
  const [w, h, d] = PROP_DIMS.rdu;
  const v = new VoxelVolume(w, h, d);
  box(v, 0, 0, 0, w, 2, d, k('black'));
  box(v, 1, 2, 1, 3, 7, 3, k('steelDark'));
  box(v, 0, 7, 0, w, h, d, on ? k('rduOn') : k('steel'));
  if (!on) box(v, 1, 9, 1, 3, 10, 3, k('steelDark'));
  return v;
}

/** Survivor: a small person in bright clothes (variant picks the shirt). */
function survivor(k: K, o: PropOptions): VoxelVolume {
  const [w, h, d] = PROP_DIMS.survivor;
  const v = new VoxelVolume(w, h, d);
  const shirt = [k('shirtOrange'), k('shirtBlue'), k('shirtPink'), k('shirtGreen')][(o.variant ?? 0) % 4]!;
  box(v, 1, 0, 1, 2, 7, 3, k('pants'));
  box(v, 3, 0, 1, 4, 7, 3, k('pants'));
  box(v, 1, 7, 0, 4, 13, 4, shirt);
  box(v, 0, 8, 1, 1, 13, 3, shirt);
  box(v, 4, 8, 1, 5, 13, 3, shirt);
  box(v, 0, 13, 1, 1, 15, 3, k('skin'));
  box(v, 4, 13, 1, 5, 15, 3, k('skin'));
  box(v, 1, 13, 0, 4, 16, 4, k('skin'));
  box(v, 1, 16, 0, 4, 17, 4, k('hair'));
  box(v, 1, 15, 3, 4, 16, 4, k('hair'));
  return v;
}

/** TNT crate: red with dark bands and a cream label stripe. */
function tnt(k: K): VoxelVolume {
  const [w, h, d] = PROP_DIMS.tnt;
  const v = new VoxelVolume(w, h, d);
  const T = k('tnt'), B = k('tntBand'), L = k('tntLabel');
  box(v, 0, 0, 0, w, h, d, (x, y, z) => {
    if (y === 1 || y === 6) return B;
    const edge = (x === 0 || x === w - 1 ? 1 : 0) + (z === 0 || z === d - 1 ? 1 : 0) + (y === 0 || y === h - 1 ? 1 : 0);
    if (edge >= 2) return B;
    if ((y === 3 || y === 4) && (x === 0 || x === w - 1 || z === 0 || z === d - 1) && (x + z) % 3 !== 0) return L;
    return T;
  });
  return v;
}

/** Concrete block that fills a drainage pit: chevrons on top and sides. */
function block(k: K): VoxelVolume {
  const [w, h, d] = PROP_DIMS.block;
  const v = new VoxelVolume(w, h, d);
  const Y = k('chevronYellow'), B = k('chevronBlack'), G = k('block'), GD = k('blockDark');
  box(v, 0, 0, 0, w, h, d, (x, y, z) => {
    const top = y === h - 1, side = x === 0 || x === w - 1 || z === 0 || z === d - 1;
    if (top && (x < 3 || x >= w - 3 || z < 3 || z >= d - 3)) return Math.floor((x + z) / 3) % 2 ? Y : B;
    if (top) return Math.floor((Math.abs(x - w / 2) + z) / 5) % 2 ? G : GD;
    if (side && y >= h - 4) return Math.floor((x + z + y) / 3) % 2 ? Y : B;
    return y % 4 === 0 ? GD : G;
  });
  return v;
}

/** Dirt mound: a ridge you can drive over from either side along z, grassy on top. */
function mound(k: K, o: PropOptions): VoxelVolume {
  const W = o.w ?? 40, H = o.h ?? 12, D = o.d ?? 40;
  const v = new VoxelVolume(W, H, D);
  for (let z = 0; z < D; z++) {
    const t = 1 - Math.abs(z + 0.5 - D / 2) / (D / 2);
    const top = Math.min(H, Math.round(H * Math.min(1, t * 1.25)));
    if (top <= 0) continue;
    box(v, 0, 0, z, W, top, z + 1, (x, y) => (y === top - 1 ? ((x + z) % 7 === 0 ? k('dirt') : k('dirtGrass')) : Math.floor(y / 3) % 2 ? k('dirtDark') : k('dirt')));
  }
  return v;
}

/** Concrete launch ramp rising toward -z (the lip at z = 0 is hazard-striped). */
function ramp(k: K, o: PropOptions): VoxelVolume {
  const W = o.w ?? 40, H = o.h ?? 14, D = o.d ?? 50;
  const v = new VoxelVolume(W, H, D);
  for (let z = 0; z < D; z++) {
    const top = Math.max(1, Math.round(H * (1 - z / D)));
    box(v, 0, 0, z, W, top, z + 1, (x, y) => {
      if (y === top - 1 && z < 3) return Math.floor(x / 3) % 2 ? k('chevronYellow') : k('chevronBlack');
      if (x < 2 || x >= W - 2) return k('rampGreyDark');
      return y === top - 1 && z % 6 === 0 ? k('rampGreyDark') : k('rampGrey');
    });
  }
  return v;
}

/** Rail track along z: sleepers every 5 voxels and two steel rails. */
function track(k: K, o: PropOptions): VoxelVolume {
  const L = o.length ?? o.d ?? 100;
  const v = new VoxelVolume(30, 2, L);
  for (let z = 1; z < L; z += 5) box(v, 1, 0, z, 29, 1, z + 2, k('sleeper'));
  box(v, 5, 1, 0, 7, 2, L, k('rail'));
  box(v, 23, 1, 0, 25, 2, L, k('rail'));
  box(v, 5, 0, 0, 7, 1, L, k('rail'));
  box(v, 23, 0, 0, 25, 1, L, k('rail'));
  return v;
}

/** Loading ramp: platform (z 0..10) at full height, then a slope down toward +z. */
function loadingRamp(k: K, o: PropOptions): VoxelVolume {
  const W = o.w ?? 34, H = o.h ?? 12, D = o.d ?? 30;
  const v = new VoxelVolume(W, H, D);
  const flat = Math.min(10, D - 1);
  for (let z = 0; z < D; z++) {
    const top = z < flat ? H : Math.max(1, Math.round(H * (1 - (z - flat) / (D - flat))));
    box(v, 0, 0, z, W, top, z + 1, (x, y) => {
      if (y === top - 1 && z < 2) return Math.floor(x / 3) % 2 ? k('chevronYellow') : k('chevronBlack');
      if (x < 2 || x >= W - 2) return k('chevronYellow');
      return y % 4 === 0 ? k('blockDark') : k('block');
    });
  }
  return v;
}

/** Missile ammo crate: blue with a white missile stripe and yellow band. */
function ammo(k: K): VoxelVolume {
  const [w, h, d] = PROP_DIMS.ammo;
  const v = new VoxelVolume(w, h, d);
  box(v, 0, 0, 0, w, h, d, (x, y, z) => {
    if (y === h - 1 && x >= 2 && x < w - 2 && z >= 3 && z < 5) return k('trim');
    if (y === h - 1 && x >= 5 && x < 7 && z >= 2 && z < 6) return k('awningRed');
    if (y === 2) return k('signYellow');
    return k('ammoBlue');
  });
  return v;
}

/** Satellite dish on a pole, tilted up toward -z. */
function dish(k: K): VoxelVolume {
  const v = new VoxelVolume(20, 24, 20);
  box(v, 6, 0, 6, 14, 2, 14, k('steelDark'));
  box(v, 9, 2, 9, 11, 13, 11, k('steel'));
  const n = [0, Math.sin(0.6), -Math.cos(0.6)];
  const c = [10, 16, 10];
  for (let z = 0; z < 20; z++)
    for (let y = 8; y < 24; y++)
      for (let x = 0; x < 20; x++) {
        const d = [x + 0.5 - c[0]!, y + 0.5 - c[1]!, z + 0.5 - c[2]!];
        const h = d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!;
        const r = Math.hypot(d[0]! - h * n[0]!, d[1]! - h * n[1]!, d[2]! - h * n[2]!);
        if (r <= 9 && Math.abs(h - r * r * 0.035 + 1) <= 0.8) v.set(x, y, z, r > 8 ? k('steel') : k('white'));
      }
  for (let t = 0; t <= 6; t += 0.5) {
    const p = [c[0]! + n[0]! * t, c[1]! + n[1]! * t, c[2]! + n[2]! * t];
    v.set(Math.floor(p[0]!), Math.floor(p[1]!), Math.floor(p[2]!), t > 5 ? k('awningRed') : k('steelDark'));
  }
  return v;
}

function lamp(k: K): VoxelVolume {
  const v = new VoxelVolume(6, 40, 12);
  box(v, 1, 0, 7, 5, 2, 11, k('steelDark'));
  box(v, 2, 2, 8, 4, 36, 10, k('steelDark'));
  box(v, 2, 34, 2, 4, 36, 10, k('steelDark'));
  box(v, 1, 31, 1, 5, 34, 5, k('steel'));
  box(v, 2, 31, 2, 4, 32, 4, k('headlight'));
  return v;
}

/** Rusted wrecked car with dents and flat tires. */
function wreck(k: K, rng: () => number): VoxelVolume {
  const v = new VoxelVolume(20, 12, 40);
  const RU = k('rust'), RD = k('rustDark');
  const body: Fill = (x, y, z) => (hash3(x >> 2, y >> 2, z >> 2, 61) < 0.35 ? RD : RU);
  box(v, 1, 2, 2, 19, 6, 38, body);
  box(v, 3, 6, 12, 17, 10, 28, body);
  box(v, 4, 7, 12, 16, 9, 13, k('glassDark'));
  box(v, 4, 7, 27, 16, 9, 28, k('glassDark'));
  for (const [x0, z0] of [[0, 5], [16, 5], [0, 29], [16, 29]] as const) box(v, x0, 0, z0, x0 + 4, 3, z0 + 6, k('tire'));
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * 18) + 1, z = Math.floor(rng() * 34) + 3;
    clear(v, x, 5, z, x + 2, 6, z + 3);
  }
  return v;
}

/** Boulder: a few overlapping blobs in stone shades. */
function rock(k: K, rng: () => number): VoxelVolume {
  const v = new VoxelVolume(20, 14, 18);
  const S = (x: number, y: number, z: number) => {
    const h = hash3(x >> 2, y >> 2, z >> 2, 71);
    return h < 0.33 ? k('stone') : h < 0.66 ? k('stoneDark') : k('stoneLight');
  };
  ellipsoid(v, 10, 4, 9, 9.5, 7, 8.5, S);
  ellipsoid(v, 7 + rng() * 2, 8, 8 + rng() * 2, 6, 6, 6, S);
  ellipsoid(v, 13 + rng() * 2, 6, 10, 5, 5, 5, S);
  return v;
}

/** Warning sign on two posts (variant 1: plain yellow with a black border). */
function sign(k: K, o: PropOptions): VoxelVolume {
  const v = new VoxelVolume(20, 24, 4);
  box(v, 2, 0, 1, 4, 16, 3, k('plankDark'));
  box(v, 16, 0, 1, 18, 16, 3, k('plankDark'));
  const plain = (o.variant ?? 0) % 2 === 1;
  box(v, 0, 12, 0, 20, 24, 2, (x, y) => {
    if (!plain) return Math.floor((x + y) / 3) % 2 ? k('signYellow') : k('hazardBlack');
    return x === 0 || x === 19 || y === 12 || y === 23 ? k('hazardBlack') : k('signYellow');
  });
  return v;
}

/** Safe-zone landing pad: hazard-striped border, yellow field and a black ring. */
function safePad(k: K, o: PropOptions): VoxelVolume {
  const W = o.w ?? 80, D = o.d ?? 60;
  const v = new VoxelVolume(W, 1, D);
  const Y = k('chevronYellow'), B = k('chevronBlack');
  const cx = W / 2, cz = D / 2, r = Math.min(W, D) * 0.32;
  box(v, 0, 0, 0, W, 1, D, (x, _y, z) => {
    if (x < 4 || x >= W - 4 || z < 4 || z >= D - 4) return Math.floor((x + z) / 4) % 2 ? Y : B;
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    return d > r - 2 && d < r + 1 ? B : Y;
  });
  return v;
}

export function buildPropModel(kind: PropKind, kit: ArtKit, opts: PropOptions = {}): VoxelVolume {
  const k: K = (n) => C(kit, n);
  switch (kind) {
    case 'fence':
      return fence(k, opts);
    case 'hay':
      return hay(k, opts);
    case 'tree':
      return tree(k, opts, kit.rng);
    case 'bush':
      return bush(k);
    case 'rduOff':
      return rdu(k, false);
    case 'rduOn':
      return rdu(k, true);
    case 'survivor':
      return survivor(k, opts);
    case 'tnt':
      return tnt(k);
    case 'block':
      return block(k);
    case 'mound':
      return mound(k, opts);
    case 'ramp':
      return ramp(k, opts);
    case 'track':
      return track(k, opts);
    case 'loadingRamp':
      return loadingRamp(k, opts);
    case 'ammo':
      return ammo(k);
    case 'dish':
      return dish(k);
    case 'lamp':
      return lamp(k);
    case 'wreck':
      return wreck(k, kit.rng);
    case 'rock':
      return rock(k, kit.rng);
    case 'sign':
      return sign(k, opts);
    case 'safePad':
      return safePad(k, opts);
  }
}
