import type { SimulationSnapshot } from "../app/gameSimulation.js";

export type CombatAudioCue =
  | "portal"
  | "target-lock"
  | "hit"
  | "kick-hit"
  | "player-hit"
  | "guard"
  | "wave-clear"
  | "knockout";

export function selectCombatAudioCuesInto(
  previous: SimulationSnapshot,
  current: SimulationSnapshot,
  output: CombatAudioCue[],
) {
  output.length = 0;
  if (previous.application !== "PLAYING" && current.application === "PLAYING")
    output.push("portal");
  if (
    !previous.physicalContactDiagnosticsEnabled &&
    current.physicalContactDiagnosticsEnabled
  ) {
    output.push("target-lock");
  }
  const hasNewImpact =
    (current.latestImpact?.sequence ?? 0) >
    (previous.latestImpact?.sequence ?? 0);
  if (
    current.application === "PLAYING" &&
    (hasNewImpact || current.score > previous.score) &&
    (previous.encounter === "COMBAT" || previous.encounter === "BOSS_COMBAT")
  ) {
    output.push(
      hasNewImpact && current.latestImpact?.source === "kick"
        ? "kick-hit"
        : "hit",
    );
  }
  if (current.playerHealth < previous.playerHealth) {
    output.push(current.playerGuarding ? "guard" : "player-hit");
  }
  if (
    (current.encounter === "WAVE_CLEAR" &&
      previous.encounter !== "WAVE_CLEAR") ||
    (current.encounter === "STAGE_CLEAR" &&
      previous.encounter !== "STAGE_CLEAR")
  ) {
    output.push("wave-clear");
  }
  if (
    current.application === "PAUSED" &&
    current.playerHealth === 0 &&
    previous.playerHealth > 0
  ) {
    output.push("knockout");
  }
  return output;
}
