import type { KickDepthEvidence, KickTargetId } from "./kickRecognition.js";

export type KickContactState = "CLEAR" | "APPROACHING" | "CONTACT" | "COOLDOWN";

export interface KickDepthContactEvent {
  readonly sequence: number;
  readonly targetId: KickTargetId;
  readonly startTimestampUs: number;
  readonly contactTimestampUs: number;
  readonly endTimestampUs: number;
  readonly contactPositionTargetLocal: readonly [number, number, number];
  readonly approachDirectionTargetLocal: readonly [number, number, number];
  readonly apparentApproachSpeedMps: number;
  readonly coherentSampleCount: number;
  readonly validSampleFraction: number;
  readonly minimumSeparationMeters: number;
  readonly contactDurationUs: number;
  readonly confidence: number;
}

export interface KickContactDetectorConfig {
  readonly targetId: KickTargetId;
  readonly approachThresholdMeters: number;
  readonly contactThresholdMeters: number;
  readonly releaseThresholdMeters: number;
  readonly minimumCoherentSamples: number;
  readonly cooldownUs: number;
  readonly minimumApproachFrames: number;
  readonly maximumContactCandidateAgeUs: number;
  readonly minimumApproachSpeedMps: number;
}

export interface KickContactDetectorFrame {
  readonly timestampUs: number;
  readonly depth: KickDepthEvidence;
  readonly targetMotionMps: number;
}

export interface KickContactDetectorUpdate {
  readonly state: KickContactState;
  readonly contactDetected: boolean;
  readonly event?: KickDepthContactEvent;
}

export function kickContactDetectorConfig(
  targetId: KickTargetId,
): KickContactDetectorConfig {
  return {
    targetId,
    approachThresholdMeters: 0.13,
    contactThresholdMeters: 0.025,
    releaseThresholdMeters: 0.1,
    minimumCoherentSamples: 4,
    cooldownUs: 220_000,
    minimumApproachFrames: 2,
    maximumContactCandidateAgeUs: 150_000,
    minimumApproachSpeedMps: 0.35,
  };
}

export class KickContactDetector {
  private state: KickContactState = "CLEAR";
  private previousFrame: KickContactDetectorFrame | undefined;
  private approachFrames = 0;
  private sequence = 0;
  private cooldownUntilUs = 0;
  private approachStartUs = 0;
  private approachStartPosition: readonly [number, number, number] | undefined;
  private peakApproachSpeedMps = 0;
  private contactCandidate: KickContactDetectorFrame | undefined;
  private clearBaseline = false;

  constructor(private readonly config: KickContactDetectorConfig) {}

  update(frame: KickContactDetectorFrame): KickContactDetectorUpdate {
    if (
      this.previousFrame &&
      frame.timestampUs <= this.previousFrame.timestampUs
    ) {
      throw new Error("Kick contact timestamps must increase");
    }
    if (!this.clearBaseline) {
      this.clearBaseline = isClear(frame.depth, this.config);
      this.previousFrame = frame;
      return { state: this.state, contactDetected: false };
    }

    const approachSpeed = this.approachSpeed(frame);
    const coherent = this.isCoherent(frame.depth, approachSpeed);
    const contactCandidate = this.recentContactCandidate(frame.timestampUs);
    let contactDetected = false;
    let event: KickDepthContactEvent | undefined;

    if (this.state === "CLEAR") {
      if (
        contactCandidate &&
        coherent &&
        approachSpeed >= this.config.minimumApproachSpeedMps
      ) {
        this.state = "APPROACHING";
        this.approachStartUs =
          this.previousFrame?.timestampUs ?? contactCandidate.timestampUs;
        this.approachStartPosition =
          this.previousFrame?.depth.centroidTargetLocal ??
          contactCandidate.depth.centroidTargetLocal;
        this.peakApproachSpeedMps = approachSpeed;
        event = this.beginContact(contactCandidate, frame.timestampUs);
        contactDetected = true;
      } else if (
        coherent &&
        frame.depth.minimumSeparationMeters <=
          this.config.approachThresholdMeters
      ) {
        this.approachFrames += 1;
        if (this.approachFrames >= this.config.minimumApproachFrames) {
          this.state = "APPROACHING";
          this.approachStartUs =
            this.previousFrame?.timestampUs ?? frame.timestampUs;
          this.approachStartPosition =
            this.previousFrame?.depth.centroidTargetLocal ??
            frame.depth.centroidTargetLocal;
          this.peakApproachSpeedMps = Math.max(
            this.peakApproachSpeedMps,
            approachSpeed,
          );
          if (
            frame.depth.minimumSeparationMeters <=
              this.config.contactThresholdMeters &&
            this.hasCoherentContact(frame.depth)
          ) {
            event = this.beginContact(frame, frame.timestampUs);
            contactDetected = true;
          }
        }
      } else {
        this.approachFrames = 0;
      }
    } else if (this.state === "APPROACHING") {
      this.peakApproachSpeedMps = Math.max(
        this.peakApproachSpeedMps,
        approachSpeed,
      );
      if (
        !coherent ||
        frame.depth.minimumSeparationMeters > this.config.releaseThresholdMeters
      ) {
        this.resetToClear();
      } else if (
        frame.depth.minimumSeparationMeters <=
        this.config.contactThresholdMeters
      ) {
        if (this.hasCoherentContact(frame.depth)) {
          event = this.beginContact(frame, frame.timestampUs);
          contactDetected = true;
        }
      }
    } else if (this.state === "CONTACT") {
      if (
        frame.depth.minimumSeparationMeters >=
          this.config.releaseThresholdMeters ||
        !coherent
      ) {
        this.state = "COOLDOWN";
        this.cooldownUntilUs = frame.timestampUs + this.config.cooldownUs;
      }
    } else if (
      frame.timestampUs >= this.cooldownUntilUs &&
      (!coherent ||
        frame.depth.minimumSeparationMeters >=
          this.config.releaseThresholdMeters)
    ) {
      this.resetToClear();
    }

    if (this.isLiveContactCandidate(frame)) this.contactCandidate = frame;
    this.previousFrame = frame;
    return {
      state: this.state,
      contactDetected,
      ...(event ? { event } : {}),
    };
  }

