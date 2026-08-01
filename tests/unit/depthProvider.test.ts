import { describe, expect, it } from "vitest";

import {
  NullDepthProvider,
  PhysicalWebXRDepthProvider,
  RecordedDepthProvider,
  SyntheticDepthProvider,
  type PhysicalDepthSource,
} from "../../src/xr/depthProvider.js";

function storedFrame(capturedAt = 10) {
  return {
    positions: new Float32Array([0, 0.5, -1, 0.2, 0.6, -1.1]),
    sampleCount: 2,
    capturedAt,
    floorY: 0,
  };
}

describe("depth providers", () => {
  it("reuses a bounded synthetic output buffer and caps cadence", () => {
    const provider = new SyntheticDepthProvider(storedFrame(), {
      quality: "low",
      samplesPerSecond: 10,
    });

    const first = provider.sample(100);
    expect(first?.sampleCount).toBe(2);
    expect(provider.sample(150)).toBeNull();
    const second = provider.sample(200);
    expect(second?.positions).toBe(first?.positions);
  });

  it("plays recorded frames deterministically and resets", () => {
    const provider = new RecordedDepthProvider(
      [storedFrame(1), { ...storedFrame(2), sampleCount: 1 }],
      { samplesPerSecond: 1000 },
    );
    expect(provider.sample(1)?.sampleCount).toBe(2);
    expect(provider.sample(2)?.sampleCount).toBe(1);
    provider.reset();
    expect(provider.sample(3)?.sampleCount).toBe(2);
  });

  it("reports an explicit null-provider reason", () => {
    const provider = new NullDepthProvider();
    expect(provider.availability.available).toBe(false);
    expect(provider.availability.reason).toContain("not supported");
    expect(provider.sample(0)).toBeNull();
  });

  it("rejects invalid and floor-adjacent physical samples", () => {
    const values = [0, 0.5, 8, 1];
    const depth = {
      width: 2,
      height: 2,
      normDepthBufferFromNormView: { matrix: new Float32Array(16) },
      getDepthInMeters: (normalizedX: number, normalizedY: number) => {
        if (
          normalizedX < 0 ||
          normalizedX > 1 ||
          normalizedY < 0 ||
          normalizedY > 1
        ) {
          throw new RangeError("Depth coordinates must be normalized");
        }
        const column = Math.round(normalizedX);
        const row = Math.round(normalizedY);
        return values[row * 2 + column];
      },
    } as unknown as XRCPUDepthInformation;
    const source: PhysicalDepthSource = {
      cpuDepth: depth,
      gpuDepthAvailable: false,
      capturedAt: 10,
      floorY: 0,
      unproject(normalizedX, normalizedY, depthMeters, output, offset) {
        output[offset] = normalizedX;
        output[offset + 1] = normalizedY < 0.5 ? 0.01 : 0.5;
        output[offset + 2] = -depthMeters;
      },
    };
    const provider = new PhysicalWebXRDepthProvider(() => source, {
      quality: "low",
      samplesPerSecond: 1000,
      maximumDepthMeters: 5,
    });

    const frame = provider.sample(20);
    expect(frame?.sampleCount).toBeGreaterThan(0);
    for (let index = 0; index < (frame?.sampleCount ?? 0); index += 1) {
      expect(frame?.positions[index * 3 + 1]).toBeGreaterThan(0.06);
      expect(frame?.positions[index * 3 + 2]).toBeGreaterThanOrEqual(-5);
    }
  });

  it("reduces adaptive quality under frame pressure", () => {
    const provider = new SyntheticDepthProvider(storedFrame(), {
      quality: "high",
    });
    provider.updateFrameTime(20);
    expect(provider.quality).toBe("balanced");
    provider.updateFrameTime(20);
    expect(provider.quality).toBe("low");
  });
});
