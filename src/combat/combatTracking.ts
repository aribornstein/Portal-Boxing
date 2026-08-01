import type { RoomLabel } from "../semantics/roomTaxonomy.js";
import { isInteractionSafe } from "../semantics/roomTaxonomy.js";
import type { Vec3 } from "../room/roomUnderstanding.js";

export type Handedness = "left" | "right";
export type StrikeType =
  | "jab"
  | "cross"
  | "hook"
  | "uppercut"
  | "body"
  | "front-kick"
  | "side-kick"
  | "shin"
  | "held-object";

export interface MotionSample {
  readonly position: Vec3;
  readonly timestamp: number;
  readonly confidence: number;
}

export interface StrikeCandidate {
  readonly id: string;
  readonly handedness: Handedness;
  readonly type: StrikeType;
  readonly velocity: Vec3;
  readonly speed: number;
  readonly confidence: number;
  readonly timestamp: number;
}

export interface StrikeGateConfig {
  readonly minimumSpeed: number;
  readonly cooldownMilliseconds: number;
  readonly maximumSampleAgeMilliseconds: number;
}

export class VelocityEstimator {
  private previous: MotionSample | undefined;
  private readonly smoothed: number[] = [0, 0, 0];

  update(sample: MotionSample): Vec3 {
    const previous = this.previous;
    this.previous = sample;
    if (!previous || sample.timestamp <= previous.timestamp) return [0, 0, 0];
    const inverseDeltaSeconds = 1000 / (sample.timestamp - previous.timestamp);
    const alpha = 0.55;
    for (let axis = 0; axis < 3; axis += 1) {
      const raw =
        (sample.position[axis] - previous.position[axis]) * inverseDeltaSeconds;
      this.smoothed[axis] += (raw - this.smoothed[axis]) * alpha;
    }
    return [this.smoothed[0], this.smoothed[1], this.smoothed[2]];
  }

  reset() {
    this.previous = undefined;
    this.smoothed.fill(0);
  }
}

export function classifyHandStrike(
  handedness: Handedness,
  velocity: Vec3,
  targetOffset: Vec3,
): StrikeType {
  const horizontal = Math.abs(velocity[0]);
  const vertical = velocity[1];
  const forward = -velocity[2];
  if (vertical > Math.max(horizontal, forward) * 0.75) return "uppercut";
  if (horizontal > forward * 0.8) return "hook";
  if (targetOffset[1] < -0.35) return "body";
  const leadHand: Handedness = "left";
  return handedness === leadHand ? "jab" : "cross";
}

export class StrikeGate {
  private readonly lastHitByLimb = new Map<string, number>();
  private readonly consumedContacts = new Set<string>();

  constructor(private readonly config: StrikeGateConfig) {}

  accept(options: {
    readonly contactId: string;
    readonly limbId: string;
    readonly timestamp: number;
    readonly sampleTimestamp: number;
    readonly speed: number;
    readonly motionDotTarget: number;
    readonly overlap: boolean;
    readonly trackingConfidence: number;
    readonly clearanceSafe: boolean;
  }) {
    const previousHit =
      this.lastHitByLimb.get(options.limbId) ?? Number.NEGATIVE_INFINITY;
    if (
      this.consumedContacts.has(options.contactId) ||
      options.timestamp - previousHit < this.config.cooldownMilliseconds ||
      options.timestamp - options.sampleTimestamp >
        this.config.maximumSampleAgeMilliseconds ||
      options.speed < this.config.minimumSpeed ||
      options.motionDotTarget <= 0 ||
      !options.overlap ||
      options.trackingConfidence < 0.65 ||
      !options.clearanceSafe
    )
      return false;
    this.consumedContacts.add(options.contactId);
    this.lastHitByLimb.set(options.limbId, options.timestamp);
    return true;
  }

  releaseContact(contactId: string) {
    this.consumedContacts.delete(contactId);
  }

  reset() {
    this.lastHitByLimb.clear();
    this.consumedContacts.clear();
  }
}

export function kickAvailability(options: {
  readonly depthAvailable: boolean;
  readonly trackingConfidence: number;
  readonly clearanceMeters: number;
  readonly insideSafeZone: boolean;
  readonly restrictedInPath: boolean;
}) {
  if (!options.depthAvailable)
    return { enabled: false, reason: "Depth sensing is unavailable" };
  if (options.trackingConfidence < 0.7)
    return { enabled: false, reason: "Leg tracking confidence is too low" };
  if (options.clearanceMeters < 1.2)
    return { enabled: false, reason: "Kick clearance is insufficient" };
  if (!options.insideSafeZone)
    return { enabled: false, reason: "Player is outside the safe zone" };
  if (options.restrictedInPath)
    return {
      enabled: false,
      reason: "A restricted object is in the strike path",
    };
  return { enabled: true, reason: "Available" };
}

export function canActivateHeldObject(options: {
  readonly label: RoomLabel;
  readonly confidence: number;
  readonly userConfirmed: boolean;
  readonly handDistanceMeters: number;
  readonly geometryStable: boolean;
}) {
  return (
    options.handDistanceMeters <= 0.18 &&
    options.geometryStable &&
    isInteractionSafe(options.label, options.confidence, options.userConfirmed)
  );
}

export function calculateDamage(options: {
  readonly speed: number;
  readonly type: StrikeType;
  readonly hitRegion: "head" | "torso" | "abdomen" | "limb" | "guard";
  readonly guarded: boolean;
  readonly combo: number;
  readonly difficulty: number;
  readonly safetyMaximum: number;
}) {
  const typeMultiplier =
    options.type === "uppercut" || options.type.includes("kick")
      ? 1.2
      : options.type === "hook"
        ? 1.1
        : 1;
  const regionMultiplier =
    options.hitRegion === "head"
      ? 1.2
      : options.hitRegion === "guard"
        ? 0.2
        : options.hitRegion === "limb"
          ? 0.75
          : 1;
  const guardMultiplier = options.guarded ? 0.25 : 1;
  const damage =
    options.speed *
    4 *
    typeMultiplier *
    regionMultiplier *
    guardMultiplier *
    Math.min(1.5, 1 + options.combo * 0.05) *
    options.difficulty;
  return Math.max(0, Math.min(options.safetyMaximum, damage));
}
