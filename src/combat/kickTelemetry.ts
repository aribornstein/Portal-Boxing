import type { KickContactState } from "./kickContactDetector.js";
import type {
  KickDepthEvidence,
  KickRejectReason,
  KickTargetId,
} from "./kickRecognition.js";

export interface KickTelemetrySnapshot {
  readonly timestampUs: number;
  readonly targetId: KickTargetId;
  readonly selectedTarget?: KickTargetId;
  readonly state: KickContactState;
  readonly rejectionReason?: KickRejectReason;
  readonly usable: boolean;
  readonly validSampleFraction: number;
  readonly approachSampleCount: number;
  readonly contactSampleCount: number;
  readonly localizedApproachSampleCount: number;
  readonly localizedApproachSpeedMps: number;
  readonly targetMotionMps: number;
  readonly compensatedApproachSpeedMps: number;
  readonly minimumSeparationMeters: number;
}

export interface KickTelemetryEmission {
  readonly reason: "transition" | "interval";
  readonly snapshot: KickTelemetrySnapshot;
}

const emissionIntervalUs = 250_000;
const maximumRecords = 64;

export class KickTelemetry {
  private readonly lastEmissionUs: Record<KickTargetId, number> = {
    "opponent-left-target": Number.NEGATIVE_INFINITY,
    "opponent-right-target": Number.NEGATIVE_INFINITY,
    "opponent-groin-target": Number.NEGATIVE_INFINITY,
  };
  private readonly transitionSignatures: Record<KickTargetId, string> = {
    "opponent-left-target": "",
    "opponent-right-target": "",
    "opponent-groin-target": "",
  };
  private records: KickTelemetryEmission[] = [];

  capture(snapshot: KickTelemetrySnapshot): KickTelemetryEmission | undefined {
    const signature = `${snapshot.state}:${snapshot.selectedTarget ?? "none"}:${snapshot.rejectionReason ?? "none"}`;
    const transition =
      signature !== this.transitionSignatures[snapshot.targetId];
    const intervalElapsed =
      snapshot.timestampUs - this.lastEmissionUs[snapshot.targetId] >=
      emissionIntervalUs;
    if (!transition && !intervalElapsed) return undefined;
    this.transitionSignatures[snapshot.targetId] = signature;
    this.lastEmissionUs[snapshot.targetId] = snapshot.timestampUs;
    const emission: KickTelemetryEmission = {
      reason: transition ? "transition" : "interval",
      snapshot,
    };
    this.records.push(emission);
    if (this.records.length > maximumRecords) {
      this.records.splice(0, this.records.length - maximumRecords);
    }
    return emission;
  }

  history() {
    return this.records as readonly KickTelemetryEmission[];
  }

  reset() {
    this.lastEmissionUs["opponent-left-target"] = Number.NEGATIVE_INFINITY;
    this.lastEmissionUs["opponent-right-target"] = Number.NEGATIVE_INFINITY;
    this.lastEmissionUs["opponent-groin-target"] = Number.NEGATIVE_INFINITY;
    this.transitionSignatures["opponent-left-target"] = "";
    this.transitionSignatures["opponent-right-target"] = "";
    this.transitionSignatures["opponent-groin-target"] = "";
    this.records = [];
  }
}

export function kickTelemetrySnapshot(
  targetId: KickTargetId,
  timestampUs: number,
  depth: KickDepthEvidence,
  targetMotionMps: number,
  state: KickContactState,
  selectedTarget?: KickTargetId,
  rejectionReason?: KickRejectReason,
): KickTelemetrySnapshot {
  return {
    timestampUs,
    targetId,
    ...(selectedTarget ? { selectedTarget } : {}),
    state,
    ...(rejectionReason ? { rejectionReason } : {}),
    usable: depth.validSampleCount >= 4 && depth.validSampleFraction >= 0.5,
    validSampleFraction: depth.validSampleFraction,
    approachSampleCount: depth.approachSampleCount,
    contactSampleCount: depth.contactSampleCount,
    localizedApproachSampleCount: depth.localizedApproachSampleCount,
    localizedApproachSpeedMps: depth.localizedApproachSpeedMps,
    targetMotionMps,
    compensatedApproachSpeedMps: Math.max(
      0,
      depth.localizedApproachSpeedMps - Math.max(0, targetMotionMps),
    ),
    minimumSeparationMeters: depth.minimumSeparationMeters,
  };
}
