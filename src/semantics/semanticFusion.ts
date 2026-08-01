import { isInteractionSafe, type RoomLabel } from "./roomTaxonomy.js";
import type { ObservationSource, Vec3 } from "../room/roomUnderstanding.js";

export interface LabelEvidence {
  readonly label: RoomLabel;
  readonly score: number;
  readonly source: ObservationSource;
}

export interface SemanticResult {
  readonly candidates: readonly LabelEvidence[];
  readonly selectedLabel: RoomLabel;
  readonly fusedScore: number;
  readonly modelVersion?: string;
  readonly inputSources: readonly ObservationSource[];
  readonly geometryEvidence: {
    readonly dimensions: Vec3;
    readonly score: number;
  };
  readonly temporalEvidence: {
    readonly previousLabel?: RoomLabel;
    readonly stability: number;
  };
  readonly userConfirmation:
    "unreviewed" | "confirmed" | "corrected" | "restricted";
  readonly interactionSafe: boolean;
}

export function fuseSemanticEvidence(options: {
  evidence: readonly LabelEvidence[];
  dimensions: Vec3;
  geometryScores?: Readonly<Partial<Record<RoomLabel, number>>>;
  previousLabel?: RoomLabel;
  temporalStability?: number;
  userLabel?: RoomLabel;
  userRestricted?: boolean;
  modelVersion?: string;
}): SemanticResult {
  const temporalStability = Math.max(
    0,
    Math.min(1, options.temporalStability ?? 0),
  );
  const scores = new Map<RoomLabel, number>();
  for (const item of options.evidence) {
    const sourceWeight =
      item.source === "scene-label"
        ? 1
        : item.source === "siglip2"
          ? 0.8
          : 0.65;
    scores.set(
      item.label,
      (scores.get(item.label) ?? 0) + clamp01(item.score) * sourceWeight,
    );
  }
  for (const [label, score] of Object.entries(options.geometryScores ?? {}) as [
    RoomLabel,
    number,
  ][]) {
    scores.set(label, (scores.get(label) ?? 0) + clamp01(score) * 0.6);
  }
  if (options.previousLabel) {
    scores.set(
      options.previousLabel,
      (scores.get(options.previousLabel) ?? 0) + temporalStability * 0.5,
    );
  }

  const ordered = [...scores.entries()]
    .map(([label, score]) => ({
      label,
      score: Math.min(1, score),
      source: "geometry" as const,
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.label.localeCompare(right.label),
    );
  const inferred = ordered[0] ?? {
    label: "unknown object" as const,
    score: 0,
    source: "geometry" as const,
  };
  const selectedLabel = options.userRestricted
    ? "restricted area"
    : (options.userLabel ?? inferred.label);
  const fusedScore =
    options.userLabel || options.userRestricted ? 1 : inferred.score;
  const userConfirmation = options.userRestricted
    ? "restricted"
    : options.userLabel
      ? "corrected"
      : fusedScore >= 0.9
        ? "confirmed"
        : "unreviewed";

  return {
    candidates: ordered,
    selectedLabel,
    fusedScore,
    modelVersion: options.modelVersion,
    inputSources: [...new Set(options.evidence.map((item) => item.source))],
    geometryEvidence: {
      dimensions: options.dimensions,
      score: options.geometryScores?.[selectedLabel] ?? 0,
    },
    temporalEvidence: {
      previousLabel: options.previousLabel,
      stability: temporalStability,
    },
    userConfirmation,
    interactionSafe: isInteractionSafe(
      selectedLabel,
      fusedScore,
      userConfirmation === "confirmed" || userConfirmation === "corrected",
    ),
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
