export function unprojectDepthPointInto(
  normalizedX: number,
  normalizedY: number,
  depthMeters: number,
  inverseProjection: ArrayLike<number>,
  referenceFromSensor: ArrayLike<number>,
  output: Float32Array,
  offset: number,
): boolean {
  const clipX = normalizedX * 2 - 1;
  const clipY = 1 - normalizedY * 2;
  const clipZ = -1;

  const viewX =
    inverseProjection[0] * clipX +
    inverseProjection[4] * clipY +
    inverseProjection[8] * clipZ +
    inverseProjection[12];
  const viewY =
    inverseProjection[1] * clipX +
    inverseProjection[5] * clipY +
    inverseProjection[9] * clipZ +
    inverseProjection[13];
  const viewZ =
    inverseProjection[2] * clipX +
    inverseProjection[6] * clipY +
    inverseProjection[10] * clipZ +
    inverseProjection[14];
  const viewW =
    inverseProjection[3] * clipX +
    inverseProjection[7] * clipY +
    inverseProjection[11] * clipZ +
    inverseProjection[15];

  if (
    !Number.isFinite(depthMeters) ||
    depthMeters <= 0 ||
    !Number.isFinite(viewW) ||
    Math.abs(viewW) < 1e-6
  ) {
    return false;
  }

  const projectedZ = viewZ / viewW;
  if (!Number.isFinite(projectedZ) || projectedZ >= -1e-6) {
    return false;
  }

  const depthScale = -depthMeters / projectedZ;
  const sensorX = (viewX / viewW) * depthScale;
  const sensorY = (viewY / viewW) * depthScale;
  const sensorZ = -depthMeters;

  output[offset] =
    referenceFromSensor[0] * sensorX +
    referenceFromSensor[4] * sensorY +
    referenceFromSensor[8] * sensorZ +
    referenceFromSensor[12];
  output[offset + 1] =
    referenceFromSensor[1] * sensorX +
    referenceFromSensor[5] * sensorY +
    referenceFromSensor[9] * sensorZ +
    referenceFromSensor[13];
  output[offset + 2] =
    referenceFromSensor[2] * sensorX +
    referenceFromSensor[6] * sensorY +
    referenceFromSensor[10] * sensorZ +
    referenceFromSensor[14];
  return (
    Number.isFinite(output[offset]) &&
    Number.isFinite(output[offset + 1]) &&
    Number.isFinite(output[offset + 2])
  );
}
