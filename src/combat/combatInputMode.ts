export type CombatInputMode = "none" | "controller" | "hand";

export interface CombatInputSource {
  readonly hand?: unknown;
}

export function combatInputMode(
  inputSource: CombatInputSource | undefined,
): CombatInputMode {
  if (!inputSource) return "none";
  return inputSource.hand ? "hand" : "controller";
}
