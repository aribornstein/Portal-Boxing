# PORTALAR: Beat 'em up in your room

PORTALAR is an AR-first WebXR boxing game built with IWSDK. It combines a deterministic room-safety and stage-generation core with live IWSDK hand tracking, scene-understanding adapters, bounded CPU-depth strike checks, target-local GPU-depth contact recognition, and procedural portal/opponent rendering.

The browser build can run the complete deterministic game loop. In an immersive session, strikes use IWSDK controller grip spaces while Touch controllers are primary and switch automatically to tracked index-tip spaces when Quest promotes hand tracking.

## Requirements

- Node.js `20.19.x`, `22.12+`, or `24.x`
- A secure browser context
- Meta Quest 3 or IWER for immersive AR development

Install dependencies and start the IWSDK-managed development runtime:

```bash
npm install
npm run dev
```

Check the active URL and runtime connection before starting another server:

```bash
npm run dev:status
npx iwsdk xr status
```

The development URL is assigned by IWSDK. Do not assume a fixed port.

## Room Setup

The game exposes two explicit room paths:

- **Use live room scan** converts current IWSDK `XRPlane` entities and bounded semantic `XRMesh` entities into safety observations. It does not substitute generated geometry when the runtime reports no planes or meshes.
- **Load room fixture** loads deterministic synthetic floor and wall observations for browser development and repeatable tests.

Both paths use the same clearance, restricted-object, semantic-review, portal-placement, and seeded-stage logic. A room needs a calibrated floor, at least `1.5 m` of reduced combat clearance, and a safe wall large enough for a portal before safety confirmation succeeds.

For stationary debugging, **Debug safety: enforced** can be toggled to **bypassed**, after which the separate **Continue without room safety** command advances setup with the deterministic room fixture when no scan has been captured. This mode keeps `safetyReady` false, displays `DEBUG BYPASS ACTIVE`, and resets on restart. It is not a physical-play safety result and must not be used while a person is boxing in the headset.

Room semantics are authoritative only after geometry, runtime scene labels, and user review are fused. The local ONNX service remains dormant infrastructure: Quest browser raw RGB passthrough frames/pixels are not exposed through a verified supported API, so no image model has a valid input source. PORTALAR therefore reports local vision inference as blocked, packages no SigLIP2 artifact, and never downloads a model at runtime.

## Controller-Optional Combat

`HandCombatSystem` reads the primary WebXR source for each side. Controller sources use `world.player.gripSpaces`; hand sources use `world.player.indexTipSpaces`. Changing source type resets motion history so an automatic controller-to-hand switch cannot register a false strike. A strike must:

- enter an opponent head or torso contact radius;
- travel toward the contact target;
- exceed `1.15 m/s`; and
- have no fresh CPU-depth sample inside the forward strike corridor; and
- occur outside the `0.22 s` per-hand cooldown.

Damage is clamped by the deterministic combat model. Depleting encounter health advances normal waves and eventually the boss encounter.

### Physical Contact And Objects

`PhysicalContactSystem` uses the live WebXR depth texture to observe anonymous physical geometry near the opponent. On Quest's GPU-only depth path, encoded robot body regions are rendered into a shared `64 x 64` contact mask for anonymous and held-object diagnostics. Each authored lower-leg kick pad has a separate `64 x 64` render target, readback buffer, reducer history, clear baseline, and recognizer. All three paths sample at no more than `24 Hz`. Separation hysteresis and cooldowns prevent static furniture or persistent overlap from repeatedly producing contact observations.

Depth geometry alone cannot identify a foot, kick, or other semantic impact source, so anonymous contact observations do not deal damage. A held-object strike requires an associated tracked hand or controller at extension distance, moving toward the same body region with sufficient speed and directional alignment. Direct hand overlap is left to `HandCombatSystem`, preventing depth and tracked-input paths from applying the same hit twice. Depth cannot identify an object's material or guarantee that it is safe: use only lightweight, soft, unbreakable objects with a clear physical swing path. Never use glass, sharp, heavy, or rigid objects.

Every trusted impact publishes its source, body region, direction, speed, confidence, and sequence. Head punches snap the head, torso punches compress the body, future trusted kick sources can create a longer whole-body recoil, and held-object hits add stronger directional rotation scaled by impact speed. The procedural reaction root is separate from enemy navigation, so feedback cannot push an opponent through captured furniture.

### Contextual Kick Recognition

