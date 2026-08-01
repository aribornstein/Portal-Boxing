import { describe, expect, it } from "vitest";

import { bossPhase, selectEnemyBehavior } from "../../src/ai/enemyDecision.js";
import {
  calculateDamage,
  canActivateHeldObject,
  kickAvailability,
  StrikeGate,
  VelocityEstimator,
} from "../../src/combat/combatTracking.js";
import { DestructibleProxy } from "../../src/furniture/destructibleProxy.js";
import { generateStage } from "../../src/generation/stageGenerator.js";
import { AdaptiveQualityManager } from "../../src/performance/qualityManager.js";
import { GameSimulation } from "../../src/app/gameSimulation.js";

const portal = {
  surfaceId: "wall-a",
  center: [0, 1, -2] as const,
  facing: [0, 0, 1] as const,
  width: 1.2,
  height: 2,
  score: 1,
};

describe("game domain", () => {
  it("resumes visibility pauses but keeps emergency stops paused", () => {
    const simulation = new GameSimulation(false);
    simulation.markRuntimeReady();
    simulation.enterRoomSetup();
    simulation.setSafetyBypass(true);
    simulation.continueWithoutRoomSafety();
    simulation.openPortal();

    simulation.pause("XR visibility interrupted", true);
    expect(simulation.snapshot.application).toBe("PAUSED");
    expect(simulation.resume("XR visibility restored")).toBe(true);
    expect(simulation.snapshot.application).toBe("PLAYING");

    simulation.pause("Emergency stop");
    expect(simulation.resume("XR visibility restored")).toBe(false);
    expect(simulation.snapshot.application).toBe("PAUSED");
  });

  it("records diagnostic impacts without changing either health pool", () => {
    const simulation = new GameSimulation(false);
    simulation.markRuntimeReady();
    simulation.enterRoomSetup();
    simulation.setSafetyBypass(true);
    simulation.continueWithoutRoomSafety();
    simulation.openPortal();
    const enemyHealth = simulation.snapshot.encounterHealth;
    const playerHealth = simulation.snapshot.playerHealth;

    simulation.setPhysicalContactDiagnostics(true);
    expect(
      simulation.applyPlayerImpact(20, {
        source: "held-object",
        region: "limb",
        direction: [0, 0, -1],
        speed: 3,
        confidence: 0.8,
        timestamp: 1,
      }),
    ).toBe(true);
    expect(simulation.snapshot.latestImpact).toMatchObject({
      source: "held-object",
    });
    expect(simulation.snapshot.encounterHealth).toBe(enemyHealth);
    expect(simulation.applyEnemyStrike(20)).toBe(false);
    expect(simulation.snapshot.playerHealth).toBe(playerHealth);
  });

  it("generates deterministic stages and varies seeds", () => {
    const context = {
      gameVersion: "0.1.0",
      roomSnapshotHash: "room",
      seed: 42,
      difficulty: "normal" as const,
      portalCandidates: [portal],
      performanceEnemyCap: 2,
    };
    const first = generateStage(context);
    expect(generateStage(context)).toEqual(first);
    expect(generateStage({ ...context, seed: 7 })).not.toEqual(first);
    expect(first.waves.map((wave) => wave.enemies)).toEqual([
      ["striker"],
      ["guard"],
      ["bruiser"],
      ["heavyweight"],
    ]);
    expect(first.waves.every((wave) => wave.activeEnemyCap === 1)).toBe(true);
    expect(first.waves.at(-1)?.bossTrigger).toBe(true);
  });

  it("estimates velocity and gates one hit per contact", () => {
    const estimator = new VelocityEstimator();
    estimator.update({ position: [0, 0, 0], timestamp: 0, confidence: 1 });
    expect(
      estimator.update({
        position: [0, 0, -0.2],
        timestamp: 100,
        confidence: 1,
      })[2],
    ).toBeLessThan(-1);
    const gate = new StrikeGate({
      minimumSpeed: 1,
      cooldownMilliseconds: 200,
      maximumSampleAgeMilliseconds: 100,
    });
    const options = {
      contactId: "contact",
      limbId: "right",
      timestamp: 1000,
      sampleTimestamp: 950,
      speed: 2,
      motionDotTarget: 1,
      overlap: true,
      trackingConfidence: 1,
      clearanceSafe: true,
    };
    expect(gate.accept(options)).toBe(true);
    expect(gate.accept(options)).toBe(false);
  });

  it("exposes kick unavailability and rejects unsafe held objects", () => {
    expect(
      kickAvailability({
        depthAvailable: false,
        trackingConfidence: 1,
        clearanceMeters: 2,
        insideSafeZone: true,
        restrictedInPath: false,
      }).reason,
    ).toContain("Depth");
    expect(
      canActivateHeldObject({
        label: "glass",
        confidence: 1,
        userConfirmed: true,
        handDistanceMeters: 0.1,
        geometryStable: true,
      }),
    ).toBe(false);
    expect(
      canActivateHeldObject({
        label: "pillow",
        confidence: 0.95,
        userConfirmed: true,
        handDistanceMeters: 0.1,
        geometryStable: true,
      }),
    ).toBe(true);
  });

  it("clamps damage", () => {
    expect(
      calculateDamage({
        speed: 100,
        type: "front-kick",
        hitRegion: "head",
        guarded: false,
        combo: 20,
        difficulty: 2,
        safetyMaximum: 40,
      }),
    ).toBe(40);
  });

  it("selects inspectable safe AI behavior and boss phases", () => {
    const decision = selectEnemyBehavior("guard", {
      distanceToPlayer: 1,
      relativeAngle: 0,
      playerHandSpeed: 3,
      playerGuarding: false,
      enemyHealthRatio: 1,
      enemyStaminaRatio: 1,
      enemyPoiseRatio: 1,
      safeTargetAvailable: false,
      obstacleDistance: 2,
      allyDistance: 2,
      timeSinceAttack: 1000,
      attackCooldown: 500,
    });
    expect(decision.selected).toBe("return-to-zone");
    expect(decision.scores["return-to-zone"]).toBe(1);
    expect([bossPhase(1), bossPhase(0.6), bossPhase(0.2)]).toEqual([1, 2, 3]);
  });

  it("keeps furniture damage virtual, policy-gated, pooled, and reversible", () => {
    const proxy = new DestructibleProxy("chair", 100, {
      permitted: true,
      safetyCategory: "safe",
      maximumFragments: 50,
    });
    expect(proxy.damage(75)).toBe("fractured");
    expect(proxy.damage(25)).toBe("destroyed");
    expect(proxy.requestedFragments()).toBe(12);
    proxy.reset();
    expect(proxy.state).toBe("intact");
  });

  it("degrades quality only after sustained pressure", () => {
    const manager = new AdaptiveQualityManager("high");
    for (let frame = 0; frame < 29; frame += 1) manager.update(20);
    expect(manager.tier).toBe("high");
    manager.update(20);
    expect(manager.tier).toBe("balanced");
  });
});
