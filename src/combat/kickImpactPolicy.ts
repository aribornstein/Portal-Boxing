import type { KickRecognitionDecision } from "./kickRecognition.js";

export type KickImpactPolicyOutcome =
  | { readonly kind: "rejection-diagnostic" }
  | { readonly kind: "accepted-impact" };

export function resolveKickImpactPolicy(
  decision: KickRecognitionDecision,
): KickImpactPolicyOutcome {
  if (decision.decision === "reject") {
    return { kind: "rejection-diagnostic" };
  }
  return { kind: "accepted-impact" };
}
