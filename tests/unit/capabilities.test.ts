import { describe, expect, it } from "vitest";

import { localVisionInferenceCapability } from "../../src/app/capabilities.js";

describe("local vision inference capability", () => {
  it("blocks inference when supported camera frames are unavailable", () => {
    expect(
      localVisionInferenceCapability({
        cameraFramesAvailable: false,
        modelCache: "cached",
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("requires a verified local model after camera support", () => {
    expect(
      localVisionInferenceCapability({
        cameraFramesAvailable: true,
        modelCache: "missing",
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("reports ready only when both prerequisites are satisfied", () => {
    expect(
      localVisionInferenceCapability({
        cameraFramesAvailable: true,
        modelCache: "cached",
      }),
    ).toMatchObject({ status: "available" });
  });
});
