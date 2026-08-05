import { describe, expect, it } from "vitest";

import type { SimulationSnapshot } from "../../src/app/gameSimulation.js";
import {
  selectCombatAudioCuesInto,
  type CombatAudioCue,
} from "../../src/audio/combatAudioEvents.js";

const baseSnapshot: SimulationSnapshot = {
  application: "PLAYING",
  encounter: "COMBAT",
  waveIndex: 0,
  bossPhase: 1,
  encounterHealth: 50,
  encounterHealthMaximum: 50,
  playerHealth: 100,
  playerHealthMaximum: 100,
  playerGuarding: false,
  score: 0,
  navigationObstacles: [],
  safetyReady: true,
  semanticConfirmed: true,
  status: "Combat",
};

describe("combat audio events", () => {
  it("signals portal entry", () => {
    expect(
      cues({ ...baseSnapshot, application: "STAGE_READY" }, baseSnapshot),
    ).toEqual(["portal"]);
  });

  it("signals when the physical contact target is locked", () => {
    expect(
      cues(baseSnapshot, {
        ...baseSnapshot,
        physicalContactDiagnosticsEnabled: true,
      }),
    ).toEqual(["target-lock"]);
  });

  it("signals player strikes and guarded or open incoming hits", () => {
    expect(cues(baseSnapshot, { ...baseSnapshot, score: 10 })).toEqual(["hit"]);
    const lockedSnapshot = {
      ...baseSnapshot,
      physicalContactDiagnosticsEnabled: true,
    };
    expect(
      cues(lockedSnapshot, {
        ...lockedSnapshot,
        latestImpact: {
          source: "punch",
          region: "torso",
          direction: [0, 0, -1],
          speed: 2,
          confidence: 1,
          timestamp: 1,
          sequence: 1,
        },
      }),
    ).toEqual(["hit"]);
    expect(
      cues(lockedSnapshot, {
        ...lockedSnapshot,
        latestImpact: {
          source: "kick",
          region: "limb",
          direction: [0, 0, -1],
          speed: 2.5,
          confidence: 0.8,
          timestamp: 2,
          sequence: 2,
        },
      }),
    ).toEqual(["kick-hit"]);
    expect(
      cues(baseSnapshot, {
        ...baseSnapshot,
        playerHealth: 95,
        playerGuarding: true,
      }),
    ).toEqual(["guard"]);
    expect(cues(baseSnapshot, { ...baseSnapshot, playerHealth: 90 })).toEqual([
      "player-hit",
    ]);
  });

  it("signals wave clear and knockout transitions", () => {
    expect(
      cues(baseSnapshot, { ...baseSnapshot, encounter: "WAVE_CLEAR" }),
    ).toEqual(["wave-clear"]);
    expect(
      cues(baseSnapshot, {
        ...baseSnapshot,
        application: "PAUSED",
        playerHealth: 0,
      }),
    ).toEqual(["player-hit", "knockout"]);
  });

  it("reuses and clears the caller-owned output array", () => {
    const output: CombatAudioCue[] = ["portal"];
    selectCombatAudioCuesInto(baseSnapshot, baseSnapshot, output);
    expect(output).toEqual([]);
  });
});

function cues(
  previous: SimulationSnapshot,
  current: SimulationSnapshot,
): CombatAudioCue[] {
  return selectCombatAudioCuesInto(previous, current, []);
}
