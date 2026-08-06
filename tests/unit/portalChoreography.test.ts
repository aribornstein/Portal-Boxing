import { describe, expect, it } from "vitest";

import {
  enemyEmergenceDelaySeconds,
  enemyEmergenceProgress,
  enemyEmergenceSeconds,
  portalChargeSeconds,
  portalChoreographyFrame,
  portalCloseSeconds,
  portalHoldSeconds,
  portalOpenSeconds,
} from "../../src/gameplay/portalChoreography.js";

describe("portal choreography", () => {
  it("charges, opens, holds, and fully closes", () => {
    expect(portalChoreographyFrame(0).aperture).toBe(0);
    expect(portalChoreographyFrame(portalChargeSeconds).aperture).toBe(0);
    expect(
      portalChoreographyFrame(portalChargeSeconds + portalOpenSeconds).aperture,
    ).toBe(1);
    expect(
      portalChoreographyFrame(
        portalChargeSeconds + portalOpenSeconds + portalHoldSeconds,
      ).aperture,
    ).toBe(1);
    expect(
      portalChoreographyFrame(
        portalChargeSeconds +
          portalOpenSeconds +
          portalHoldSeconds +
          portalCloseSeconds,
      ).visible,
    ).toBe(false);
  });

  it("finishes the enemy crossing before the portal closes", () => {
    const emergedAt = enemyEmergenceDelaySeconds + enemyEmergenceSeconds;
    expect(enemyEmergenceProgress(enemyEmergenceDelaySeconds)).toBe(0);
    expect(enemyEmergenceProgress(emergedAt)).toBe(1);
    expect(portalChoreographyFrame(emergedAt).aperture).toBe(1);
  });
});
