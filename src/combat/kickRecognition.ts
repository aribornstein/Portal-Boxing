import {
  KickContactDetector,
  kickContactDetectorConfig,
} from "./kickContactDetector.js";
import {
  appendKickTrackedPose,
  evaluateKickHandExclusion,
} from "./kickHandExclusion.js";
import { extractKickScoreFeatures, scoreKick } from "./kickScoring.js";

export type KickTargetId =
  "opponent-left-target" | "opponent-right-target" | "opponent-groin-target";

export type KickRecognitionProvenance = "depth-hand-fallback";

export type KickRejectReason =
  | "insufficient-motion"
  | "hand-explains-contact"
  | "depth-instability"
  | "non-kick-contact";

export interface KickDepthEvidence {
  readonly footprintSampleCount: number;
  readonly validSampleCount: number;
  readonly approachSampleCount: number;
  readonly contactSampleCount: number;
  readonly minimumSeparationMeters: number;
  readonly validSampleFraction: number;
  readonly localizedApproachSampleCount: number;
  readonly localizedApproachSpeedMps: number;
  readonly localizedRetreatSampleCount: number;
  readonly localizedRetreatSpeedMps: number;
  readonly centroidTargetLocal: readonly [number, number, number];
  readonly spatialMoment: number;
  readonly coherentArea: number;
}

export interface KickTrackedPose {
  readonly position: readonly [number, number, number];
  readonly timestampUs: number;
  readonly trackingQuality: number;
}

export interface KickRecognitionFrame {
  readonly targetId: KickTargetId;
  readonly timestampUs: number;
  readonly depth: KickDepthEvidence;
  readonly targetMotionMps: number;
  readonly hands: Readonly<Partial<Record<"left" | "right", KickTrackedPose>>>;
}

export interface KickRecognitionDecision {
  readonly decision: "kick" | "reject";
  readonly targetId: KickTargetId;
  readonly speedMps: number;
  readonly confidence: number;
  readonly provenance?: KickRecognitionProvenance;
  readonly rejectReason?: KickRejectReason;
}

const maximumFrames = 64;
const episodeWindowUs = 750_000;

export class KickRecognitionEngine {
  private readonly detector: KickContactDetector;
  private readonly handHistories: Record<
    "left" | "right",
    readonly KickTrackedPose[]
  > = { left: [], right: [] };
  private frames: KickRecognitionFrame[] = [];

  constructor(readonly targetId: KickTargetId) {
    this.detector = new KickContactDetector(
      kickContactDetectorConfig(targetId),
    );
  }

  get contactState() {
    return this.detector.currentState;
  }

  process(frame: KickRecognitionFrame): KickRecognitionDecision | undefined {
    if (frame.targetId !== this.targetId) return undefined;
    for (const handedness of ["left", "right"] as const) {
      const pose = frame.hands[handedness];
      if (pose) {
        this.handHistories[handedness] = appendKickTrackedPose(
          this.handHistories[handedness],
          pose,
        );
      }
    }
    this.frames.push(frame);
    const frameCutoff = frame.timestampUs - episodeWindowUs;
    this.frames = this.frames
      .filter((candidate) => candidate.timestampUs >= frameCutoff)
      .slice(-maximumFrames);

    const update = this.detector.update(frame);
    const event = update.event;
    if (!event) return undefined;

    const hand = evaluateKickHandExclusion(event, this.handHistories);
    const episodeFrameCount = this.frames.filter(
      (candidate) =>
        candidate.timestampUs >= event.startTimestampUs &&
        candidate.timestampUs <= event.endTimestampUs,
    ).length;
    const features = extractKickScoreFeatures(event, episodeFrameCount, hand);
    const score = scoreKick(features, hand);
    return score.decision === "kick"
      ? {
          decision: "kick",
          targetId: this.targetId,
          speedMps: event.apparentApproachSpeedMps,
          confidence: score.confidence,
          provenance: "depth-hand-fallback",
        }
      : {
          decision: "reject",
          targetId: this.targetId,
          speedMps: event.apparentApproachSpeedMps,
          confidence: score.confidence,
          rejectReason: score.rejectReason,
        };
  }

  reset() {
    this.detector.reset();
    this.frames = [];
    this.handHistories.left = [];
    this.handHistories.right = [];
  }
}