The kick pipeline is adapted from XR-Depth-Kick revision `1b8c91a22d71b6eeac591c55a2566f3376a15951`. Two invisible `0.30 m x 0.30 m x 0.06 m` pads follow the opponent reaction root. Each independent mask encodes depth state, signed separation, and target-local coordinates. Its reducer finds the largest connected approach/contact clusters and computes contact centroid, spatial moment, coherent area, and same-pixel motion without sharing temporal state with the other pad.

A pad must first establish a usable clear baseline, then progress through `CLEAR -> APPROACHING -> CONTACT -> COOLDOWN`. The preserved proof constants are a `0.13 m` approach threshold, `0.025 m` contact threshold, `0.10 m` release threshold, four connected samples, `0.35 m/s` minimum compensated motion, a `150 ms` contact-candidate latch, `450 ms` maximum contact, and `300 ms` cooldown. Quest's sparse coherence rule accepts either two moving pixels or one moving pixel corroborated by at least four connected contact pixels. Per-pixel motion is compensated for opponent movement. Once motion begins, one authored opponent target is retained for the episode so overlapping pads cannot switch attribution mid-contact.

Tracked hand and controller poses are retained for a bounded history and swept against the target neighborhood. A fresh direct or swept input contact rejects the kick candidate and leaves punches to `HandCombatSystem`; explicit held-object evidence retains precedence. The selected left or right opponent target controls reaction location only. It does not identify which player foot performed the contact or distinguish front kick, side kick, knee, or shin.

The active Quest path uses target-local depth plus direct/swept tracked-input exclusion only. Body-tracking grants, foot joints, foot histories, and body-driven provenance are not part of the runtime decision. Recognition therefore emits only an accepted `depth-hand-fallback` candidate or an explicit rejection. During normal play an accepted fallback is telemetry-only because its false-acceptance rate has not been measured. With **Lock contact target** enabled, policy may publish a non-damaging diagnostic `CombatImpact` so testing receives robot reaction and the distinct `kick-hit` cue without promoting fallback evidence to production damage authority.

While locked, each pad emits a consolidated `[kick-telemetry]` record on lifecycle/decision transitions and at most every `250 ms` during stable state. Records include usable-depth status, valid fraction, approach/contact/moving sample counts, target-motion-compensated speed, minimum separation, selected opponent target, detector state, and rejection reason. The retained diagnostic history is bounded to 64 records.

Each wave contains one opponent with increasing health: striker, guard, bruiser, then heavyweight boss. When an opponent is defeated, its portal is replaced by the next validated wall placement before the tougher opponent emerges. Defeating the boss generates the next seeded stage and immediately opens its first portal and enemy, so play continues without a menu step. Rooms with only one valid portal wall reuse that placement.

Opponents use inspectable utility decisions to approach, guard, circle, or attack. Normal opponents approach to about `1.05 m` and bosses to `1.25 m`, then hold position rather than backing away when the player steps into punching range. A red glove ring marks the `0.65 s` attack windup. Incoming damage is applied only when the extended glove overlaps the player's head contact volume; an attack animation that misses does no damage. Holding both active grip poses or tracked index tips within `0.48 m` of the headset closes the guard and reduces a connected attack to 25%. Depleting player health pauses combat and requires a restart.

Room processing publishes high-confidence furniture and object bounds to combat. Opponent movement applies a `0.32 m` body radius, stays within the reduced safe zone, and takes a deterministic lateral step when its direct path intersects an expanded obstacle bound. If a portal spawn overlaps a furniture proxy, only steps that reduce the overlap are allowed until the opponent is clear. This is local steering around captured bounds, not a claimed general-purpose navmesh.

When WebXR supplies CPU depth, `DepthSafetySystem` samples a bounded `12 x 12` grid at no more than `12 Hz`, reconstructs points with the sensor projection and reference-space transform, rejects floor noise and stale frames, and vetoes a hand hit when physical geometry falls within `0.11 m` of the forward strike segment. Missing, GPU-only, stale, or invalid CPU depth does not fabricate clearance data. The separate GPU contact mask supports physical impacts on GPU-only Quest sessions; neither path replaces reviewed room planes and meshes for room safety or navigation.

Portal entry, player and opponent impacts, guard contact, attack windup, wave clear, and knockout use local deterministic WAV cues through IWSDK `AudioSource` entities. Punches and held-object strikes use the short `hit` cue, while accepted kicks use a lower, longer `kick-hit` cue. Portal, opponent-hit, kick-hit, and windup cues are positional; player feedback is head-relative ambient audio. Regenerate the project-owned cues with `npm run assets:audio`.

