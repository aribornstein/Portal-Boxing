import type { Bounds3, SafeZone } from "../room/roomUnderstanding.js";

export interface PlanarStep {
  x: number;
  z: number;
}

export function opponentSpacingDirection(
  distance: number,
  approachDistance: number,
) {
  if (!Number.isFinite(distance) || approachDistance < 0) {
    return 0;
  }
  if (distance > approachDistance) return 1;
  return 0;
}

export function resolveObstacleAwareStepInto(
  currentX: number,
  currentZ: number,
  directionX: number,
  directionZ: number,
  distance: number,
  agentRadius: number,
  obstacles: readonly Bounds3[],
  safeZone: SafeZone | undefined,
  output: PlanarStep,
) {
  const directionLength = Math.hypot(directionX, directionZ);
  if (directionLength === 0 || distance <= 0) return false;
  const normalizedX = directionX / directionLength;
  const normalizedZ = directionZ / directionLength;
  if (
    tryStep(
      currentX,
      currentZ,
      normalizedX,
      normalizedZ,
      distance,
      agentRadius,
      obstacles,
      safeZone,
      output,
    )
  ) {
    return true;
  }
  if (
    tryStep(
      currentX,
      currentZ,
      -normalizedZ,
      normalizedX,
      distance,
      agentRadius,
      obstacles,
      safeZone,
      output,
    )
  ) {
    return true;
  }
  return tryStep(
    currentX,
    currentZ,
    normalizedZ,
    -normalizedX,
    distance,
    agentRadius,
    obstacles,
    safeZone,
    output,
  );
}

export function distanceToNearestObstacle(
  x: number,
  z: number,
  obstacles: readonly Bounds3[],
) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const bounds of obstacles) {
    const deltaX = Math.max(bounds.min[0] - x, 0, x - bounds.max[0]);
    const deltaZ = Math.max(bounds.min[2] - z, 0, z - bounds.max[2]);
    nearest = Math.min(nearest, Math.hypot(deltaX, deltaZ));
  }
  return nearest;
}

function tryStep(
  currentX: number,
  currentZ: number,
  directionX: number,
  directionZ: number,
  distance: number,
  agentRadius: number,
  obstacles: readonly Bounds3[],
  safeZone: SafeZone | undefined,
  output: PlanarStep,
) {
  const nextX = currentX + directionX * distance;
  const nextZ = currentZ + directionZ * distance;
  const currentOutsideDistance = distanceOutsideSafeZone(
    currentX,
    currentZ,
    agentRadius,
    safeZone,
  );
  const nextOutsideDistance = distanceOutsideSafeZone(
    nextX,
    nextZ,
    agentRadius,
    safeZone,
  );
  if (
    nextOutsideDistance > 0 &&
    (currentOutsideDistance === 0 ||
      nextOutsideDistance >= currentOutsideDistance)
  ) {
    return false;
  }
  for (const bounds of obstacles) {
    const currentOverlap = distanceInsideExpandedBounds(
      currentX,
      currentZ,
      agentRadius,
      bounds,
    );
    const nextOverlap = distanceInsideExpandedBounds(
      nextX,
      nextZ,
      agentRadius,
      bounds,
    );
    if (
      nextOverlap > 0 &&
      (currentOverlap === 0 || nextOverlap >= currentOverlap)
    ) {
      return false;
    }
  }
  output.x = nextX;
  output.z = nextZ;
  return true;
}

function distanceOutsideSafeZone(
  x: number,
  z: number,
  agentRadius: number,
  safeZone: SafeZone | undefined,
) {
  if (!safeZone) return Number.POSITIVE_INFINITY;
  const deltaX = Math.max(
    Math.abs(x - safeZone.center[0]) -
      Math.max(0, safeZone.halfExtents[0] - agentRadius),
    0,
  );
  const deltaZ = Math.max(
    Math.abs(z - safeZone.center[2]) -
      Math.max(0, safeZone.halfExtents[2] - agentRadius),
    0,
  );
  return Math.hypot(deltaX, deltaZ);
}

function distanceInsideExpandedBounds(
  x: number,
  z: number,
  agentRadius: number,
  bounds: Bounds3,
) {
  const minX = bounds.min[0] - agentRadius;
  const maxX = bounds.max[0] + agentRadius;
  const minZ = bounds.min[2] - agentRadius;
  const maxZ = bounds.max[2] + agentRadius;
  if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) return 0;
  return Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
}
