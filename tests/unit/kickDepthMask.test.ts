import { describe, expect, it } from "vitest";

import {
  kickContactVolume,
  KickDepthMaskReducer,
  kickMaskFootprintState,
  kickMaskNearbyDepthState,
  kickMaskValidDepthState,
} from "../../src/combat/kickDepthMask.js";

const maskSize = 4;

function reducer() {
  return new KickDepthMaskReducer({
    maskSize,
    targetDiameterMeters: 0.3,
    targetDepthMeters: 0.06,
    minimumSeparationMeters: -0.04,
    maximumSeparationMeters: 0.32,
    approachThresholdMeters: 0.13,
    contactThresholdMeters: 0.025,
    minimumLocalizedSpeedMps: 0.35,
  });
}

function encodeSeparation(separationMeters: number) {
  return Math.round(((separationMeters + 0.04) / 0.36) * 255);
}

function pixelMask(
  entries: readonly {
    readonly index: number;
    readonly state: number;
    readonly separationMeters?: number;
    readonly localXCode?: number;
    readonly localYCode?: number;
  }[],
) {
  const pixels = new Uint8Array(maskSize * maskSize * 4);
  for (const entry of entries) {
    const offset = entry.index * 4;
    pixels[offset] = entry.state;
    pixels[offset + 1] = encodeSeparation(entry.separationMeters ?? 0.32);
    pixels[offset + 2] =
      entry.localXCode ?? ((entry.index % maskSize) + 0.5) * (256 / maskSize);
    pixels[offset + 3] =
      entry.localYCode ??
      (Math.floor(entry.index / maskSize) + 0.5) * (256 / maskSize);
  }
  return pixels;
}

describe("kick target depth-mask reduction", () => {
  it("derives the visible contact volume from mask depth thresholds", () => {
    const volume = kickContactVolume({
      maskSize,
      targetDiameterMeters: 0.3,
      targetDepthMeters: 0.06,
      minimumSeparationMeters: -0.12,
      maximumSeparationMeters: 0.32,
      approachThresholdMeters: 0.13,
      contactThresholdMeters: 0.025,
      minimumLocalizedSpeedMps: 0.35,
    });

    expect(volume.diameterMeters).toBe(0.3);
    expect(volume.depthMeters).toBeCloseTo(0.145);
    expect(volume.centerOffsetMeters).toBeCloseTo(-0.0175);
  });

  it("distinguishes a clear valid baseline from nearby depth", () => {
    const evidence = reducer().reduce(
      pixelMask([
        { index: 0, state: kickMaskValidDepthState },
        { index: 1, state: kickMaskValidDepthState },
        { index: 4, state: kickMaskValidDepthState },
        { index: 5, state: kickMaskValidDepthState },
      ]),
      100_000,
    );

    expect(evidence).toMatchObject({
      footprintSampleCount: 4,
      validSampleCount: 4,
      validSampleFraction: 1,
      approachSampleCount: 0,
      contactSampleCount: 0,
    });
  });

  it("uses the largest connected contact cluster", () => {
    const evidence = reducer().reduce(
      pixelMask([
        { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.01 },
        { index: 1, state: kickMaskNearbyDepthState, separationMeters: 0.01 },
        { index: 4, state: kickMaskNearbyDepthState, separationMeters: 0.01 },
        { index: 15, state: kickMaskNearbyDepthState, separationMeters: 0.01 },
      ]),
      100_000,
    );

    expect(evidence.contactSampleCount).toBe(3);
    expect(evidence.approachSampleCount).toBe(3);
    expect(evidence.coherentArea).toBeGreaterThan(0);
  });

  it("reports one moving pixel separately from broad contact support", () => {
    const reduce = reducer();
    reduce.reduce(
      pixelMask([
        { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.12 },
        { index: 1, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
        { index: 4, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
        { index: 5, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
      ]),
      100_000,
    );
    const evidence = reduce.reduce(
      pixelMask([
        { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
        { index: 1, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
        { index: 4, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
        { index: 5, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
      ]),
      150_000,
    );

    expect(evidence).toMatchObject({
      contactSampleCount: 4,
      localizedApproachSampleCount: 1,
    });
    expect(evidence.localizedApproachSpeedMps).toBeCloseTo(2, 1);
  });

  it("measures localized approach only across persistent nearby pixels", () => {
    const reduce = reducer();
    const far = pixelMask([
      { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.12 },
      { index: 1, state: kickMaskNearbyDepthState, separationMeters: 0.12 },
    ]);
    reduce.reduce(far, 100_000);
    const near = pixelMask([
      { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
      { index: 1, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
    ]);
    const evidence = reduce.reduce(near, 150_000);

    expect(evidence.localizedApproachSampleCount).toBe(2);
    expect(evidence.localizedApproachSpeedMps).toBeCloseTo(2, 1);
  });

  it("does not correlate surrounding depth that moves across screen pixels", () => {
    const reduce = reducer();
    reduce.reduce(
      pixelMask([
        {
          index: 0,
          state: kickMaskNearbyDepthState,
          separationMeters: 0.12,
          localXCode: 48,
          localYCode: 80,
        },
      ]),
      100_000,
    );
    const evidence = reduce.reduce(
      pixelMask([
        {
          index: 10,
          state: kickMaskNearbyDepthState,
          separationMeters: 0.02,
          localXCode: 48,
          localYCode: 80,
        },
      ]),
      150_000,
    );

    expect(evidence.localizedApproachSampleCount).toBe(0);
    expect(evidence.localizedApproachSpeedMps).toBe(0);
  });

  it("does not reuse nearby depth after a sample leaves the mask", () => {
    const reduce = reducer();
    reduce.reduce(
      pixelMask([
        { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.12 },
      ]),
      100_000,
    );
    reduce.reduce(new Uint8Array(maskSize * maskSize * 4), 150_000);
    const evidence = reduce.reduce(
      pixelMask([
        { index: 0, state: kickMaskNearbyDepthState, separationMeters: 0.02 },
      ]),
      200_000,
    );

    expect(evidence.localizedApproachSampleCount).toBe(0);
    expect(evidence.localizedApproachSpeedMps).toBe(0);
  });

  it("does not count invalid footprint pixels as valid", () => {
    const evidence = reducer().reduce(
      pixelMask([
        { index: 0, state: kickMaskFootprintState },
        { index: 1, state: kickMaskValidDepthState },
      ]),
      100_000,
    );

    expect(evidence.footprintSampleCount).toBe(2);
    expect(evidence.validSampleCount).toBe(1);
    expect(evidence.validSampleFraction).toBe(0.5);
  });
});
