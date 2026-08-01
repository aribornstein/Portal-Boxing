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

export interface PhysicalDepthContact {
  readonly region: HitRegion;
  readonly nearestHandDistance: number;
  readonly associatedHandSpeed: number;
  readonly handMotionAlignment: number;
  readonly separationMeters: number;
  readonly contactCoverage: number;
  readonly localizedApproachSpeed?: number;
  readonly localizedRetreatSpeed?: number;
  readonly targetMotionSpeed?: number;
  readonly heldObjectActive?: boolean;
  readonly timestamp: number;
}

export type PhysicalDepthContactKind =
  "unclassified-depth-contact" | "held-object";

export interface PhysicalDepthContactObservation {
  readonly kind: PhysicalDepthContactKind;
  readonly speed: number;
  readonly confidence: number;
}

interface ContactHistory {
  separationMeters: number;
  timestamp: number;
  active: boolean;
  lastImpactTime: number;
}

const contactSignalCeilingMeters = 0.32;
const minimumContactCoverage = 0.0005;
const directHandExclusionMeters = 0.42;
const directContactMeters = 0.09;
const releaseContactMeters = 0.16;
const projectedContactLimitMeters = 0.18;
const projectedContactWindowSeconds = 0.12;
const anonymousContactCooldownSeconds = 0.45;

export class PhysicalContactTracker {
  private readonly history = new Map<HitRegion, ContactHistory>();
  private lastAnonymousContactTime = Number.NEGATIVE_INFINITY;

  update(contact: PhysicalDepthContact) {
    const previous = this.history.get(contact.region);
    const deltaSeconds = previous ? contact.timestamp - previous.timestamp : 0;
    const hasSignal =
      Number.isFinite(contact.separationMeters) &&
      contact.contactCoverage >= minimumContactCoverage;
    const previousSeparation =
      previous && Number.isFinite(previous.separationMeters)
        ? previous.separationMeters
        : contactSignalCeilingMeters;
    const targetMotionSpeed = Math.max(0, contact.targetMotionSpeed ?? 0);
    const regionalApproachSpeed =
      previous && hasSignal && deltaSeconds > 0
        ? Math.max(
            0,
            (previousSeparation - contact.separationMeters) / deltaSeconds -
              targetMotionSpeed,
          )
        : 0;
    const localizedApproachSpeed = Math.max(
      0,
      (contact.localizedApproachSpeed ?? 0) - targetMotionSpeed,
    );
    const approachSpeed = Math.max(
      regionalApproachSpeed,
      localizedApproachSpeed,
    );
    const localizedRetreatSpeed = Math.max(
      0,
      (contact.localizedRetreatSpeed ?? 0) - targetMotionSpeed,
    );
    const retracting =
      localizedRetreatSpeed >= 0.7 && localizedRetreatSpeed > approachSpeed;
    const directTouching =
      hasSignal && contact.separationMeters <= directContactMeters;
    const projectedDepthContact =
      hasSignal &&
      contact.separationMeters > directContactMeters &&
      contact.separationMeters <= projectedContactLimitMeters &&
      approachSpeed >= 1 &&
      contact.separationMeters / approachSpeed <= projectedContactWindowSeconds;
    const touching = directTouching || projectedDepthContact;
    const released =
      !hasSignal || contact.separationMeters >= releaseContactMeters;
    const history: ContactHistory = previous ?? {
      separationMeters: contact.separationMeters,
      timestamp: contact.timestamp,
      active: false,
      lastImpactTime: Number.NEGATIVE_INFINITY,
    };

    history.separationMeters = contact.separationMeters;
    history.timestamp = contact.timestamp;
    if (released || retracting) history.active = false;

    let observation: PhysicalDepthContactObservation | undefined;
    if (
      touching &&
      !history.active &&
      !retracting &&
      contact.timestamp - history.lastImpactTime >= 0.3
    ) {
      const classified = classifyPhysicalDepthContact({
        heldObjectActive: contact.heldObjectActive ?? false,
        localizedMotionDetected: localizedApproachSpeed >= 1,
        nearestHandDistance: contact.nearestHandDistance,
        associatedHandSpeed: contact.associatedHandSpeed,
        handMotionAlignment: contact.handMotionAlignment,
        approachSpeed,
        contactCoverage: contact.contactCoverage,
      });
      const projectionMatchesObservation =
        directTouching || classified?.kind === "unclassified-depth-contact";
      if (classified && projectionMatchesObservation) {
        history.active = true;
        if (
          classified.kind !== "unclassified-depth-contact" ||
          contact.timestamp - this.lastAnonymousContactTime >=
            anonymousContactCooldownSeconds
        ) {
          observation = classified;
          history.lastImpactTime = contact.timestamp;
          if (classified.kind === "unclassified-depth-contact") {
            this.lastAnonymousContactTime = contact.timestamp;
          }
        }
      }
    }
    this.history.set(contact.region, history);
    return observation;
  }

  reset() {
    this.history.clear();
    this.lastAnonymousContactTime = Number.NEGATIVE_INFINITY;
  }
}

export function classifyPhysicalDepthContact(options: {
  readonly heldObjectActive?: boolean;
  readonly localizedMotionDetected?: boolean;
  readonly nearestHandDistance: number;
  readonly associatedHandSpeed: number;
  readonly handMotionAlignment: number;
  readonly approachSpeed: number;
  readonly contactCoverage: number;
}): PhysicalDepthContactObservation | undefined {
  if (options.contactCoverage < minimumContactCoverage) {
    return undefined;
  }

  if (options.nearestHandDistance <= directHandExclusionMeters) {
    return undefined;
  }

  if (
    options.heldObjectActive === true &&
    options.nearestHandDistance <= 1.25 &&
    options.associatedHandSpeed >= 0.55 &&
    options.handMotionAlignment >= 0.4
  ) {
    const speed = Math.max(
      Number.isFinite(options.approachSpeed) ? options.approachSpeed : 0,
      options.associatedHandSpeed,
    );
    return {
      kind: "held-object",
      speed,
      confidence: clamp01(0.58 + options.contactCoverage * 1.6 + speed * 0.04),
    };
  }

  if (
    options.localizedMotionDetected === true &&
    Number.isFinite(options.approachSpeed) &&
    options.approachSpeed >= 1
  ) {
    return {
      kind: "unclassified-depth-contact",
      speed: options.approachSpeed,
      confidence: clamp01(
        0.62 + options.contactCoverage * 1.4 + options.approachSpeed * 0.035,
      ),
    };
  }

  return undefined;
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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
