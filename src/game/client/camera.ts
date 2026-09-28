/**
 * Camera rig for PATHBREAKERS: six play modes (overhead ¾ chase like the original, low chase, cockpit,
 * isometric, 2.5D side and tactical top-down), a carrier view, the debrief flyover, the title attract
 * orbit and a failure orbit. All motion is critically damped so cuts never feel jarring.
 */
import * as THREE from 'three/webgpu';
import type { CameraMode, LevelStatic, VehicleKind } from '../shared/types.ts';

export interface CameraTarget {
  pos: THREE.Vector3;
  /** Heading yaw of the followed entity (vehicle forward or walker facing). */
  heading: number;
  vehicle: VehicleKind | null;
  speed: number;
}

export type CameraScript = 'play' | 'title' | 'flyover' | 'fail' | 'carrier';

const ISO_PITCH = -Math.atan(1 / Math.SQRT2); // true isometric (35.26°)

function damp(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

function vehicleScale(kind: VehicleKind | null): number {
  return kind === 'semi' || kind === 'train' ? 1.35 : kind === 'bike' || kind === null ? 0.8 : kind === 'dozer' || kind === 'truck' ? 1.1 : 1;
}

export class CameraRig {
  mode: CameraMode = 'overhead';
  script: CameraScript = 'title';
  /** Iso view rotation in quarter turns. */
  isoTurns = 0;
  /** User orbit offset (mouse/right stick) around the chase direction. */
  orbit = 0;
  level: LevelStatic | null = null;
  /** Current camera yaw (for camera-relative input). */
  yaw = 0;
  readonly pos = new THREE.Vector3(0, 40, 60);
  readonly look = new THREE.Vector3();
  private followYaw = 0;
  private shakeAmp = 0;
  private scriptTime = 0;
  private failAt = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private snapNext = true;

  setScript(s: CameraScript, at?: THREE.Vector3): void {
    if (s !== this.script) this.scriptTime = 0;
    this.script = s;
    if (at) this.failAt.copy(at);
  }

  /** Jump instead of easing on the next update (level loads). */
  cut(): void {
    this.snapNext = true;
  }

  shake(amount: number): void {
    this.shakeAmp = Math.min(1.6, this.shakeAmp + amount);
  }

  /** Distance from the camera to what it follows (for fog/far adjustment). */
  distance(): number {
    switch (this.mode) {
      case 'iso':
        return 70;
      case 'tactical':
        return 75;
      case 'side':
        return 34;
      case 'chase':
        return 9;
      case 'cockpit':
        return 0;
      default:
        return 18;
    }
  }

  /** Movement relative to the camera (true) or car-style throttle/steer (false). */
  relativeInput(onFoot: boolean): boolean {
    return onFoot || this.mode === 'iso' || this.mode === 'side' || this.mode === 'tactical';
  }

  update(dt: number, camera: THREE.PerspectiveCamera, target: CameraTarget, look: { yaw: number; pitch: number }, carrier: THREE.Vector3 | null, laneAhead: THREE.Vector3 | null): void {
    this.scriptTime += dt;
    let fov = 55;
    let k = 5;
    switch (this.script) {
      case 'title': {
        const L = this.level;
        const cx = L ? (L.bounds.x0 + L.bounds.x1) / 2 : 0;
        const a = this.scriptTime * 0.05;
        this.desiredPos.set(cx + Math.cos(a) * 95, 48, Math.sin(a) * 70);
        this.desiredLook.set(cx, 0, 0);
        fov = 45;
        k = 2;
        break;
      }
      case 'flyover': {
        const lane = this.level?.lane;
        if (lane) {
          const u = Math.min(1, this.scriptTime / 7.5);
          const e = u * u * (3 - 2 * u);
          const x = lane.x0 - 10 + (lane.x1 - lane.x0 + 20) * e;
          this.desiredPos.set(x - 18, 26, lane.z + 26);
          this.desiredLook.set(x + 12, 0, lane.z);
        }
        fov = 50;
        k = 3;
        break;
      }
      case 'fail': {
        const a = this.scriptTime * 0.35;
        this.desiredPos.set(this.failAt.x + Math.cos(a) * 32, 20 + this.scriptTime * 1.5, this.failAt.z + Math.sin(a) * 32);
        this.desiredLook.copy(this.failAt);
        fov = 55;
        k = 3;
        break;
      }
      case 'carrier': {
        if (carrier) {
          this.desiredPos.set(carrier.x - 16, 11, carrier.z + 10);
          this.desiredLook.copy(laneAhead ?? carrier).setY(1);
        }
        fov = 55;
        k = 4;
        break;
      }
      default:
        fov = this.playCamera(dt, target, look);
        k = this.mode === 'cockpit' ? 30 : this.mode === 'chase' ? 7 : 5;
    }

    if (this.snapNext) {
      this.pos.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.snapNext = false;
    } else {
      this.pos.lerp(this.desiredPos, damp(k, dt));
      this.look.lerp(this.desiredLook, damp(k * 1.6, dt));
    }
    camera.position.copy(this.pos);
    if (this.shakeAmp > 0.001) {
      const s = this.shakeAmp;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
      this.shakeAmp *= Math.exp(-dt * 7);
    }
    if (this.script === 'play' && this.mode === 'cockpit') {
      camera.rotation.set(look.pitch, this.yaw, 0, 'YXZ');
    } else {
      camera.lookAt(this.look);
    }
    this.yaw = this.script === 'play' ? this.yaw : Math.atan2(-(this.look.x - this.pos.x), -(this.look.z - this.pos.z));
    if (camera.fov !== fov) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      if (Math.abs(camera.fov - fov) < 0.05) camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  private playCamera(dt: number, target: CameraTarget, look: { yaw: number; pitch: number }): number {
    const t = target.pos;
    const s = vehicleScale(target.vehicle);
    // Vehicles: follow their heading (with the user's orbit offset). On foot: the user's orbit is the yaw.
    if (target.vehicle && target.vehicle !== 'train') {
      const lag = this.mode === 'chase' ? 4 : 2.2;
      const d = Math.atan2(Math.sin(target.heading - this.followYaw), Math.cos(target.heading - this.followYaw));
      if (target.speed > 0.8 || this.mode === 'chase') this.followYaw += d * damp(lag, dt);
    } else {
      this.followYaw = look.yaw;
    }
    switch (this.mode) {
      case 'chase': {
        const yaw = this.followYaw + this.orbit;
        this.yaw = yaw;
        const dist = 8.5 * s, h = 3.2 * s;
        this.desiredPos.set(t.x + Math.sin(yaw) * dist, t.y + h, t.z + Math.cos(yaw) * dist);
        this.desiredLook.set(t.x - Math.sin(yaw) * 4, t.y + 1.2, t.z - Math.cos(yaw) * 4);
        return 68;
      }
      case 'cockpit': {
        const yaw = target.vehicle ? target.heading + this.orbit : look.yaw;
        this.yaw = yaw;
        const up = target.vehicle ? (target.vehicle === 'mech' ? 1.3 : 0.9) : 0.7;
        const fwd = target.vehicle ? (target.vehicle === 'mech' ? 0.3 : 0.6) : 0;
        this.desiredPos.set(t.x - Math.sin(yaw) * fwd, t.y + up, t.z - Math.cos(yaw) * fwd);
        this.desiredLook.set(this.desiredPos.x - Math.sin(yaw), this.desiredPos.y, this.desiredPos.z - Math.cos(yaw));
        return 75;
      }
      case 'iso': {
        const yaw = Math.PI / 4 + (this.isoTurns * Math.PI) / 2;
        this.yaw = yaw;
        const d = 70, cp = Math.cos(ISO_PITCH);
        this.desiredPos.set(t.x + Math.sin(yaw) * d * cp, t.y + -Math.sin(ISO_PITCH) * d, t.z + Math.cos(yaw) * d * cp);
        this.desiredLook.set(t.x, t.y, t.z);
        return 19;
      }
      case 'side': {
        this.yaw = 0;
        this.desiredPos.set(t.x, t.y + 7, t.z + 34);
        this.desiredLook.set(t.x, t.y + 1.5, t.z);
        return 32;
      }
      case 'tactical': {
        this.yaw = 0;
        this.desiredPos.set(t.x, t.y + 75, t.z + 12);
        this.desiredLook.set(t.x, t.y, t.z);
        return 40;
      }
      default: {
        // Overhead ¾ chase (the original's default).
        const yaw = this.followYaw + this.orbit;
        this.yaw = yaw;
        const dist = 13 * s, h = 12 * s;
        this.desiredPos.set(t.x + Math.sin(yaw) * dist, t.y + h, t.z + Math.cos(yaw) * dist);
        this.desiredLook.set(t.x - Math.sin(yaw) * 3, t.y + 0.5, t.z - Math.cos(yaw) * 3);
        return 55;
      }
    }
  }

  /** Keep the camera out of the ground. */
  clampAboveGround(camera: THREE.PerspectiveCamera, groundAt: (x: number, z: number) => number): void {
    const g = groundAt(camera.position.x, camera.position.z);
    if (Number.isFinite(g) && camera.position.y < g + 0.6) camera.position.y = g + 0.6;
    void this.tmp;
  }
}
