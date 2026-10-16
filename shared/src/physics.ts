import RAPIER from '@dimforge/rapier2d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import { tileToLocal, type HatchDef, type ShipLayout } from './layout/parseLayout';
import type { ObjectKind } from './state';

let ready: Promise<void> | null = null;

/** Rapier ships as WASM and must be initialised once before any world is created. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export { RAPIER };
export type { Collider, RigidBody, World };

/** Collision group bits. */
export const GROUP = {
  WORLD: 1 << 0,
  PLATFORM: 1 << 1,
  PLAYER: 1 << 2,
  OBJECT: 1 << 3,
  HATCH: 1 << 4,
} as const;

/** Packs Rapier interaction groups: 16 bit membership + 16 bit filter. */
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const PLAYER_FILTER_BASE = GROUP.WORLD | GROUP.OBJECT | GROUP.HATCH;

export const OBJECT_SPECS: Record<
  ObjectKind,
  { hx: number; hy: number; mass: number; friction: number; buoyancy: number; restitution: number }
> = {
  // Half extents match the placeholder sprites (12x12, 10x12, 20x3 px at 16 px/m).
  crate: { hx: 0.375, hy: 0.375, mass: 20, friction: 0.12, buoyancy: 1.6, restitution: 0.05 },
  barrel: { hx: 0.3125, hy: 0.375, mass: 30, friction: 0.08, buoyancy: 1.4, restitution: 0.1 },
  plank: { hx: 0.625, hy: 0.09375, mass: 6, friction: 0.25, buoyancy: 2.2, restitution: 0.05 },
  bucket: { hx: 0.21875, hy: 0.25, mass: 4, friction: 0.3, buoyancy: 1.8, restitution: 0.05 },
  oilcan: { hx: 0.1875, hy: 0.25, mass: 5, friction: 0.3, buoyancy: 1.5, restitution: 0.05 },
  ball: { hx: 0.15625, hy: 0.15625, mass: 12, friction: 0.5, buoyancy: 0, restitution: 0.15 },
};

/** Creates the fixed hull colliders from the layout. Returns the hatch colliders by hatch id. */
export function buildStaticColliders(world: World, layout: ShipLayout): { body: RigidBody; hatchColliders: Collider[] } {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ts = layout.tileSize;
  for (const r of layout.solidRects) {
    const c = tileToLocal(layout, r.x + r.w / 2, r.y + r.h / 2);
    const desc = RAPIER.ColliderDesc.cuboid((r.w * ts) / 2, (r.h * ts) / 2)
      .setTranslation(c.x, c.y)
      .setFriction(0.4)
      .setCollisionGroups(groups(GROUP.WORLD, GROUP.PLAYER | GROUP.OBJECT));
    world.createCollider(desc, body);
  }
  const hatchColliders = layout.hatches.map((h) => {
    const c = tileToLocal(layout, h.tx + h.width / 2, h.ty + 0.5);
    const desc = RAPIER.ColliderDesc.cuboid((h.width * ts) / 2, ts / 2)
      .setTranslation(c.x, c.y)
      .setFriction(0.4);
    return world.createCollider(desc, body);
  });
  return { body, hatchColliders };
}

/** Applies the open/closed state of a hatch to its collider. */
export function applyHatchState(collider: Collider, hatch: HatchDef, open: boolean): void {
  if (!open) {
    collider.setEnabled(true);
    collider.setCollisionGroups(groups(GROUP.HATCH, GROUP.PLAYER | GROUP.OBJECT));
  } else if (hatch.hasLadder) {
    // open ladder hatch = one-way platform, solid only for players standing above it
    collider.setEnabled(true);
    collider.setCollisionGroups(groups(GROUP.PLATFORM, GROUP.PLAYER | GROUP.OBJECT));
  } else {
    collider.setEnabled(false);
  }
}

export function createObjectBody(
  world: World,
  kind: ObjectKind,
  x: number,
  y: number,
  angle = 0,
): { body: RigidBody; collider: Collider } {
  const s = OBJECT_SPECS[kind];
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(angle)
      .setLinearDamping(0.05)
      .setAngularDamping(0.8)
      .setCcdEnabled(true)
      // gravity changes every step (rolling ship), so loose objects must never fall asleep
      .setCanSleep(false),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(s.hx, s.hy)
      .setMass(s.mass)
      .setFriction(s.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(s.restitution)
      .setCollisionGroups(
        groups(GROUP.OBJECT, GROUP.WORLD | GROUP.PLATFORM | GROUP.PLAYER | GROUP.OBJECT | GROUP.HATCH),
      ),
    body,
  );
  return { body, collider };
}

/** Lashed cargo is a fixed body; loose cargo is dynamic again. */
export function applyLash(body: RigidBody, lashed: boolean): void {
  const type = lashed ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic;
  if (body.bodyType() === type) return;
  body.setBodyType(type, true);
  if (lashed) {
    body.setLinvel({ x: 0, y: 0 }, false);
    body.setAngvel(0, false);
  }
}
