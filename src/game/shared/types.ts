/**
 * PATHBREAKERS contract between the game rules (simulation worker, src/game/sim) and the game client
 * (main thread, src/game/client: camera, input, UI, audio). Plain data only — everything here crosses
 * postMessage.
 */

export type VehicleKind = 'dozer' | 'truck' | 'buggy' | 'mech' | 'bike' | 'train' | 'semi';
export type CameraMode = 'overhead' | 'chase' | 'cockpit' | 'iso' | 'side' | 'tactical';
export type LevelId = 'cinder' | 'quarry';
export type ModeId = 'mission' | 'timeAttack';
export type Medal = 'bronze' | 'silver' | 'gold' | 'platinum';
export type XYZ = [number, number, number];

export const VEHICLE_NAMES: Record<VehicleKind, string> = {
  dozer: 'PLOWHORSE',
  truck: 'TAILWHIP',
  buggy: 'SKYLARK',
  mech: 'HAMMERHEAD',
  bike: 'LONGBOW',
  train: 'FREIGHT HOPPER',
  semi: 'COMMAND RIG',
};

export const CAMERA_MODES: readonly CameraMode[] = ['overhead', 'chase', 'cockpit', 'iso', 'side', 'tactical'];

/**
 * Mission flow:
 * loading → briefing (UI) → flyover (debrief camera) → countdown → running → clear (path clear, free
 * roam) → complete (results) | failed.
 */
export type MissionState = 'loading' | 'briefing' | 'flyover' | 'countdown' | 'running' | 'clear' | 'complete' | 'failed';

export interface StructureInfo {
  id: number;
  name: string;
  /** Center (world) and footprint size (m). */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  value: number;
  /** In the carrier's lane (must go before the carrier arrives). */
  inLane: boolean;
  /** Contains a survivor. */
  survivor: boolean;
}

