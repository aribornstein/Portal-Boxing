import type { KickDepthContactEvent } from "./kickContactDetector.js";
import type { KickHandExclusionResult } from "./kickHandExclusion.js";

export interface KickScoreFeatures {
  readonly approachSpeed: number;
  readonly trajectoryContinuity: number;
  readonly invalidDepthFraction: number;
  readonly handDistance: number;
  readonly depthConfidence: number;
}

export interface KickScoreResult {
  readonly decision: "kick" | "reject";
  readonly confidence: number;
  readonly rejectReason?:
    | "hand-explains-contact"
    | "insufficient-motion"
    | "depth-instability"
    | "non-kick-contact";
}

const minimumKickConfidence = 0.58;
const minimumMotionMps = 0.35;
const maximumInvalidDepthFraction = 0.48;
const maximumContactOccupancy = 1.25;

export function extractKickScoreFeatures(
  event: KickDepthContactEvent,
  episodeFrameCount: number,
  hand: KickHandExclusionResult,
): KickScoreFeatures {
  return {
    approachSpeed: event.apparentApproachSpeedMps,
    trajectoryContinuity:
      event.coherentSampleCount / Math.max(1, episodeFrameCount * 8),
    invalidDepthFraction: 1 - event.validSampleFraction,
    handDistance: Math.min(
      hand.leftDistanceMeters,
      hand.rightDistanceMeters,
      1,
    ),
    depthConfidence: event.confidence,
  };
}

export function scoreKick(
  features: KickScoreFeatures,
  hand: KickHandExclusionResult,
): KickScoreResult {
  const motionConfidence = clamp01(features.approachSpeed / 1.2);
  const depthQuality = clamp01(
    1 - features.invalidDepthFraction / maximumInvalidDepthFraction,
  );
  const confidence =
    features.depthConfidence * 0.45 +
    motionConfidence * 0.35 +
    depthQuality * 0.2;
  if (hand.handExplainsContact) {
    return {
      decision: "reject",
      confidence,
      rejectReason: "hand-explains-contact",
    };
  }
  if (features.trajectoryContinuity > maximumContactOccupancy) {
    return { decision: "reject", confidence, rejectReason: "non-kick-contact" };
  }
  if (features.invalidDepthFraction > maximumInvalidDepthFraction) {
    return {
      decision: "reject",
      confidence,
      rejectReason: "depth-instability",
    };
  }
  if (features.approachSpeed < minimumMotionMps) {
    return {
      decision: "reject",
      confidence,
      rejectReason: "insufficient-motion",
    };
  }
  if (confidence < minimumKickConfidence) {
    return { decision: "reject", confidence, rejectReason: "non-kick-contact" };
  }
  return { decision: "kick", confidence };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
