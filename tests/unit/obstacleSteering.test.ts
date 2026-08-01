import { describe, expect, it } from "vitest";

import {
  distanceToNearestObstacle,
  opponentSpacingDirection,
  resolveObstacleAwareStepInto,
  type PlanarStep,
} from "../../src/combat/obstacleSteering.js";
import type { Bounds3, SafeZone } from "../../src/room/roomUnderstanding.js";

const safeZone: SafeZone = {
  center: [0, 0, 0],
  halfExtents: [2, 1.2, 2],
  kickEnabled: true,
  reasons: [],
};
const obstacle: Bounds3 = {
  min: [0.3, 0, -0.2],
  max: [0.8, 1, 0.2],
};

describe("obstacle-aware steering", () => {
  it("holds its ground in punching range and approaches from outside it", () => {
    expect(opponentSpacingDirection(0.6, 1)).toBe(0);
    expect(opponentSpacingDirection(0.9, 1)).toBe(0);
    expect(opponentSpacingDirection(1.2, 1)).toBe(1);
  });

  it("keeps a clear direct step", () => {
    const output: PlanarStep = { x: 0, z: 0 };
    expect(
      resolveObstacleAwareStepInto(
        0,
        0,
        -1,
        0,
        0.4,
        0.1,
        [obstacle],
        safeZone,
        output,
      ),
    ).toBe(true);
    expect(output).toEqual({ x: -0.4, z: 0 });
  });

  it("takes a deterministic side step when the direct path is blocked", () => {
    const output: PlanarStep = { x: 0, z: 0 };
    expect(
      resolveObstacleAwareStepInto(
        0,
        0,
        1,
        0,
        0.4,
        0.1,
        [obstacle],
        safeZone,
        output,
      ),
    ).toBe(true);
    expect(output).toEqual({ x: 0, z: 0.4 });
  });

  it("uses the opposite side when the first side exits the safe zone", () => {
    const output: PlanarStep = { x: 0, z: 0 };
    const narrowZone: SafeZone = {
      ...safeZone,
      center: [0, 0, 0],
      halfExtents: [2, 1.2, 0.4],
    };
    expect(
      resolveObstacleAwareStepInto(
        0,
        0.1,
        1,
        0,
        0.39,
        0.1,
        [obstacle],
        narrowZone,
        output,
      ),
    ).toBe(true);
    expect(output.x).toBe(0);
    expect(output.z).toBeCloseTo(-0.29);
  });

  it("stays put when every candidate is unsafe", () => {
    const output: PlanarStep = { x: 7, z: 9 };
    expect(
      resolveObstacleAwareStepInto(
        0,
        0,
        1,
        0,
        0.4,
        0.1,
        [obstacle],
        { ...safeZone, halfExtents: [0.2, 1.2, 0.2] },
        output,
      ),
    ).toBe(false);
    expect(output).toEqual({ x: 7, z: 9 });
  });

  it("allows an outside spawn to move toward the inset safe zone", () => {
    const output: PlanarStep = { x: 0, z: 0 };
    expect(
      resolveObstacleAwareStepInto(
        2.2,
        0,
        -1,
        0,
        0.1,
        0.32,
        [],
        safeZone,
        output,
      ),
    ).toBe(true);
    expect(output).toEqual({ x: 2.1, z: 0 });
    expect(
      resolveObstacleAwareStepInto(
        2.2,
        0,
        1,
        0,
        0.1,
        0.32,
        [],
        safeZone,
        output,
      ),
    ).toBe(false);
  });

  it("allows an overlapping spawn to move out of furniture", () => {
    const output: PlanarStep = { x: 0, z: 0 };
    expect(
      resolveObstacleAwareStepInto(
        0.5,
        0,
        -1,
        0,
        0.1,
        0.1,
        [obstacle],
        safeZone,
        output,
      ),
    ).toBe(true);
    expect(output).toEqual({ x: 0.4, z: 0 });
    expect(
      resolveObstacleAwareStepInto(
        0.5,
        0,
        1,
        0,
        0.1,
        0.1,
        [obstacle],
        safeZone,
        output,
      ),
    ).toBe(true);
    expect(output).toEqual({ x: 0.5, z: 0.1 });
  });

  it("reports planar clearance to the nearest obstacle", () => {
    expect(distanceToNearestObstacle(-0.2, 0, [obstacle])).toBeCloseTo(0.5);
    expect(distanceToNearestObstacle(0.4, 0, [obstacle])).toBe(0);
    expect(distanceToNearestObstacle(0, 0, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
