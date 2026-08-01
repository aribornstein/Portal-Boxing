import { describe, expect, it } from "vitest";

import {
  classifyPhysicalDepthContact,
  PhysicalContactTracker,
  reactionForImpact,
  type CombatImpact,
} from "../../src/combat/combatImpact.js";

describe("physical combat impacts", () => {
  it("keeps fast anonymous motion unclassified", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: false,
        localizedMotionDetected: true,
        nearestHandDistance: Number.POSITIVE_INFINITY,
        associatedHandSpeed: 0,
        handMotionAlignment: 0,
        approachSpeed: 2.4,
        contactCoverage: 0.08,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact", speed: 2.4 });
  });

  it("accepts sparse contact coverage from the Quest depth mask", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: false,
        localizedMotionDetected: true,
        nearestHandDistance: Number.POSITIVE_INFINITY,
        associatedHandSpeed: 0,
        handMotionAlignment: 0,
        approachSpeed: 2.2,
        contactCoverage: 0.001,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
  });

  it("classifies a hand-associated extension as a held object", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: true,
        localizedMotionDetected: false,
        nearestHandDistance: 0.72,
        associatedHandSpeed: 1.4,
        handMotionAlignment: 0.85,
        approachSpeed: 2.1,
        contactCoverage: 0.06,
      }),
    ).toMatchObject({ kind: "held-object", speed: 2.1 });
  });

  it("uses tracked hand motion when static room depth masks object approach", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: true,
        localizedMotionDetected: false,
        nearestHandDistance: 1.16,
        associatedHandSpeed: 0.57,
        handMotionAlignment: 0.78,
        approachSpeed: 0.04,
        contactCoverage: 0.0056,
      }),
    ).toMatchObject({ kind: "held-object", speed: 0.57 });
  });

  it("rejects direct-hand overlap and static depth", () => {
    expect(
      classifyPhysicalDepthContact({
        nearestHandDistance: 0.2,
        associatedHandSpeed: 1.5,
        handMotionAlignment: 1,
        approachSpeed: 2,
        contactCoverage: 0.1,
      }),
    ).toBeUndefined();
    expect(
      classifyPhysicalDepthContact({
        nearestHandDistance: Number.POSITIVE_INFINITY,
        associatedHandSpeed: 0,
        handMotionAlignment: 0,
        approachSpeed: 0.2,
        contactCoverage: 0.1,
      }),
    ).toBeUndefined();
  });

  it("leaves tracked fist contacts to the punch system", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: false,
        localizedMotionDetected: true,
        nearestHandDistance: 0.324,
        associatedHandSpeed: 3.5,
        handMotionAlignment: 0.8,
        approachSpeed: 3.2,
        contactCoverage: 0.01,
      }),
    ).toBeUndefined();
  });

  it("rejects aligned hand motion without an explicitly held object", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: false,
        localizedMotionDetected: false,
        nearestHandDistance: 0.72,
        associatedHandSpeed: 2,
        handMotionAlignment: 0.9,
        approachSpeed: 2,
        contactCoverage: 0.05,
      }),
    ).toBeUndefined();
  });

  it("produces distinct localized reactions", () => {
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

  it("requires temporal approach, separation, and cooldown", () => {
    const tracker = new PhysicalContactTracker();
    const near = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      contactCoverage: 0.03,
    };
    expect(
      tracker.update({ ...near, separationMeters: 0.24, timestamp: 1 }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...near,
        separationMeters: 0.06,
        localizedApproachSpeed: 1.8,
        timestamp: 1.1,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
    expect(
      tracker.update({ ...near, separationMeters: 0.04, timestamp: 1.15 }),
    ).toBeUndefined();
    expect(
      tracker.update({ ...near, separationMeters: 0.2, timestamp: 1.3 }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...near,
        separationMeters: 0.05,
        localizedApproachSpeed: 1.5,
        timestamp: 1.35,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({ ...near, separationMeters: 0.2, timestamp: 1.5 }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...near,
        separationMeters: 0.05,
        localizedApproachSpeed: 1.5,
        timestamp: 1.6,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
  });

  it("rejects anonymous depth that appears already touching", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
    };

    expect(
      tracker.update({
        ...contact,
        separationMeters: Number.POSITIVE_INFINITY,
        contactCoverage: 0,
        timestamp: 1,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.06,
        contactCoverage: 0.03,
        timestamp: 1.08,
      }),
    ).toBeUndefined();
  });

  it("detects localized motion over a static room-depth contact", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      separationMeters: 0.04,
      contactCoverage: 0.01,
    };

    expect(
      tracker.update({
        ...contact,
        localizedApproachSpeed: 0,
        timestamp: 1,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        localizedApproachSpeed: 2.2,
        timestamp: 1.1,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact", speed: 2.2 });
  });

  it("rearms after localized retraction over persistent room depth", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      separationMeters: 0.04,
      contactCoverage: 0.01,
    };

    expect(
      tracker.update({
        ...contact,
        localizedApproachSpeed: 2.2,
        localizedRetreatSpeed: 0,
        timestamp: 1,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
    expect(
      tracker.update({
        ...contact,
        localizedApproachSpeed: 0,
        localizedRetreatSpeed: 2,
        timestamp: 1.2,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        localizedApproachSpeed: 2.1,
        localizedRetreatSpeed: 0,
        timestamp: 1.5,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact", speed: 2.1 });
  });

  it("subtracts robot motion into static room depth", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      contactCoverage: 0.01,
    };

    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.24,
        localizedApproachSpeed: 0,
        targetMotionSpeed: 0,
        timestamp: 1,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.05,
        localizedApproachSpeed: 1.9,
        targetMotionSpeed: 1.9,
        timestamp: 1.1,
      }),
    ).toBeUndefined();
  });

  it("projects imminent depth contact through a short observation gap", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "limb" as const,
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      contactCoverage: 0.001,
    };

    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.24,
        localizedApproachSpeed: 0,
        timestamp: 1,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.16,
        localizedApproachSpeed: 2,
        timestamp: 1.08,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact", speed: 2 });
  });

  it("coalesces adjacent body-region samples into one contact", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      nearestHandDistance: Number.POSITIVE_INFINITY,
      associatedHandSpeed: 0,
      handMotionAlignment: 0,
      contactCoverage: 0.01,
    };

    tracker.update({
      ...contact,
      region: "limb",
      separationMeters: 0.24,
      timestamp: 1,
    });
    tracker.update({
      ...contact,
      region: "abdomen",
      separationMeters: 0.24,
      timestamp: 1,
    });
    expect(
      tracker.update({
        ...contact,
        region: "limb",
        separationMeters: 0.06,
        localizedApproachSpeed: 2.4,
        timestamp: 1.1,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
    expect(
      tracker.update({
        ...contact,
        region: "abdomen",
        separationMeters: 0.05,
        localizedApproachSpeed: 2.7,
        timestamp: 1.18,
      }),
    ).toBeUndefined();
  });

  it("detects a held object that enters the depth signal already touching", () => {
    const tracker = new PhysicalContactTracker();
    const contact = {
      region: "head" as const,
      heldObjectActive: true,
      nearestHandDistance: 0.72,
      associatedHandSpeed: 1.4,
      handMotionAlignment: 0.85,
    };

    expect(
      tracker.update({
        ...contact,
        separationMeters: Number.POSITIVE_INFINITY,
        contactCoverage: 0,
        timestamp: 1,
      }),
    ).toBeUndefined();
    expect(
      tracker.update({
        ...contact,
        separationMeters: 0.06,
        contactCoverage: 0.03,
        timestamp: 1.08,
      }),
    ).toMatchObject({ kind: "held-object" });
  });

  it("does not mistake a nearby stationary hand for a held object", () => {
    expect(
      classifyPhysicalDepthContact({
        heldObjectActive: false,
        localizedMotionDetected: true,
        nearestHandDistance: 0.8,
        associatedHandSpeed: 0.1,
        handMotionAlignment: 0.9,
        approachSpeed: 2.2,
        contactCoverage: 0.05,
      }),
    ).toMatchObject({ kind: "unclassified-depth-contact" });
  });
});
