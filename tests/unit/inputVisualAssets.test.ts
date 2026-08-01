import { describe, expect, it } from "vitest";

import { XR_INPUT_VISUAL_ASSETS } from "../../src/xr/inputVisualAssets.js";

describe("XR input visual assets", () => {
  it("maps local models to every profile URL IWSDK requests on Quest", () => {
    expect(XR_INPUT_VISUAL_ASSETS).toEqual([
      {
        localUrl: "./assets/input-visuals/hand-left.glb",
        profileUrl:
          "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/left.glb",
      },
      {
        localUrl: "./assets/input-visuals/hand-right.glb",
        profileUrl:
          "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/right.glb",
      },
      {
        localUrl: "./assets/input-visuals/controller-left.glb",
        profileUrl:
          "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/meta-quest-touch-plus/left.glb",
      },
      {
        localUrl: "./assets/input-visuals/controller-right.glb",
        profileUrl:
          "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/meta-quest-touch-plus/right.glb",
      },
    ]);
  });
});