## Architecture

- `src/app/gameSimulation.ts`: authoritative deterministic application, encounter, health, safety, and stage state
- `src/room/`: room observations, plane/mesh adapters, safe-zone calculation, and live ECS capture
- `src/combat/`: pure combat calculations and live hand-contact registration
- `src/gameplay/presentationSystem.ts`: project-owned procedural portals and arcade robot opponents
- `src/xr/`: bounded depth sampling, world-space reconstruction, strike clearance, and live XR diagnostics
- `src/generation/` and `src/ai/`: seeded stage generation and inspectable utility decisions

IWSDK owns XR, rendering, input, ECS integration, scene understanding, and optional Havok facilities. The app does not initialize a second physics engine or read raw RGB passthrough camera frames/pixels; physical impacts use camera-derived WebXR depth.

## Validation

Run the full local validation suite:

```bash
npm run validate
npm run test:e2e
npm run assets:licenses
npm audit --omit=dev
```

The validation pipeline checks formatting, lint, strict TypeScript, unit/integration/performance tests, asset manifests and budgets, the production build, desktop game flow, mobile overflow, and compositor-visible spatial rendering.

For an initial physical kick-recognition pass on Quest:

1. Enter mixed reality, complete or explicitly bypass room setup, start combat, and enable **Lock contact target**. The robot stays stationary and non-attacking, its health remains fixed, and a chime confirms the lock. **Depth view** is optional and remains off unless enabled separately.
2. Punch the locked robot's head or torso. Each accepted punch should flash the target and play the spatial impact cue without changing its health.
3. Keep both lower-leg targets clear before each attempt, then make a controlled low-speed contact toward one target.
4. Expect `CLEAR -> APPROACHING/CONTACT -> COOLDOWN`, `KICK TEST CUE / FALLBACK`, a `[kick-recognition] accepted` record with `policy.kind: "locked-diagnostic-impact"`, and the lower `kick-hit` cue. Opponent health must not change.
5. Sweep a tracked hand or controller through the same lower target and expect `KICK REJECTED` with `HAND EXPLAINS CONTACT`; the punch path must not apply a duplicate lower-zone hit.
6. Exercise both opponent targets with both performed feet, plus walking, leaning, static overlap, near misses, and opponent movement. Record false accepts, false rejects, mask processing time, valid fraction, moving-pixel count, connected contact count, and compensated speed.

## Security And Assets

The app uses a same-origin content security policy. IWSDK currently requires inline runtime styles, a `data:` connection exception for Havok WASM initialization, and local `blob:` object URLs while decoding embedded GLB textures. No remote origin is allowed.

The generic hand and Quest Touch Plus profile models expected by IWSDK are packaged locally from `@webxr-input-profiles/assets@1.0.20`, hashed, budgeted, and registered under IWSDK's profile cache keys before XR entry. Controller visuals remain disabled because passthrough exposes the physical controllers, while a connected controller cannot trigger a remote profile request.

Production assets must be declared and hashed through `scripts/assets/`. No local inference model is currently packaged, and local vision inference remains explicitly blocked by both the absent supported raw RGB camera-frame path and model artifact rather than downloading an unverified model at runtime.

## Current Limits

- A physical Quest 3 run on 2026-07-30 verified immersive passthrough rendering, the spatial setup panel, procedural portal/opponent rendering, `58` live planes, `20` live meshes, deterministic progression through all waves and boss phases, and stable battery temperature between `42-44°C` during the short wired session.
- The same physical session exposed GPU-only depth. CPU-depth strike rejection remains fixture-tested, while the new GPU contact-mask path for real kicks and held objects still requires physical acceptance testing on that device.
- A 10-second Perfetto trace recorded a `72.1 Hz` Horizon compositor cadence with zero runtime late-frame markers. The traced frame loop belonged to Horizon Shell, not the browser process, so PORTALAR application FPS remains unverified.
- Physical controller strikes, automatic hand takeover, guard recognition, spatial-panel selection, reachable opponent spacing, obstacle-overlap escape, and contact-gated incoming damage still require a short headset pass. Hand takeover depends on Quest's automatic controller-to-hand switching setting.
- Live depth is not object recognition: held-object classification uses temporal geometry plus tracked-hand association and cannot identify material, weight, sharpness, or breakability.
- Opponents are project-owned procedural arcade robots; a production environment art set is not yet packaged.
- Quest raw RGB passthrough camera frame/pixel access is not used because no supported browser API has been verified for it.
