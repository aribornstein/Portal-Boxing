export function targetSurfaceMotionMps(
  translationDistanceMeters: number,
  angularDistanceRadians: number,
  surfaceRadiusMeters: number,
  elapsedSeconds: number,
) {
  if (elapsedSeconds <= 0) return 0;
  const translation = Math.max(0, translationDistanceMeters);
  const rotation =
    Math.max(0, angularDistanceRadians) * Math.max(0, surfaceRadiusMeters);
  return (translation + rotation) / elapsedSeconds;
}
