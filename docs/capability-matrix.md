# Capability Matrix

| Capability                | Confirmed path                                                       | Fallback                         | Production policy                                 |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| WebXR / immersive AR      | `navigator.xr.isSessionSupported`, IWSDK `SessionMode.ImmersiveAR`   | Desktop simulation               | Explicit user launch only                         |
| Reference space           | IWSDK `ReferenceSpaceType.BoundedFloor` with fallbacks               | local-floor/local                | No artificial locomotion                          |
| Hands                     | IWSDK XR input / WebXR hand joints                                   | Synthetic trajectories           | Disable hand colliders when stale                 |
| Depth                     | IWSDK depth feature and DepthSensingSystem; typed CPU/GPU provider   | recorded, synthetic, null        | Optional; kick path explains unavailability       |
| Planes/meshes/anchors     | IWSDK SceneUnderstandingSystem                                       | synthetic room                   | Provenance retained                               |
| Hit test                  | IWSDK EnvironmentRaycastSystem / standard hit-test                   | geometry ray tests               | Placement still requires safety validation        |
| Camera images             | IWSDK declares `features.camera`; usable frame API not yet confirmed | fixture images, geometry, review | No unsupported passthrough capture                |
| Scene labels              | Browser/scene provider when supplied                                 | geometry and user correction     | Never assume unavailable labels                   |
| WebGPU                    | `navigator.gpu`                                                      | WASM                             | Inference only; initialization failure is visible |
| ONNX providers            | local `onnxruntime-web` package, pending integration                 | semantics without vision         | No CDN or cloud inference                         |
| Physics                   | IWSDK Havok                                                          | domain collision math            | No second Rapier world                            |
| IWER                      | IWSDK Vite plugin, Quest 3 profile                                   | deterministic unit fixtures      | Primary desktop XR path                           |
| Offline cache             | production service worker, pending                                   | static HTTPS files               | Same-origin only; versioned assets                |
| Physical Quest validation | Quest Browser + HTTPS                                                | none                             | Pending until executed on hardware                |

Availability is reported separately from permission, initialization, and active-use state. A feature is not marked available merely because a TypeScript declaration exists.
