import { describe, expect, it } from "vitest";

import { targetSurfaceMotionMps } from "../../src/combat/kickTargetMotion.js";

describe("kick target surface motion", () => {
  it("includes translation and rotational surface travel", () => {
    expect(targetSurfaceMotionMps(0.02, 0.4, 0.15, 0.1)).toBeCloseTo(0.8);
  });

  it("ignores invalid negative motion inputs", () => {
    expect(targetSurfaceMotionMps(-1, -1, -1, 0.1)).toBe(0);
    expect(targetSurfaceMotionMps(1, 1, 1, 0)).toBe(0);
  });
});
