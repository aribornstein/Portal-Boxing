import { describe, expect, it } from "vitest";

import {
  reactionForImpact,
  type CombatImpact,
} from "../../src/combat/combatImpact.js";

describe("combat impact reactions", () => {
  it("produces distinct reactions for punches, kicks, and held objects", () => {
    const base: Omit<CombatImpact, "source" | "region"> = {
      direction: [1, 0, 1],
      speed: 3,
      confidence: 0.9,
      timestamp: 1,
    };
    const punch = reactionForImpact({
      ...base,
      source: "punch",
      region: "head",
    });
    const kick = reactionForImpact({
      ...base,
      source: "kick",
      region: "limb",
    });
    const object = reactionForImpact({
      ...base,
      source: "held-object",
      region: "head",
    });

    expect(kick.displacementMeters).toBeGreaterThan(punch.displacementMeters);
    expect(object.yawRadians).toBeGreaterThan(punch.yawRadians);
    expect(
      new Set([
        punch.durationSeconds,
        kick.durationSeconds,
        object.durationSeconds,
      ]).size,
    ).toBe(3);
  });

  it("mirrors lateral reactions with impact direction", () => {
    const left = reactionForImpact({
      source: "kick",
      region: "limb",
      direction: [-1, 0, 1],
      speed: 2,
      confidence: 1,
      timestamp: 1,
    });
    const right = reactionForImpact({
      source: "kick",
      region: "limb",
      direction: [1, 0, 1],
      speed: 2,
      confidence: 1,
      timestamp: 1,
    });

    expect(left.rollRadians).toBe(-right.rollRadians);
    expect(left.yawRadians).toBe(-right.yawRadians);
  });
});
