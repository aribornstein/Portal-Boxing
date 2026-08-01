import type { SimulationSnapshot } from "../app/gameSimulation.js";

export type CombatAudioCue =
  "portal" | "hit" | "player-hit" | "guard" | "wave-clear" | "knockout";

export function selectCombatAudioCuesInto(
  previous: SimulationSnapshot,
  current: SimulationSnapshot,
  output: CombatAudioCue[],
) {
  output.length = 0;
  if (previous.application !== "PLAYING" && current.application === "PLAYING")
    output.push("portal");
  if (
    current.application === "PLAYING" &&
    current.score > previous.score &&
    (previous.encounter === "COMBAT" || previous.encounter === "BOSS_COMBAT")
  ) {
    output.push("hit");
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
