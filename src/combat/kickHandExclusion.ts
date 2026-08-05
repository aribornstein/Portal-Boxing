import type { KickDepthContactEvent } from "./kickContactDetector.js";
import type { KickTrackedPose } from "./kickRecognition.js";

export interface KickHandExclusionResult {
  readonly leftDistanceMeters: number;
  readonly rightDistanceMeters: number;
  readonly trackingFreshnessUs: number;
  readonly handExplainsContact: boolean;
  readonly explainingHand: "left" | "right" | null;
  readonly trackedHandCount: number;
}

const sweepRadiusMeters = 0.12;
const directExclusionRadiusMeters = 0.42;
const maximumFreshnessUs = 150_000;
const minimumTrackingQuality = 0.55;
const minimumApproachMps = 0.25;
const minimumDirectionAgreement = 0.25;

export function evaluateKickHandExclusion(
  event: KickDepthContactEvent,
  histories: Readonly<
    Partial<Record<"left" | "right", readonly KickTrackedPose[]>>
  >,
): KickHandExclusionResult {
  const evaluations = (["left", "right"] as const).map((handedness) => {
    const poses = (histories[handedness] ?? []).filter(
      (pose) =>
        pose.timestampUs <= event.endTimestampUs &&
        pose.timestampUs >= event.startTimestampUs - maximumFreshnessUs,
    );
    const latest = poses[poses.length - 1];
    const freshPoses = poses.filter(
      (pose) =>
        Math.abs(event.contactTimestampUs - pose.timestampUs) <=
          maximumFreshnessUs && pose.trackingQuality >= minimumTrackingQuality,
    );
    const fresh = freshPoses.length > 0;
    let minimumDistance = freshPoses.reduce(
      (closest, pose) =>
        Math.min(
          closest,
          distance(pose.position, event.contactPositionTargetLocal),
        ),
      Number.POSITIVE_INFINITY,
    );
    let plausible = fresh && minimumDistance <= directExclusionRadiusMeters;
    for (let index = 1; index < poses.length; index += 1) {
      const previous = poses[index - 1];
      const current = poses[index];
      if (!previous || !current) continue;
      minimumDistance = Math.min(
        minimumDistance,
        pointSegmentDistance(
          event.contactPositionTargetLocal,
          previous.position,
          current.position,
        ),
      );
      const elapsedSeconds =
        (current.timestampUs - previous.timestampUs) / 1_000_000;
      const velocity =
        elapsedSeconds > 0
          ? scale(
              subtract(current.position, previous.position),
              1 / elapsedSeconds,
            )
          : ([0, 0, 0] as const);
      const towardContact = normalize(
        subtract(event.contactPositionTargetLocal, previous.position),
      );
      const speedTowardContact = dot(velocity, towardContact);
      const directionAgreement = dot(
        normalize(velocity),
        normalize(event.approachDirectionTargetLocal),
      );
      if (
        minimumDistance <= sweepRadiusMeters &&
        Math.min(previous.trackingQuality, current.trackingQuality) >=
          minimumTrackingQuality &&
        speedTowardContact >= minimumApproachMps &&
        Math.abs(directionAgreement) >= minimumDirectionAgreement
      ) {
        plausible = true;
      }
    }
    return {
      handedness,
      minimumDistance,
      freshnessUs: latest
        ? event.contactTimestampUs - latest.timestampUs
        : Number.POSITIVE_INFINITY,
      fresh,
      plausible: plausible && fresh,
    };
  });
  const explaining = evaluations.find((evaluation) => evaluation.plausible);
  return {
    leftDistanceMeters:
      evaluations[0]?.minimumDistance ?? Number.POSITIVE_INFINITY,
    rightDistanceMeters:
      evaluations[1]?.minimumDistance ?? Number.POSITIVE_INFINITY,
    trackingFreshnessUs: Math.min(
      ...evaluations.map((evaluation) => evaluation.freshnessUs),
    ),
    handExplainsContact: Boolean(explaining),
    explainingHand: explaining?.handedness ?? null,
    trackedHandCount: evaluations.filter((evaluation) => evaluation.fresh)
      .length,
  };
}

export function appendKickTrackedPose(
  history: readonly KickTrackedPose[],
  pose: KickTrackedPose,
  windowUs = 300_000,
) {
  return [...history, pose].filter(
    (candidate) => candidate.timestampUs >= pose.timestampUs - windowUs,
  );
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(
  value: readonly [number, number, number],
  scalar: number,
): readonly [number, number, number] {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function normalize(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  const magnitude = Math.hypot(value[0], value[1], value[2]);
  return magnitude > 0
    ? [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude]
    : [0, 0, 0];
}

function distance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function pointSegmentDistance(
  point: readonly [number, number, number],
  start: readonly [number, number, number],
  end: readonly [number, number, number],
) {
  const segment = subtract(end, start);
  const pointOffset = subtract(point, start);
  const lengthSquared = dot(segment, segment);
  const projection =
    lengthSquared > 0 ? clamp01(dot(pointOffset, segment) / lengthSquared) : 0;
  return distance(point, [
    start[0] + segment[0] * projection,
    start[1] + segment[1] * projection,
    start[2] + segment[2] * projection,
  ]);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
