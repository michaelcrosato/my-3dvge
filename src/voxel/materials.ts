/**
 * Physical materials. Density is kg/m³ (a 0.1 m voxel is 0.001 m³). Strength is relative blast
 * resistance: a blast of power P removes a voxel of strength S out to radius·√(P/S) (capped at radius).
 * Infinite strength = indestructible. `explosive` materials detonate when damaged or hit hard.
 */
export interface Material {
  id: number;
  name: MaterialName;
  density: number;
  strength: number;
  friction: number;
  restitution: number;
  explosive?: { radius: number; power: number };
}

export type MaterialName =
  | 'dirt' | 'grass' | 'wood' | 'concrete' | 'brick' | 'metal' | 'glass' | 'stone' | 'bedrock'
  | 'reinforced' | 'tnt' | 'foliage' | 'hay';

export const MATERIALS: readonly Material[] = [
  { id: 0, name: 'dirt', density: 1500, strength: 0.6, friction: 0.9, restitution: 0.05 },
  { id: 1, name: 'grass', density: 1400, strength: 0.6, friction: 0.9, restitution: 0.05 },
  { id: 2, name: 'wood', density: 600, strength: 0.8, friction: 0.7, restitution: 0.15 },
  { id: 3, name: 'concrete', density: 2400, strength: 1.5, friction: 0.8, restitution: 0.05 },
  { id: 4, name: 'brick', density: 1900, strength: 1.2, friction: 0.8, restitution: 0.05 },
  { id: 5, name: 'metal', density: 7800, strength: 4, friction: 0.5, restitution: 0.1 },
  { id: 6, name: 'glass', density: 2500, strength: 0.2, friction: 0.4, restitution: 0.1 },
  { id: 7, name: 'stone', density: 2600, strength: 2.5, friction: 0.8, restitution: 0.05 },
  { id: 8, name: 'bedrock', density: 3000, strength: Number.POSITIVE_INFINITY, friction: 0.9, restitution: 0 },
  /** Indestructible structural concrete (ramps, bridge decks, canal walls). */
  { id: 9, name: 'reinforced', density: 2400, strength: Number.POSITIVE_INFINITY, friction: 0.85, restitution: 0.02 },
  /** Detonates when carved or when its body takes a hard impact. */
  { id: 10, name: 'tnt', density: 700, strength: 0.3, friction: 0.7, restitution: 0.1, explosive: { radius: 3.4, power: 4 } },
  { id: 11, name: 'foliage', density: 300, strength: 0.3, friction: 0.8, restitution: 0.05 },
  { id: 12, name: 'hay', density: 250, strength: 0.25, friction: 0.9, restitution: 0.05 },
];

const byName = new Map(MATERIALS.map((m) => [m.name, m]));

export function materialByName(name: MaterialName): Material {
  const m = byName.get(name);
  if (!m) throw new Error(`Unknown material "${name}"`);
  return m;
}
