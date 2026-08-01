import { describe, expect, it } from "vitest";

import { unprojectDepthPointInto } from "../../src/xr/depthUnprojection.js";

const identity = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

describe("depth unprojection", () => {
  it("treats depth as sensor-plane distance rather than ray length", () => {
    const output = new Float32Array(3);

    expect(
      unprojectDepthPointInto(0.75, 0.25, 2, identity, identity, output, 0),
    ).toBe(true);
    expect([...output]).toEqual([1, 1, -2]);
  });

  it("applies the sensor reference-space transform after unprojection", () => {
    const referenceFromSensor = new Float32Array(identity);
    referenceFromSensor[12] = 3;
    referenceFromSensor[13] = 1;
    referenceFromSensor[14] = -4;
    const output = new Float32Array(3);

    unprojectDepthPointInto(
      0.5,
      0.5,
      2,
      identity,
      referenceFromSensor,
      output,
      0,
    );
    expect([...output]).toEqual([3, 1, -6]);
  });

  it("rejects invalid depth and degenerate projections", () => {
    const output = new Float32Array([7, 8, 9]);
    const degenerate = new Float32Array(16);

    expect(
      unprojectDepthPointInto(0.5, 0.5, 0, identity, identity, output, 0),
    ).toBe(false);
    expect(
      unprojectDepthPointInto(0.5, 0.5, 1, degenerate, identity, output, 0),
    ).toBe(false);
  });
});
