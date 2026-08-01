import type { RoomObservation, Vec3 } from "../room/roomUnderstanding.js";

export interface PortalCandidate {
  readonly surfaceId: string;
  readonly center: Vec3;
  readonly facing: Vec3;
  readonly width: number;
  readonly height: number;
  readonly score: number;
}

export interface PortalValidation {
  readonly candidate?: PortalCandidate;
  readonly reasons: readonly string[];
}

export function validatePortalSurface(
  surface: RoomObservation,
  playerPosition: Vec3,
  obstacles: readonly RoomObservation[],
  existing: readonly PortalCandidate[],
  minimumSeparation = 1.25,
): PortalValidation {
  const reasons: string[] = [];
  if (surface.label !== "wall") reasons.push("Surface is not a wall");
  if (Math.abs(surface.normal[1]) > 0.25)
    reasons.push("Surface normal is not vertical");
  if (surface.dimensions[0] < 1.1 || surface.dimensions[1] < 1.8)
    reasons.push("Surface is too small");
  if (surface.safetyPolicy === "restricted")
    reasons.push("Surface is restricted");
  const center = surface.orientedBounds.center;
  const playerDistance = distance(center, playerPosition);
  if (playerDistance < 1.2) reasons.push("Portal is too close to the player");
  if (
    obstacles.some(
      (obstacle) =>
        obstacle.safetyPolicy === "restricted" &&
        distance(center, obstacle.orientedBounds.center) < 1.25,
    )
  ) {
    reasons.push("Restricted object overlaps emergence clearance");
  }
  if (
    existing.some(
      (portal) => distance(center, portal.center) < minimumSeparation,
    )
  )
    reasons.push("Portal overlaps an existing portal");
  if (reasons.length > 0) return { reasons };
  const facing = normalize([
    playerPosition[0] - center[0],
    0,
    playerPosition[2] - center[2],
  ]);
  return {
    reasons,
    candidate: {
      surfaceId: surface.id,
      center,
      facing,
      width: Math.min(1.4, surface.dimensions[0] - 0.2),
      height: Math.min(2.2, surface.dimensions[1] - 0.1),
      score: Math.min(
        1,
        surface.semanticConfidence * 0.6 +
          Math.min(playerDistance / 3, 1) * 0.4,
      ),
    },
  };
}

function distance(left: Vec3, right: Vec3) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  return length > 0
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : [0, 0, 1];
}
