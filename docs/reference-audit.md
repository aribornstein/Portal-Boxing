# Reference Repository Audit

Audit date: 2026-07-30. No reference code or asset has been copied into this repository.

## EverythingController

Inspected `README.md` and `evc.html` in `ARDings/EverythingController`.

Adopted concepts:

- Configurable sparse depth grid with a hard sample cap.
- Depth validity bounds and floor-height filtering.
- Reused vectors and an instanced debug point visualization.
- Treating samples as collision probes and using a depth-write-only visualization for optional occlusion.
- User-visible calibration values and quality controls.

Rejected or rewritten:

- XR Blocks 0.11 and global singleton access are not IWSDK ECS patterns.
- CDN import maps violate offline and CSP requirements.
- Per-frame allocations (`Vector3.clone`, new vectors), per-target brute force, and sample processing every render frame do not meet the Quest budget.
- The pinhole ray/cosine unprojection plus a fixed camera-right offset is device-specific calibration, not a general WebXR transform solution.
- Sample points do not constitute a room reconstruction or reliable body tracker.

Assets considered: none. The experience creates primitive geometry and loads dependencies remotely.

License: no LICENSE/COPYING file was found through repository search. Code and assets are therefore reference-only and not reusable without explicit permission.

## mr-boxing

Inspected `index.html`, `tracking.js`, `debugger.js`, `eventBus.js`, and `README.md` in `aribornstein/mr-boxing`.

Adopted concepts:

- Visual meshes and named gameplay hitboxes are separate.
- Kinematic strike proxies drive collision events.
- Hit-region-specific animation reactions and an animation lock prevent overlapping reactions.
- Object inference is rate-limited and tracked colliders are explicitly removed.
- Physics debug visualization and a simple event boundary are useful diagnostics.

Rejected or rewritten:

- YOLO is explicitly out of scope.
- Arbitrary `getUserMedia` stereo cameras cannot access Quest passthrough and are not a supported camera-image path.
- Direct `navigator.xr.requestSession`, raw Three renderer, Reality Accelerator, and raw Rapier world conflict with IWSDK lifecycle.
- Runtime CDN imports and a CDN sprite violate offline packaging and CSP.
- Label-keyed object identity, fixed stereo intrinsics, crude vertical matching, per-frame allocations, and dynamic hitbox bodies are not production-safe.
- `setTimeout` inference is replaced by one bounded scheduler/worker with cancellation and backpressure.

Assets considered: boxer/glove GLBs, ONNX files, and animation clips were referenced by source code, but their provenance and licenses were not documented in the inspected repository. None are approved for reuse.

License: no LICENSE/COPYING file was found through repository search. Code and assets are reference-only.

## Migration Decisions

- Rewrite all runtime behavior as focused IWSDK systems and engine-neutral domain modules.
- Use IWSDK AssetManager and locally packaged manifests for approved assets.
- Use IWSDK Havok physics rather than creating the reference's second Rapier world.
- Replace camera/YOLO tracking with scene labels, geometry, supported camera crops when confirmed, local SigLIP2, and user review.
- Preserve deterministic synthetic and recorded fixtures for all hardware-dependent paths.
