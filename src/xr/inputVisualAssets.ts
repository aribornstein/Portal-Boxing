const PROFILE_ROOT =
  "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles";

export const XR_INPUT_VISUAL_ASSETS = [
  {
    localUrl: "./assets/input-visuals/hand-left.glb",
    profileUrl: `${PROFILE_ROOT}/generic-hand/left.glb`,
  },
  {
    localUrl: "./assets/input-visuals/hand-right.glb",
    profileUrl: `${PROFILE_ROOT}/generic-hand/right.glb`,
  },
  {
    localUrl: "./assets/input-visuals/controller-left.glb",
    profileUrl: `${PROFILE_ROOT}/meta-quest-touch-plus/left.glb`,
  },
  {
    localUrl: "./assets/input-visuals/controller-right.glb",
    profileUrl: `${PROFILE_ROOT}/meta-quest-touch-plus/right.glb`,
  },
] as const;
