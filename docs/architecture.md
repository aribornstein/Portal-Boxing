# Architecture Decision Record

## ADR-001: IWSDK Owns Runtime Lifecycle

`World.create` owns the renderer, XR session, frame loop, input, scene-understanding systems, depth occlusion, and optional physics. PORTALAR registers focused ECS systems and never starts another render, XR, physics, AI, or inference loop.

The production session is `immersive-ar`, prefers `bounded-floor`, falls back to `local-floor` then `local`, requests hand tracking, planes, meshes, anchors, hit test, light estimation, depth sensing, and layers as optional capabilities, and disables locomotion. A missing optional feature degrades through an adapter and is visible in diagnostics.

## ADR-002: Explicit Pure State Machines

Application, encounter, enemy, and semantic-object transitions use a reusable transition-table state machine. Transitions return structured events, reject illegal edges, and notify debug observers. ECS components mirror runtime state where entity queries need it; they do not contain transition policy.

## ADR-003: Capability Adapters

IWSDK-supported scene understanding and depth occlusion are used directly. Data access not exposed as a stable IWSDK abstraction uses typed adapters around standards-based WebXR objects obtained from IWSDK's renderer/XR manager. Physical, synthetic, recorded, and null providers implement the same contracts.

Camera imagery is capability-gated. `features.camera` is confirmed in IWSDK world declarations, but no production crop path is considered available until its permission model and frame API are confirmed. No `getUserMedia`, canvas capture of passthrough, native bridge, or private API is allowed.

## ADR-004: Physics Boundary

IWSDK 0.4.2 implements `features.physics` with Havok. It does not expose a supported Rapier integration. Gameplay collision, strike gating, hit regions, navigation, and damage therefore depend on engine-neutral domain interfaces. IWSDK PhysicsBody/PhysicsShape may implement physical proxies. The old repository's raw Rapier world is a behavioral reference only and will not create a second physics world.

## ADR-005: Safety Before Layout

Room processing produces provenance-tagged observations, restricted regions, and a strike-safe volume. Portal placement and enemy navigation consume the resulting `SafetyAssessment`; combat does not begin until the room flow has completed or an explicit debug bypass is active. Unknown, stale, low-confidence, living, fragile, glass, sharp, hot, and restricted candidates are never promoted to safe interactions automatically.

## ADR-006: Bounded Asynchronous Inference

Semantic inference is independent from XR rendering. A single worker owns one ONNX session, jobs are bounded and cancellable, candidates are hashed, and frame/thermal pressure applies backpressure. WebGPU is preferred and WASM is fallback. Geometry and user review remain functional when imagery or model execution is unavailable.

## ADR-007: Deterministic Content

Stage generation accepts room snapshot hash, game version, seed, and difficulty and emits a serializable manifest. Runtime systems consume typed content; they do not hardcode complete stages. Rendering is a consumer and cannot alter combat outcomes.

## ADR-008: Exclusive Punch And Kick Ownership

`HandCombatSystem` owns tracked-input strikes against the authored head and upper-torso anchors. `KickCombatSystem` owns GPU-depth contact against independent left-leg, right-leg, and groin anchors. There is no shared anonymous-body or held-object impact classifier. A compatibility-only held-object reaction variant remains in the impact domain, but no detector emits it. Direct and swept hand/controller evidence rejects a lower-body depth candidate so both systems cannot authorize the same contact.

Each kick target has independent mask, temporal, lifecycle, and cooldown state. Target anchors live outside cosmetic reaction transforms. Apparent depth speed is compensated for target translation and rotational surface travel before coherence and scoring, preventing stationary room geometry from becoming an impact merely because enemy navigation moves or turns a target through it.

## Runtime Layers

1. Platform: capability probing, IWSDK lifecycle, XR adapters, cleanup.
2. Room: raw observations, depth probes, fused surfaces/objects, safety assessment.
3. Semantics: taxonomy, geometry evidence, optional vision evidence, user correction.
4. Game domain: state machines, generation, combat, AI, waves, boss, score.
5. Presentation: portals, windows, animation, effects, audio, HUD and debug layers.
6. Tooling: deterministic fixtures, asset pipeline, browser/IWER tests, release checks.

## Restart and Cleanup

The bootstrap owns one world. Session-scoped adapters release XR spaces and raw frame references on `sessionend`. Workers, model sessions, render targets, audio nodes, physics entities, subscriptions, and DOM listeners each have one owner and an idempotent `dispose`. Restart resets domain state and pooled objects without constructing a duplicate world.
