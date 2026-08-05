import { describe, expect, it } from "vitest";

import {
  KickRecognitionEngine,
  type KickDepthEvidence,
  type KickRecognitionFrame,
  type KickTrackedPose,
} from "../../src/combat/kickRecognition.js";

const sampleIntervalUs = 41_667;

function depth(
  separationMeters: number,
  options: {
    readonly localizedSamples?: number;
    readonly speedMps?: number;
    readonly contactSamples?: number;
    readonly approachSamples?: number;
    readonly centroid?: readonly [number, number, number];
  } = {},
): KickDepthEvidence {
  const approachSampleCount =
    options.approachSamples ?? (separationMeters <= 0.13 ? 8 : 0);
  const contactSampleCount =
    options.contactSamples ?? (separationMeters <= 0.025 ? 8 : 0);
  return {
    footprintSampleCount: 16,
    validSampleCount: 16,
    approachSampleCount,
    contactSampleCount,
    minimumSeparationMeters: separationMeters,
    validSampleFraction: 1,
    localizedApproachSampleCount: options.localizedSamples ?? 0,
    localizedApproachSpeedMps: options.speedMps ?? 0,
    localizedRetreatSampleCount: 0,
    localizedRetreatSpeedMps: 0,
    centroidTargetLocal:
      options.centroid ?? (separationMeters > 0.025 ? [0.2, 0, 0] : [0, 0, 0]),
    spatialMoment: contactSampleCount > 0 ? 0.002 : 0,
    coherentArea: contactSampleCount * 0.0004,
  };
}

function frame(
  timestampUs: number,
  evidence: KickDepthEvidence,
  options: {
    readonly targetId?: KickRecognitionFrame["targetId"];
    readonly targetMotionMps?: number;
    readonly leftHand?: KickTrackedPose;
  } = {},
): KickRecognitionFrame {
  return {
    targetId: options.targetId ?? "opponent-left-target",
    timestampUs,
    depth: evidence,
    targetMotionMps: options.targetMotionMps ?? 0,
    hands: options.leftHand ? { left: options.leftHand } : {},
  };
}

function processSequence(
  engine: KickRecognitionEngine,
  evidence: readonly KickDepthEvidence[],
) {
  return evidence.map((sample, index) =>
    engine.process(frame(index * sampleIntervalUs, sample)),
  );
}

const clear = depth(0.3);
const approach = depth(0.1, { localizedSamples: 4, speedMps: 1.2 });
const contact = depth(0.01, { localizedSamples: 4, speedMps: 1.2 });

