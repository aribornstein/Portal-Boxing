import { describe, expect, it } from "vitest";

import { InferenceScheduler } from "../../src/inference/inferenceScheduler.js";
import {
  preprocessRgbaToNchw,
  validateEmbedding,
} from "../../src/inference/preprocessing.js";

describe("local inference utilities", () => {
  it("preprocesses RGBA to deterministic normalized NCHW", () => {
    const output = preprocessRgbaToNchw(
      new Uint8ClampedArray([255, 0, 127, 255]),
      1,
      1,
      {
        inputWidth: 1,
        inputHeight: 1,
        mean: [0.5, 0.5, 0.5],
        standardDeviation: [0.5, 0.5, 0.5],
      },
    );
    expect([...output]).toEqual([1, -1, expect.closeTo(-0.0039215686)]);
  });

  it("validates embedding dimensions and finite values", () => {
    expect(validateEmbedding(new Float32Array([1, 2]), 2)).toHaveLength(2);
    expect(() =>
      validateEmbedding(new Float32Array([1, Number.NaN]), 2),
    ).toThrow(TypeError);
  });

  it("bounds queued work and cancels obsolete candidate jobs", async () => {
    const scheduler = new InferenceScheduler<number>(1);
    scheduler.setPaused(true);
    const obsolete = scheduler.enqueue({
      id: "old",
      candidateRevision: 1,
      run: async () => 1,
    });
    const current = scheduler.enqueue({
      id: "new",
      candidateRevision: 2,
      run: async () => 2,
    });
    await expect(obsolete).rejects.toMatchObject({ name: "AbortError" });
    scheduler.setPaused(false);
    await expect(current).resolves.toBe(2);
    expect(scheduler.queueLength).toBe(0);
  });
});
