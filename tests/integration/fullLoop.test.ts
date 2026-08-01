import { describe, expect, it } from "vitest";

import { GameSimulation } from "../../src/app/gameSimulation.js";
import { createObservation } from "../../src/room/roomUnderstanding.js";

describe("desktop full game loop", () => {
  it("reduces guarded enemy damage and pauses on player defeat", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup();
    game.loadRoomFixture();
    game.confirmRoomSafety();
    game.openPortal();

    game.setPlayerGuarding(true);
    expect(game.applyEnemyStrike(20)).toBe(true);
    expect(game.snapshot.playerHealth).toBe(95);
    expect(game.snapshot.playerGuarding).toBe(true);

    game.setPlayerGuarding(false);
    expect(game.applyEnemyStrike(95)).toBe(true);
    expect(game.snapshot.playerHealth).toBe(0);
    expect(game.snapshot.application).toBe("PAUSED");
    expect(game.applyEnemyStrike(10)).toBe(false);
  });

  it("processes live room observations through safety and portal placement", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup("Immersive AR session requested");
    game.loadRoomObservations(
      [
        createObservation(
          "live-floor",
          "floor",
          [0, 0, 0],
          [4, 0.05, 4],
          [0, 1, 0],
          "plane",
          1,
        ),
        createObservation(
          "live-wall",
          "wall",
          [0, 1.25, -2],
          [3, 2.5, 0.05],
          [0, 0, 1],
          "plane",
          1,
        ),
        createObservation(
          "live-chair",
          "chair",
          [1, 0.5, 0],
          [0.5, 1, 0.5],
          [0, 1, 0],
          "mesh",
          0.9,
        ),
      ],
      [0, 1.6, 0],
    );
    expect(game.snapshot.application).toBe("SEMANTIC_REVIEW");
    expect(game.snapshot.safeZone?.halfExtents).toEqual([1.75, 1.2, 1.75]);
    expect(game.snapshot.navigationObstacles).toEqual([
      { min: [0.75, 0, -0.25], max: [1.25, 1, 0.25] },
    ]);
    game.confirmRoomSafety();
    expect(game.snapshot.application).toBe("STAGE_READY");
    expect(game.snapshot.stage?.portalPlacements).toHaveLength(1);
    expect(game.snapshot.stage?.roomSnapshotHash).toMatch(/^live-room-/);
  });

  it("blocks confirmation when live room clearance is unsafe", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup("Immersive AR session requested");
    game.loadRoomObservations(
      [
        createObservation(
          "small-floor",
          "floor",
          [0, 0, 0],
          [1.2, 0.05, 1.2],
          [0, 1, 0],
          "plane",
          1,
        ),
      ],
      [0, 1.6, 0],
    );
    expect(() => game.confirmRoomSafety()).toThrow(
      "Room safety requirements are not satisfied",
    );
    expect(game.snapshot.safetyReady).toBe(false);
  });

  it("requires an explicit debug toggle before bypassing room safety", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup("Debug XR session requested");

    expect(() => game.continueWithoutRoomSafety()).toThrow(
      "Enable the debug room safety bypass first",
    );

    game.setSafetyBypass(true);
    game.continueWithoutRoomSafety();

    expect(game.snapshot.application).toBe("STAGE_READY");
    expect(game.snapshot.safetyBypassEnabled).toBe(true);
    expect(game.snapshot.safetyReady).toBe(false);
    expect(game.snapshot.semanticConfirmed).toBe(false);
    expect(game.snapshot.stage?.portalPlacements.length).toBeGreaterThan(0);
    expect(game.snapshot.status).toContain("DEBUG BYPASS ACTIVE");

    game.restart();
    expect(game.snapshot.safetyBypassEnabled).toBe(false);
    expect(game.snapshot.application).toBe("SESSION_ENDED");
    game.enterRoomSetup("Debug setup restarted");
    expect(game.snapshot.application).toBe("SCANNING_ROOM");
  });

  it("advances a combat wave when tracked strikes exhaust encounter health", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup();
    game.loadRoomFixture();
    game.confirmRoomSafety();
    game.openPortal();
    expect(game.snapshot.stage?.portalPlacements).toHaveLength(2);
    expect(game.snapshot.activePortalIndex).toBe(0);
    expect(game.snapshot.stage?.waves[0].enemies).toHaveLength(1);
    const health = game.snapshot.encounterHealth;
    expect(health).toBeGreaterThan(0);
    expect(game.applyPlayerStrike(health - 1)).toBe(true);
    expect(game.snapshot.encounter).toBe("COMBAT");
    expect(game.applyPlayerStrike(1)).toBe(true);
    expect(game.snapshot.waveIndex).toBe(1);
    expect(game.snapshot.activePortalIndex).toBe(1);
    expect(game.snapshot.stage?.waves[1].enemies).toHaveLength(1);
    expect(game.snapshot.encounterHealth).toBeGreaterThan(health);
    const secondWaveHealth = game.snapshot.encounterHealth;
    game.completeCurrentWave();
    expect(game.snapshot.waveIndex).toBe(2);
    expect(game.snapshot.activePortalIndex).toBe(0);
    expect(game.snapshot.stage?.waves[2].enemies).toHaveLength(1);
    expect(game.snapshot.encounterHealth).toBeGreaterThan(secondWaveHealth);
    const thirdWaveHealth = game.snapshot.encounterHealth;
    game.completeCurrentWave();
    expect(game.snapshot.encounter).toBe("BOSS_COMBAT");
    expect(game.snapshot.activePortalIndex).toBe(1);
    expect(game.snapshot.stage?.waves[3].enemies).toHaveLength(1);
    expect(game.snapshot.encounterHealth).toBeGreaterThan(thirdWaveHealth);
  });

  it("publishes localized impacts without carrying them into a new enemy", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup();
    game.loadRoomFixture();
    game.confirmRoomSafety();
    game.openPortal();

    expect(
      game.applyPlayerImpact(1, {
        source: "held-object",
        region: "head",
        direction: [1, 0, 0],
        speed: 2.5,
        confidence: 0.9,
        timestamp: 1,
      }),
    ).toBe(true);
    expect(game.snapshot.latestImpact).toMatchObject({
      source: "held-object",
      region: "head",
      sequence: 1,
    });

    game.completeCurrentWave();
    expect(game.snapshot.latestImpact).toBeUndefined();
  });

  it("opens a new stage and enemy automatically when the boss is defeated", () => {
    const game = new GameSimulation(false);
    game.markRuntimeReady();
    game.enterRoomSetup();
    game.loadRoomFixture();
    game.confirmRoomSafety();
    const firstSeed = game.snapshot.stage?.seed;
    game.openPortal();
    game.completeCurrentWave();
    game.completeCurrentWave();
    game.completeCurrentWave();
    expect(game.snapshot.encounter).toBe("BOSS_COMBAT");
    game.advanceBossPhase();
    game.advanceBossPhase();
    expect(game.snapshot.bossPhase).toBe(3);
    expect(game.applyPlayerStrike(game.snapshot.encounterHealth)).toBe(true);
    expect(game.snapshot.stage?.seed).not.toBe(firstSeed);
    expect(game.snapshot.application).toBe("PLAYING");
    expect(game.snapshot.encounter).toBe("COMBAT");
    expect(game.snapshot.waveIndex).toBe(0);
    expect(game.snapshot.activePortalIndex).toBe(0);
    expect(game.snapshot.stage?.waves[0].enemies).toHaveLength(1);
    expect(game.snapshot.encounterHealth).toBeGreaterThan(0);
    expect(game.snapshot.encounterHealth).toBe(
      game.snapshot.encounterHealthMaximum,
    );
    game.restart();
    expect(game.snapshot.encounter).toBe("IDLE");
    expect(game.snapshot.score).toBe(0);
    expect(game.snapshot.playerHealth).toBe(100);
    expect(game.snapshot.playerGuarding).toBe(false);
    expect(game.snapshot.safeZone).toBeUndefined();
    expect(game.snapshot.navigationObstacles).toEqual([]);
  });
});