describe("target-local kick recognition", () => {
  it("requires a clear target baseline before motion", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [approach, contact, clear],
    );

    expect(decisions.every((decision) => decision === undefined)).toBe(true);
  });

  it("accepts a coherent approach, contact, and release", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, approach, approach, contact, contact, clear],
    );

    expect(decisions.find(Boolean)).toMatchObject({
      decision: "kick",
      targetId: "opponent-left-target",
      provenance: "depth-hand-fallback",
    });
  });

  it("recognizes the authored groin target through the same pipeline", () => {
    const engine = new KickRecognitionEngine("opponent-groin-target");
    const decisions = [clear, contact, contact, clear].map((sample, index) =>
      engine.process(
        frame(index * sampleIntervalUs, sample, {
          targetId: "opponent-groin-target",
        }),
      ),
    );

    expect(decisions.find(Boolean)).toMatchObject({
      decision: "kick",
      targetId: "opponent-groin-target",
    });
  });

  it("keeps contact state and cooldown independent per target", () => {
    const left = new KickRecognitionEngine("opponent-left-target");
    const right = new KickRecognitionEngine("opponent-right-target");
    const rightFrame = (timestampUs: number, evidence: KickDepthEvidence) =>
      frame(timestampUs, evidence, {
        targetId: "opponent-right-target",
      });

    left.process(frame(0, clear));
    right.process(rightFrame(0, clear));
    left.process(frame(sampleIntervalUs, contact));
    right.process(rightFrame(sampleIntervalUs, contact));
    const leftDecision = left.process(frame(sampleIntervalUs * 2, contact));
    const rightDecision = right.process(
      rightFrame(sampleIntervalUs * 2, contact),
    );

    expect(leftDecision).toMatchObject({
      decision: "kick",
      targetId: "opponent-left-target",
    });
    expect(rightDecision).toMatchObject({
      decision: "kick",
      targetId: "opponent-right-target",
    });
  });

  it("accepts contact at the visible detector boundary", () => {
    const boundaryContact = depth(0.02, {
      localizedSamples: 4,
      speedMps: 1.2,
    });
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, boundaryContact, boundaryContact, clear],
    );

    expect(decisions.find(Boolean)).toMatchObject({ decision: "kick" });
  });

  it("does not bypass the configured approach-frame minimum", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, contact, clear],
    );

    expect(decisions.every((decision) => decision === undefined)).toBe(true);
  });

  it("retains contact geometry until the next sample supplies motion", () => {
    const candidate = depth(0.01, { localizedSamples: 0, speedMps: 0 });
    const moving = depth(0.05, { localizedSamples: 4, speedMps: 1.4 });
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, candidate, moving, clear],
    );

    expect(decisions.find(Boolean)).toMatchObject({ decision: "kick" });
  });

  it("accepts one moving Quest pixel with broad connected contact", () => {
    const sparseContact = depth(0.01, {
      localizedSamples: 1,
      speedMps: 0.76,
      contactSamples: 4,
      approachSamples: 4,
    });
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, sparseContact, sparseContact, clear],
    );

    expect(decisions.find(Boolean)).toMatchObject({ decision: "kick" });
  });

  it("rejects one moving pixel without broad contact support", () => {
    const noise = depth(0.01, {
      localizedSamples: 1,
      speedMps: 0.76,
      contactSamples: 1,
      approachSamples: 4,
    });
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, noise, clear],
    );

    expect(decisions.every((decision) => decision === undefined)).toBe(true);
  });

  it("rejects static overlap without localized approach motion", () => {
    const overlap = depth(0.01, { localizedSamples: 0, speedMps: 0 });
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, overlap, overlap, clear],
    );

    expect(decisions.every((decision) => decision === undefined)).toBe(true);
  });

  it("subtracts moving-target speed from apparent depth approach", () => {
    const engine = new KickRecognitionEngine("opponent-left-target");
    const decisions = [
      engine.process(frame(0, clear)),
      engine.process(
        frame(sampleIntervalUs, contact, { targetMotionMps: 1.1 }),
      ),
      engine.process(
        frame(sampleIntervalUs * 2, contact, { targetMotionMps: 1.1 }),
      ),
    ];

    expect(decisions.every((decision) => decision === undefined)).toBe(true);
    expect(engine.contactState).toBe("CLEAR");
  });

  it("re-arms after an aborted approach", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, approach, clear, contact, contact, clear],
    );

    expect(decisions.find(Boolean)).toMatchObject({ decision: "kick" });
  });

  it("emits only once when contact remains held", () => {
    const heldContact = Array.from({ length: 12 }, () => contact);
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, ...heldContact, clear],
    );

    expect(decisions.filter(Boolean)).toHaveLength(1);
    expect(decisions.find(Boolean)).toMatchObject({ decision: "kick" });
  });

  it("does not emit a second kick during cooldown", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [clear, contact, contact, clear, contact, contact, clear, clear],
    );

    expect(decisions.filter(Boolean)).toHaveLength(1);
  });

  it("re-arms after the punch-matched cooldown", () => {
    const decisions = processSequence(
      new KickRecognitionEngine("opponent-left-target"),
      [
        clear,
        contact,
        contact,
        clear,
        clear,
        clear,
        clear,
        clear,
        clear,
        clear,
        contact,
        contact,
        clear,
      ],
    );

    expect(
      decisions.filter((decision) => decision?.decision === "kick"),
    ).toHaveLength(2);
  });

  it("rejects a tracked hand swept through the target", () => {
    const engine = new KickRecognitionEngine("opponent-left-target");
    const startHand: KickTrackedPose = {
      position: [0.5, 0, 0],
      timestampUs: 0,
      trackingQuality: 1,
    };
    const middleHand: KickTrackedPose = {
      position: [0.5, 0, 0],
      timestampUs: sampleIntervalUs,
      trackingQuality: 1,
    };
    const endHand: KickTrackedPose = {
      position: [-0.3, 0, 0],
      timestampUs: sampleIntervalUs * 2,
      trackingQuality: 1,
    };
    engine.process(frame(0, clear, { leftHand: startHand }));
    engine.process(frame(sampleIntervalUs, contact, { leftHand: middleHand }));
    const decision = engine.process(
      frame(sampleIntervalUs * 2, contact, { leftHand: endHand }),
    );

    expect(decision).toMatchObject({
      decision: "reject",
      rejectReason: "hand-explains-contact",
    });
  });
});
