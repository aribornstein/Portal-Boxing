export function isDepthSegmentClear(
  positions: Float32Array,
  sampleCount: number,
  start: ArrayLike<number>,
  end: ArrayLike<number>,
  clearanceRadius: number,
  startExclusionDistance: number,
): boolean {
  const segmentX = end[0] - start[0];
  const segmentY = end[1] - start[1];
  const segmentZ = end[2] - start[2];
  const segmentLengthSquared =
    segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  if (segmentLengthSquared <= 1e-8) return true;

  const segmentLength = Math.sqrt(segmentLengthSquared);
  const minimumProgress = Math.min(1, startExclusionDistance / segmentLength);
  const radiusSquared = clearanceRadius * clearanceRadius;
  const boundedCount = Math.min(sampleCount, Math.floor(positions.length / 3));

  for (let index = 0; index < boundedCount; index += 1) {
    const offset = index * 3;
    const pointX = positions[offset] - start[0];
    const pointY = positions[offset + 1] - start[1];
    const pointZ = positions[offset + 2] - start[2];
    const progress =
      (pointX * segmentX + pointY * segmentY + pointZ * segmentZ) /
      segmentLengthSquared;
    if (progress <= minimumProgress || progress > 1) continue;

    const distanceX = pointX - segmentX * progress;
    const distanceY = pointY - segmentY * progress;
    const distanceZ = pointZ - segmentZ * progress;
    if (
      distanceX * distanceX + distanceY * distanceY + distanceZ * distanceZ <=
      radiusSquared
    ) {
      return false;
    }
  }
  return true;
}
