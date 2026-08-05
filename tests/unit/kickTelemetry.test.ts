import { describe, expect, it } from "vitest";

import {
  KickTelemetry,
  kickTelemetrySnapshot,
  type KickTelemetrySnapshot,
} from "../../src/combat/kickTelemetry.js";

function snapshot(
  timestampUs: number,
  state: KickTelemetrySnapshot["state"] = "CLEAR",
): KickTelemetrySnapshot {
  return {
    timestampUs,
    targetId: "opponent-left-target",
    state,
    usable: true,
    validSampleFraction: 1,
    approachSampleCount: 0,
    contactSampleCount: 0,
    localizedApproachSampleCount: 0,
    localizedApproachSpeedMps: 0,
    targetMotionMps: 0,
    compensatedApproachSpeedMps: 0,
    minimumSeparationMeters: 0.3,
  };
}

describe("kick telemetry", () => {
  it("reports target motion and compensated approach speed", () => {
    const result = kickTelemetrySnapshot(
      "opponent-left-target",
      100_000,
      {
        validSampleFraction: 1,
        footprintSampleCount: 8,
        validSampleCount: 8,
        approachSampleCount: 8,
        contactSampleCount: 8,
        minimumSeparationMeters: 0.01,
        centroid: [0, 0, 0],
        localizedApproachSampleCount: 4,
        localizedApproachSpeedMps: 1.2,
        localizedRetreatSampleCount: 0,
        localizedRetreatSpeedMps: 0,
        coherentArea: 8,
      },
      1.1,
      "CONTACT",
    );

    expect(result.targetMotionMps).toBe(1.1);
    expect(result.compensatedApproachSpeedMps).toBeCloseTo(0.1);
  });

  it("emits transitions immediately and stable state at most every 250 ms", () => {
    const telemetry = new KickTelemetry();
    expect(telemetry.capture(snapshot(0))?.reason).toBe("transition");
    expect(telemetry.capture(snapshot(100_000))).toBeUndefined();
    expect(telemetry.capture(snapshot(250_000))?.reason).toBe("interval");
    expect(telemetry.capture(snapshot(260_000, "APPROACHING"))?.reason).toBe(
      "transition",
    );
  });

  it("bounds retained diagnostics", () => {
    const telemetry = new KickTelemetry();
    for (let index = 0; index < 100; index += 1) {
      telemetry.capture(snapshot(index * 250_000));
    }
    expect(telemetry.history()).toHaveLength(64);
    expect(telemetry.history()[0]?.snapshot.timestampUs).toBe(9_000_000);
  });
});
