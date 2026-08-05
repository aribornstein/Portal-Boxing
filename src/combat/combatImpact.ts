import type { Vec3 } from "../room/roomUnderstanding.js";

export type ImpactSource = "punch" | "kick" | "held-object";
export type HitRegion = "head" | "torso" | "abdomen" | "limb" | "guard";

export interface CombatImpact {
  readonly source: ImpactSource;
  readonly region: HitRegion;
  readonly direction: Vec3;
  readonly speed: number;
  readonly confidence: number;
  readonly timestamp: number;
}

export interface ImpactReaction {
  readonly durationSeconds: number;
  readonly displacementMeters: number;
  readonly pitchRadians: number;
  readonly rollRadians: number;
  readonly yawRadians: number;
}

export function reactionForImpact(impact: CombatImpact): ImpactReaction {
  const intensity = Math.min(1.8, Math.max(0.35, impact.speed / 3.5));
  const directionSign = impact.direction[0] < 0 ? -1 : 1;

  if (impact.source === "kick") {
    return {
      durationSeconds: 0.42,
      displacementMeters: 0.13 * intensity,
      pitchRadians: -0.22 * intensity,
      rollRadians: directionSign * 0.16 * intensity,
      yawRadians: directionSign * 0.08 * intensity,
    };
  }

  if (impact.source === "held-object") {
    const headMultiplier = impact.region === "head" ? 1.3 : 1;
    return {
      durationSeconds: 0.34,
      displacementMeters: 0.1 * intensity * headMultiplier,
      pitchRadians: -0.1 * intensity,
      rollRadians: directionSign * 0.2 * intensity * headMultiplier,
      yawRadians: directionSign * 0.24 * intensity * headMultiplier,
    };
  }

  if (impact.region === "head") {
    return {
      durationSeconds: 0.2,
      displacementMeters: 0.055 * intensity,
      pitchRadians: -0.06 * intensity,
      rollRadians: directionSign * 0.14 * intensity,
      yawRadians: directionSign * 0.18 * intensity,
    };
  }

  return {
    durationSeconds: 0.16,
    displacementMeters: 0.04 * intensity,
    pitchRadians: -0.1 * intensity,
    rollRadians: directionSign * 0.05 * intensity,
    yawRadians: directionSign * 0.06 * intensity,
  };
}
