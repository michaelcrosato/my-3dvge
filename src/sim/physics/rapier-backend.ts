import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Quat, Vec3 } from '../../shared/protocol.ts';
import type {
  BodyHandle, BodyOptions, BodyType, BoxShape, CharacterHandle, CharacterOptions, ColliderGroup, PhysicsBackend,
  RayHit, VehicleHandle, WheelControl, WheelDesc,
} from './backend.ts';

type World = InstanceType<typeof RAPIER.World>;
type RigidBody = InstanceType<typeof RAPIER.RigidBody>;
type Collider = InstanceType<typeof RAPIER.Collider>;
type Controller = InstanceType<typeof RAPIER.KinematicCharacterController>;
type VehicleController = InstanceType<typeof RAPIER.DynamicRayCastVehicleController>;

interface Character {
  body: RigidBody;
  collider: Collider;
  controller: Controller;
}

let initialized: Promise<void> | null = null;

/** Rapier (WASM, SIMD build) implementation of PhysicsBackend. */
export class RapierBackend implements PhysicsBackend {
  readonly name = 'rapier3d-simd';
  private readonly world: World;
  private readonly bodies = new Map<number, RigidBody>();
  private readonly groups = new Map<number, Collider[]>();
  private readonly characters = new Map<number, Character>();
  private readonly vehicles = new Map<number, { controller: VehicleController; wheels: number }>();
  private nextGroup = 1;
  private nextCharacter = 1;
  private nextVehicle = 1;

  static async create(gravityY = -9.81): Promise<RapierBackend> {
    initialized ??= RAPIER.init();
    await initialized;
    return new RapierBackend(gravityY);
  }

  private constructor(gravityY: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.world.timestep = 1 / 60;
  }