  reset() {
    this.state = "CLEAR";
    this.previousFrame = undefined;
    this.approachFrames = 0;
    this.cooldownUntilUs = 0;
    this.peakApproachSpeedMps = 0;
    this.approachStartPosition = undefined;
    this.contactCandidate = undefined;
    this.clearBaseline = false;
  }

  get currentState() {
    return this.state;
  }

  private isCoherent(depth: KickDepthEvidence, approachSpeed: number) {
    const localizedMotionSupported =
      depth.localizedApproachSampleCount >=
        Math.max(2, Math.floor(this.config.minimumCoherentSamples / 2)) ||
      (depth.localizedApproachSampleCount >= 1 &&
        depth.contactSampleCount >= this.config.minimumCoherentSamples);
    return (
      localizedMotionSupported &&
      approachSpeed >= this.config.minimumApproachSpeedMps &&
      depth.validSampleCount >= this.config.minimumCoherentSamples &&
      depth.approachSampleCount >= this.config.minimumCoherentSamples &&
      depth.validSampleFraction >= 0.5
    );
  }

  private approachSpeed(frame: KickContactDetectorFrame) {
    return Math.max(
      0,
      frame.depth.localizedApproachSpeedMps -
        Math.max(0, frame.targetMotionMps),
    );
  }

  private beginContact(
    frame: KickContactDetectorFrame,
    endTimestampUs: number,
  ) {
    this.state = "CONTACT";
    this.contactCandidate = undefined;
    return {
      sequence: ++this.sequence,
      targetId: this.config.targetId,
      startTimestampUs: this.approachStartUs,
      contactTimestampUs: frame.timestampUs,
      endTimestampUs,
      contactPositionTargetLocal: frame.depth.centroidTargetLocal,
      approachDirectionTargetLocal: normalize(
        subtract(
          frame.depth.centroidTargetLocal,
          this.approachStartPosition ?? frame.depth.centroidTargetLocal,
        ),
      ),
      minimumSeparationMeters: frame.depth.minimumSeparationMeters,
      coherentSampleCount: frame.depth.contactSampleCount,
      apparentApproachSpeedMps: this.peakApproachSpeedMps,
      validSampleFraction: frame.depth.validSampleFraction,
      contactDurationUs: endTimestampUs - frame.timestampUs,
      confidence: Math.min(
        1,
        0.35 +
          frame.depth.contactSampleCount / 40 +
          this.peakApproachSpeedMps / 5,
      ),
    };
  }

  private resetToClear() {
    this.state = "CLEAR";
    this.approachFrames = 0;
    this.peakApproachSpeedMps = 0;
    this.approachStartPosition = undefined;
    this.contactCandidate = undefined;
  }

  private isLiveContactCandidate(frame: KickContactDetectorFrame) {
    return (
      frame.depth.validSampleCount >= this.config.minimumCoherentSamples &&
      frame.depth.approachSampleCount >= this.config.minimumCoherentSamples &&
      this.hasCoherentContact(frame.depth) &&
      frame.depth.validSampleFraction >= 0.5 &&
      frame.depth.minimumSeparationMeters <= this.config.contactThresholdMeters
    );
  }

  private hasCoherentContact(depth: KickDepthEvidence) {
    return depth.contactSampleCount >= this.config.minimumCoherentSamples;
  }

  private recentContactCandidate(timestampUs: number) {
    const candidate = this.contactCandidate;
    if (
      !candidate ||
      timestampUs - candidate.timestampUs >
        this.config.maximumContactCandidateAgeUs
    ) {
      this.contactCandidate = undefined;
      return undefined;
    }
    return candidate;
  }
}

function isClear(depth: KickDepthEvidence, config: KickContactDetectorConfig) {
  return (
    depth.validSampleCount >= config.minimumCoherentSamples &&
    depth.validSampleFraction >= 0.5 &&
    depth.approachSampleCount === 0 &&
    depth.contactSampleCount === 0
  );
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function normalize(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  const magnitude = Math.hypot(value[0], value[1], value[2]);
  return magnitude > 0
    ? [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude]
    : [0, 0, 0];
}
