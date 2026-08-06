export const portalChargeSeconds = 0.25;
export const portalOpenSeconds = 0.7;
export const enemyEmergenceDelaySeconds = 0.55;
export const enemyEmergenceSeconds = 1.35;
export const portalHoldSeconds = 1.1;
export const portalCloseSeconds = 0.65;

export interface PortalChoreographyFrame {
  readonly aperture: number;
  readonly energy: number;
  readonly visible: boolean;
}

export function portalChoreographyFrame(
  elapsedSeconds: number,
): PortalChoreographyFrame {
  const elapsed = Math.max(0, elapsedSeconds);
  const openedAt = portalChargeSeconds + portalOpenSeconds;
  const closesAt = openedAt + portalHoldSeconds;
  const finishedAt = closesAt + portalCloseSeconds;
  let aperture = 0;
  if (elapsed >= portalChargeSeconds && elapsed < openedAt) {
    aperture = smoothstep((elapsed - portalChargeSeconds) / portalOpenSeconds);
  } else if (elapsed < closesAt && elapsed >= openedAt) {
    aperture = 1;
  } else if (elapsed < finishedAt && elapsed >= closesAt) {
    aperture = 1 - smoothstep((elapsed - closesAt) / portalCloseSeconds);
  }
  return {
    aperture,
    energy:
      elapsed < portalChargeSeconds
        ? smoothstep(elapsed / portalChargeSeconds)
        : aperture,
    visible: elapsed < finishedAt,
  };
}

export function enemyEmergenceProgress(elapsedSeconds: number) {
  return smoothstep(
    (elapsedSeconds - enemyEmergenceDelaySeconds) / enemyEmergenceSeconds,
  );
}

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}