  setGravity(y: number): void {
    this.world.gravity = { x: 0, y, z: 0 };
    for (const b of this.bodies.values()) if (b.isDynamic()) b.wakeUp();
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  createBody(type: BodyType, p: Vec3, q: Quat, o: BodyOptions = {}): BodyHandle {
    const desc =
      type === 'fixed'
        ? RAPIER.RigidBodyDesc.fixed()
        : type === 'dynamic'
          ? RAPIER.RigidBodyDesc.dynamic()
              .setLinearDamping(o.linearDamping ?? 0.05)
              .setAngularDamping(o.angularDamping ?? 0.15)
              .setCanSleep(o.canSleep ?? true)
          : RAPIER.RigidBodyDesc.kinematicPositionBased();
    desc.setTranslation(p[0], p[1], p[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    if (o.ccd) desc.setCcdEnabled(true);
    if (o.gravityScale !== undefined) desc.setGravityScale(o.gravityScale);
    const body = this.world.createRigidBody(desc);
    this.bodies.set(body.handle, body);
    return body.handle;
  }

  removeBody(h: BodyHandle): void {
    const b = this.bodies.get(h);
    if (!b) return;
    this.bodies.delete(h);
    this.world.removeRigidBody(b);
  }

  addBoxes(h: BodyHandle, boxes: readonly BoxShape[]): ColliderGroup {
    const body = this.bodies.get(h);
    if (!body) throw new Error(`addBoxes: unknown body ${h}`);
    const list: Collider[] = [];
    for (const b of boxes) {
      const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.cx, b.cy, b.cz)
        .setFriction(b.friction)
        .setRestitution(b.restitution);
      if (b.mass) {
        const m = b.mass;
        desc.setMassProperties(m.mass, { x: m.com[0], y: m.com[1], z: m.com[2] }, { x: m.inertia[0], y: m.inertia[1], z: m.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
      } else {
        desc.setDensity(b.density);
      }
      if (b.sensor) desc.setSensor(true);
      list.push(this.world.createCollider(desc, body));
    }
    const g = this.nextGroup++;
    this.groups.set(g, list);
    return g;
  }

  removeColliders(g: ColliderGroup): void {
    const list = this.groups.get(g);
    if (!list) return;
    this.groups.delete(g);
    for (const c of list) this.world.removeCollider(c, true);
  }

  readTransform(h: BodyHandle, out: Float32Array, o: number): void {
    const b = this.bodies.get(h);
    if (!b) return;
    const t = b.translation();
    const r = b.rotation();
    out[o] = t.x;
    out[o + 1] = t.y;
    out[o + 2] = t.z;
    out[o + 3] = r.x;
    out[o + 4] = r.y;
    out[o + 5] = r.z;
    out[o + 6] = r.w;
  }

  linvel(h: BodyHandle): Vec3 {
    const v = this.bodies.get(h)?.linvel();
    return v ? [v.x, v.y, v.z] : [0, 0, 0];
  }

  angvel(h: BodyHandle): Vec3 {
    const v = this.bodies.get(h)?.angvel();
    return v ? [v.x, v.y, v.z] : [0, 0, 0];
  }

  setVelocity(h: BodyHandle, lin: Vec3, ang: Vec3): void {
    const b = this.bodies.get(h);
    if (!b) return;
    b.setLinvel({ x: lin[0], y: lin[1], z: lin[2] }, true);
    b.setAngvel({ x: ang[0], y: ang[1], z: ang[2] }, true);
  }

  applyImpulse(h: BodyHandle, i: Vec3, point?: Vec3): void {
    const b = this.bodies.get(h);
    if (!b) return;
    if (point) b.applyImpulseAtPoint({ x: i[0], y: i[1], z: i[2] }, { x: point[0], y: point[1], z: point[2] }, true);
    else b.applyImpulse({ x: i[0], y: i[1], z: i[2] }, true);
  }

  applyTorqueImpulse(h: BodyHandle, t: Vec3): void {
    this.bodies.get(h)?.applyTorqueImpulse({ x: t[0], y: t[1], z: t[2] }, true);
  }

  addForce(h: BodyHandle, f: Vec3): void {
    this.bodies.get(h)?.addForce({ x: f[0], y: f[1], z: f[2] }, true);
  }

  mass(h: BodyHandle): number {
    return this.bodies.get(h)?.mass() ?? 0;
  }

  centerOfMass(h: BodyHandle): Vec3 {
    const c = this.bodies.get(h)?.worldCom();
    return c ? [c.x, c.y, c.z] : [0, 0, 0];
  }

  isSleeping(h: BodyHandle): boolean {
    return this.bodies.get(h)?.isSleeping() ?? false;
  }

  sleep(h: BodyHandle): void {
    this.bodies.get(h)?.sleep();
  }

  wake(h: BodyHandle): void {
    this.bodies.get(h)?.wakeUp();
  }

  setKinematicTarget(h: BodyHandle, p: Vec3, q: Quat): void {
    const b = this.bodies.get(h);
    if (!b) return;
    b.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] });
    b.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  }

  setPose(h: BodyHandle, p: Vec3, q: Quat, resetVelocity = true): void {
    const b = this.bodies.get(h);
    if (!b) return;
    b.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    b.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    if (resetVelocity && b.isDynamic()) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  setGravityScale(h: BodyHandle, scale: number): void {
    this.bodies.get(h)?.setGravityScale(scale, true);
  }

  setLinvel(h: BodyHandle, v: Vec3): void {
    this.bodies.get(h)?.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
  }

  setAngvel(h: BodyHandle, w: Vec3): void {
    this.bodies.get(h)?.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
  }

  setEnabledRotations(h: BodyHandle, x: boolean, y: boolean, z: boolean): void {
    this.bodies.get(h)?.setEnabledRotations(x, y, z, true);
  }

  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeBody?: BodyHandle): RayHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
    const ray = new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] }, d);
    const exclude = excludeBody !== undefined ? this.bodies.get(excludeBody) : undefined;
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: [origin[0] + d.x * t, origin[1] + d.y * t, origin[2] + d.z * t],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      distance: t,
      body: hit.collider.parent()?.handle ?? null,
    };
  }

  dynamicBodiesInSphere(center: Vec3, radius: number): BodyHandle[] {
    const found = new Set<number>();
    this.world.intersectionsWithShape(
      { x: center[0], y: center[1], z: center[2] },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(radius),
      (c) => {
        const p = c.parent();
        if (p && p.isDynamic()) found.add(p.handle);
        return true;
      },
    );
    return [...found];
  }

  createCharacter(p: Vec3, o: CharacterOptions): CharacterHandle {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]));
    this.bodies.set(body.handle, body);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(o.halfHeight, o.radius).setFriction(0), body);
    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(o.stepHeight, 0.05, true);
    controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle((o.maxSlopeDeg * Math.PI) / 180);
    controller.setMinSlopeSlideAngle(((o.maxSlopeDeg + 5) * Math.PI) / 180);
    controller.setSlideEnabled(true);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(80);
    const h = this.nextCharacter++;
    this.characters.set(h, { body, collider, controller });
    return h;
  }

  moveCharacter(ch: CharacterHandle, d: Vec3): { position: Vec3; grounded: boolean } {
    const c = this.characters.get(ch);
    if (!c) throw new Error(`unknown character ${ch}`);
    c.controller.computeColliderMovement(c.collider, { x: d[0], y: d[1], z: d[2] }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = c.controller.computedMovement();
    const t = c.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    c.body.setNextKinematicTranslation(next);
    return { position: [next.x, next.y, next.z], grounded: c.controller.computedGrounded() };
  }

  characterBody(ch: CharacterHandle): BodyHandle {
    const c = this.characters.get(ch);
    if (!c) throw new Error(`unknown character ${ch}`);
    return c.body.handle;
  }

  teleportCharacter(ch: CharacterHandle, p: Vec3): void {
    this.characters.get(ch)?.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
  }

  setCharacterEnabled(ch: CharacterHandle, enabled: boolean): void {
    this.characters.get(ch)?.collider.setEnabled(enabled);
  }

  createVehicle(chassis: BodyHandle, wheels: readonly WheelDesc[]): VehicleHandle {
    const body = this.bodies.get(chassis);
    if (!body) throw new Error(`createVehicle: unknown chassis ${chassis}`);
    const controller = this.world.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    wheels.forEach((w, i) => {
      controller.addWheel({ x: w.position[0], y: w.position[1], z: w.position[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, w.suspensionRest, w.radius);
      controller.setWheelSuspensionStiffness(i, w.stiffness);
      controller.setWheelSuspensionCompression(i, w.compression);
      controller.setWheelSuspensionRelaxation(i, w.relaxation);
      controller.setWheelMaxSuspensionTravel(i, w.maxTravel);
      controller.setWheelMaxSuspensionForce(i, w.maxForce);
      controller.setWheelFrictionSlip(i, w.frictionSlip);
      controller.setWheelSideFrictionStiffness(i, w.sideFriction);
    });
    const h = this.nextVehicle++;
    this.vehicles.set(h, { controller, wheels: wheels.length });
    return h;
  }

  updateVehicle(v: VehicleHandle, dt: number, controls: readonly WheelControl[]): void {
    const veh = this.vehicles.get(v);
    if (!veh) return;
    const c = veh.controller;
    for (let i = 0; i < veh.wheels; i++) {
      const w = controls[i];
      c.setWheelEngineForce(i, -(w?.engine ?? 0)); // Rapier drives toward +z; our forward is -z
      c.setWheelBrake(i, w?.brake ?? 0);
      c.setWheelSteering(i, w?.steer ?? 0);
    }
    c.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  }

  wheelContacts(v: VehicleHandle): boolean[] {
    const veh = this.vehicles.get(v);
    if (!veh) return [];
    return Array.from({ length: veh.wheels }, (_, i) => veh.controller.wheelIsInContact(i));
  }

  setWheelGrip(v: VehicleHandle, wheel: number, frictionSlip: number, sideFriction: number): void {
    const veh = this.vehicles.get(v);
    if (!veh) return;
    veh.controller.setWheelFrictionSlip(wheel, frictionSlip);
    veh.controller.setWheelSideFrictionStiffness(wheel, sideFriction);
  }

  removeVehicle(v: VehicleHandle): void {
    const veh = this.vehicles.get(v);
    if (!veh) return;
    this.vehicles.delete(v);
    this.world.removeVehicleController(veh.controller);
  }

  colliderCount(): number {
    return this.world.colliders.len();
  }
}
