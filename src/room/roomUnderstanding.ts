import {
  safetyPolicyForLabel,
  type RoomLabel,
  type SafetyPolicy,
} from "../semantics/roomTaxonomy.js";

export type Vec3 = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface OrientedBounds {
  readonly center: Vec3;
  readonly halfExtents: Vec3;
  readonly orientation: QuaternionTuple;
}

export type ObservationSource =
  | "scene-label"
  | "plane"
  | "mesh"
  | "anchor"
  | "hit-test"
  | "depth"
  | "camera"
  | "siglip2"
  | "geometry"
  | "user";

export interface RoomObservation {
  readonly id: string;
  readonly pose: {
    readonly position: Vec3;
    readonly orientation: QuaternionTuple;
  };
  readonly bounds: Bounds3;
  readonly orientedBounds: OrientedBounds;
  readonly mesh?: {
    readonly vertices: Float32Array;
    readonly indices?: Uint32Array;
  };
  readonly collisionHull?: { readonly vertices: Float32Array };
  readonly normal: Vec3;
  readonly dimensions: Vec3;
  readonly label: RoomLabel;
  readonly semanticConfidence: number;
  readonly classificationSource: ObservationSource;
  readonly provenance: readonly ObservationSource[];
  readonly lastObservationTime: number;
  readonly trackingConfidence: number;
  readonly destructibility: "none" | "visual-only";
  readonly gameplayRole:
    | "boundary"
    | "obstacle"
    | "portal-surface"
    | "window-view"
    | "furniture-proxy"
    | "restricted";
  readonly safetyPolicy: SafetyPolicy;
  readonly rawObservationIds: readonly string[];
}

export interface SafeZone {
  readonly center: Vec3;
  readonly halfExtents: Vec3;
  readonly kickEnabled: boolean;
  readonly reasons: readonly string[];
}

export function classifySurface(
  normal: Vec3,
  centerY: number,
  roomHeight: number,
): RoomLabel {
  if (normal[1] > 0.85 && centerY < roomHeight * 0.25) return "floor";
  if (normal[1] < -0.85 && centerY > roomHeight * 0.7) return "ceiling";
  if (Math.abs(normal[1]) < 0.25) return "wall";
  return "unknown structural surface";
}

export function mergeDuplicateSurfaces(
  surfaces: readonly RoomObservation[],
  distanceThreshold = 0.12,
  normalDotThreshold = 0.97,
): RoomObservation[] {
  const merged: RoomObservation[] = [];
  for (const surface of surfaces) {
    const duplicateIndex = merged.findIndex(
      (candidate) =>
        candidate.label === surface.label &&
        dot(candidate.normal, surface.normal) >= normalDotThreshold &&
        distance(
          candidate.orientedBounds.center,
          surface.orientedBounds.center,
        ) <= distanceThreshold,
    );
    if (duplicateIndex < 0) {
      merged.push(surface);
      continue;
    }
    const candidate = merged[duplicateIndex];
    const bounds = unionBounds(candidate.bounds, surface.bounds);
    const dimensions: Vec3 = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    merged[duplicateIndex] = {
      ...candidate,
      bounds,
      dimensions,
      semanticConfidence: Math.max(
        candidate.semanticConfidence,
        surface.semanticConfidence,
      ),
      trackingConfidence: Math.max(
        candidate.trackingConfidence,
        surface.trackingConfidence,
      ),
      lastObservationTime: Math.max(
        candidate.lastObservationTime,
        surface.lastObservationTime,
      ),
      provenance: [
        ...new Set([...candidate.provenance, ...surface.provenance]),
      ],
      rawObservationIds: [
        ...candidate.rawObservationIds,
        ...surface.rawObservationIds,
      ],
    };
  }
  return merged;
}

export function smoothBounds(
  previous: Bounds3,
  current: Bounds3,
  alpha = 0.25,
): Bounds3 {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return {
    min: interpolateVec3(previous.min, current.min, clampedAlpha),
    max: interpolateVec3(previous.max, current.max, clampedAlpha),
  };
}

export function calculateSafeZone(
  floor: RoomObservation | undefined,
  obstacles: readonly RoomObservation[],
  reducedReach = 0.25,
): SafeZone {
  if (!floor) {
    return {
      center: [0, 0, 0],
      halfExtents: [0, 0, 0],
      kickEnabled: false,
      reasons: ["Floor is not calibrated"],
    };
  }
  const width = Math.max(0, floor.dimensions[0] - reducedReach * 2);
  const depth = Math.max(0, floor.dimensions[2] - reducedReach * 2);
  const reasons: string[] = [];
  if (width < 1.5 || depth < 1.5)
    reasons.push("Combat clearance is below 1.5 meters");
  if (
    obstacles.some(
      (obstacle) =>
        obstacle.safetyPolicy === "restricted" &&
        obstacle.trackingConfidence > 0.5,
    )
  ) {
    reasons.push("A restricted object is inside the scanned room");
  }
  return {
    center: floor.orientedBounds.center,
    halfExtents: [width / 2, 1.2, depth / 2],
    kickEnabled: reasons.length === 0 && width >= 2 && depth >= 2,
    reasons,
  };
}

export function createObservation(
  id: string,
  label: RoomLabel,
  center: Vec3,
  dimensions: Vec3,
  normal: Vec3,
  source: ObservationSource,
  confidence: number,
): RoomObservation {
  const half: Vec3 = [dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2];
  const bounds: Bounds3 = {
    min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
    max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
  };
  const safetyPolicy = safetyPolicyForLabel(label);
  return {
    id,
    pose: { position: center, orientation: [0, 0, 0, 1] },
    bounds,
    orientedBounds: { center, halfExtents: half, orientation: [0, 0, 0, 1] },
    normal,
    dimensions,
    label,
    semanticConfidence: confidence,
    classificationSource: source,
    provenance: [source],
    lastObservationTime: 0,
    trackingConfidence: confidence,
    destructibility: safetyPolicy === "safe-proxy" ? "visual-only" : "none",
    gameplayRole:
      safetyPolicy === "restricted"
        ? "restricted"
        : label === "wall"
          ? "portal-surface"
          : label === "window" || label === "opening"
            ? "window-view"
            : label === "floor" || label === "ceiling"
              ? "boundary"
              : "furniture-proxy",
    safetyPolicy,
    rawObservationIds: [id],
  };
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function distance(left: Vec3, right: Vec3) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function unionBounds(left: Bounds3, right: Bounds3): Bounds3 {
  return {
    min: [
      Math.min(left.min[0], right.min[0]),
      Math.min(left.min[1], right.min[1]),
      Math.min(left.min[2], right.min[2]),
    ],
    max: [
      Math.max(left.max[0], right.max[0]),
      Math.max(left.max[1], right.max[1]),
      Math.max(left.max[2], right.max[2]),
    ],
  };
}

function interpolateVec3(left: Vec3, right: Vec3, alpha: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * alpha,
    left[1] + (right[1] - left[1]) * alpha,
    left[2] + (right[2] - left[2]) * alpha,
  ];
}
