import { describe, expect, it } from "vitest";

import { isDepthSegmentClear } from "../../src/xr/depthClearance.js";

const start = new Float32Array([0, 1, 0]);
const end = new Float32Array([1, 1, 0]);

describe("depth strike clearance", () => {
  it("blocks a depth point inside the forward strike corridor", () => {
    const points = new Float32Array([0.5, 1.05, 0.02]);
    expect(isDepthSegmentClear(points, 1, start, end, 0.1, 0.08)).toBe(false);
  });

  it("ignores points outside the corridor and beyond the contact point", () => {
    const points = new Float32Array([0.5, 1.25, 0, 1.2, 1, 0, 0.7, 1, 0.2]);
    expect(isDepthSegmentClear(points, 3, start, end, 0.1, 0.08)).toBe(true);
  });

  it("excludes depth immediately surrounding the tracked hand", () => {
    const points = new Float32Array([0.04, 1, 0]);
    expect(isDepthSegmentClear(points, 1, start, end, 0.1, 0.08)).toBe(true);
  });
});