export interface GapInfo {
  id: number;
  kind: 'rail' | 'pit';
  /** Lane interval covered by the gap (x, m) and z extent. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Sent once per level load (after the scene is built). */
export interface LevelStatic {
  level: LevelId;
  title: string;
  subtitle: string;
  /** Briefing lines shown before the mission. */
  briefing: string[];
  tips: string[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** Carrier line (null for bonus stages without a carrier). */
  lane: { x0: number; x1: number; z: number; width: number; speed: number } | null;
  structures: StructureInfo[];
  gaps: GapInfo[];
  totals: { buildings: number; survivors: number; rdus: number; dishes: number };
  /** Bonus stages: seconds allowed (0 = none) and medal times. */
  timeLimit: number;
  medalTimes: Record<Medal, number> | null;
  /** Time Attack medal times for this level (null = no time attack). */
  timeAttackTimes: Record<Medal, number> | null;
  /** Ground color map for the radar (same data the renderer uses). */
  map: { width: number; height: number; data: Uint8Array };
  /** RDU lamp positions (index = RDU id); lit ones arrive as `rdu` events / snapshot.litRdus. */
  rdus?: XYZ[];
  /** Satellite dish positions. */
  dishes?: XYZ[];
}

export interface MeterInfo {
  label: string;
  /** 0..1 */
  value: number;
  /** Ammo count etc. */
  count?: number;
}

/** 10 Hz state for the HUD, radar and camera hints. */
export interface GameSnapshot {
  state: MissionState;
  mode: ModeId;
  /** Mission clock (s) — starts at GO. */
  time: number;
  /** Seconds left in the countdown (3,2,1) or flyover. */
  countdown: number;
  carrier: {
    x: number;
    z: number;
    y: number;
    slot: number;
    /** 0..1 along the lane. */
    progress: number;
    fastForward: boolean;
    /** Seconds until the carrier reaches the next blocking obstacle (null = none). */
    eta: number | null;
    /** Id of the next blocking structure or gap (gaps are negative ids: -gapId). */
    next: number | null;
  } | null;
  player: {
    x: number;
    y: number;
    z: number;
    heading: number;
    onFoot: boolean;
    vehicle: VehicleKind | null;
    vehicleId: number | null;
    /** Transform slot to follow (0 = the walker). */
    slot: number;
    /** m/s */
    speed: number;
    meter: MeterInfo | null;
    /** Vehicle-specific activity (sliding, airborne, flying, stomping). */
    activity: string | null;
  };
  /** Context prompt ("E  Enter PLOWHORSE"). */
  prompt: string | null;
  counts: {
    buildings: [number, number];
    survivors: [number, number];
    rdus: [number, number];
    dishes: [number, number];
    damage: number;
  };
  /** Lane structures still blocking the carrier, with warning level 0 (green) .. 4 (dark red). */
  blockers: { id: number; eta: number; level: number }[];
  gaps: { id: number; filled: boolean }[];
  vehicles: { id: number; kind: VehicleKind; x: number; z: number; heading: number; occupied: boolean }[];
  /** Survivors revealed but not yet picked up. */
  survivors: { x: number; z: number }[];
  /** Unlit RDUs near the player (radar dots). */
  rdus: { x: number; z: number }[];
  /** Destroyed structure ids (radar). */
  destroyed: number[];
  /** Train flatbed lined up under the lane. */
  aligned: boolean;
  /** Bonus stage: remaining targets. */
  targetsLeft: number;
  /** Indices of lit RDUs (full list, for renderers that join mid-level). */
  litRdus?: number[];
  /** Survivors with a rescue animation/state for rendering. */
  survivorsAll?: { x: number; y: number; z: number; state: 'hidden' | 'waiting' | 'rescued' }[];
  /** Sliding/boost/stomp visual hints for the controlled vehicle's damage zone (world box), if active. */
  zone?: { center: XYZ; half: XYZ; yaw: number } | null;
}

export type GameEvent =
  | { e: 'collapse'; id: number; name: string; x: number; y: number; z: number; value: number; inLane: boolean }
  | { e: 'hit'; id: number; x: number; y: number; z: number; strength: number; vehicle: VehicleKind | null }
  | { e: 'impact'; x: number; y: number; z: number; strength: number }
  | { e: 'explosion'; x: number; y: number; z: number; radius: number }
  | { e: 'rdu'; index?: number; n: number; total: number; x: number; y: number; z: number }
  | { e: 'survivorFreed'; x: number; y: number; z: number }
  | { e: 'survivorRescued'; n: number; total: number }
  | { e: 'dish'; n: number; total: number }
  | { e: 'enter'; vehicle: VehicleKind }
  | { e: 'exit'; vehicle: VehicleKind }
  | { e: 'radio'; who: 'CHIEF' | 'SPARKS' | 'PILOT'; text: string }
  | { e: 'warning'; id: number; level: number }
  | { e: 'pathClear' }
  | { e: 'carrierSafe' }
  | { e: 'aligned'; ok: boolean }
  | { e: 'gapFilled'; id: number }
  | { e: 'fail'; reason: string; x: number; y: number; z: number }
  | { e: 'results'; results: MissionResults }
  | { e: 'countdown'; n: number }
  | { e: 'go' }
  | { e: 'fuse'; x: number; y: number; z: number; seconds: number }
  | { e: 'fire'; x: number; y: number; z: number }
  | { e: 'stomp'; x: number; y: number; z: number }
  | { e: 'turbo' }
  | { e: 'slide'; on: boolean }
  | { e: 'thrust'; on: boolean }
  | { e: 'horn' }
  | { e: 'land'; strength: number }
  | { e: 'reset' }
  | { e: 'pickup'; what: 'ammo' }
  | { e: 'target'; left: number };

export interface MissionResults {
  level: LevelId;
  mode: ModeId;
  /** Mission time (s). */
  time: number;
  carrierSafe: boolean;
  buildings: [number, number];
  survivors: [number, number];
  rdus: [number, number];
  dishes: [number, number];
  damage: number;
  medals: { carrier?: Medal; completion?: Medal; time?: Medal };
}

/** Per-frame input from the client. Press counters increment on each press (robust to dropped frames). */
export interface GameInput {
  /** Stick/keys: x = right, y = forward/throttle, each -1..1. */
  move: [number, number];
  /** Camera yaw (radians, 0 looks down -z). */
  camYaw: number;
  /** true: `move` is a desired direction relative to camYaw (iso/side/tactical); false: throttle/steer. */
  relative: boolean;
  /** First-person look (on foot and cockpit). */
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
  action: boolean;
  sprint: boolean;
  /** Press counters. */
  actionCount: number;
  jumpCount: number;
  enter: number;
  reset: number;
}

export type ClientMessage =
  | { t: 'input'; input: GameInput }
  /** Leave the briefing: start the flyover (mode chosen on the title/briefing screen). */
  | { t: 'start'; mode: ModeId }
  | { t: 'skipFlyover' }
  | { t: 'fastForward'; on: boolean }
  /** End the mission now (only after the path is clear) and show results. */
  | { t: 'finish' }
  /** Test hooks. */
  | { t: 'debug'; cmd: 'clearLane' | 'teleport' | 'win' | 'fail'; arg?: number[] };

export type SimMessage =
  | { k: 'static'; data: LevelStatic }
  | { k: 'snap'; data: GameSnapshot }
  | { k: 'events'; list: GameEvent[] };

/** localStorage save (key `pathbreakers.save.v1`). */
export interface SaveData {
  best: Partial<Record<`${LevelId}:${ModeId}`, { time: number; medals: MissionResults['medals']; completion: number }>>;
  unlocked: { quarry: boolean; timeAttack: boolean };
  settings: { music: number; sfx: number; camera: CameraMode; invertY: boolean; assist: boolean };
}
