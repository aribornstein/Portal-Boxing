import { describe, expect, it } from "vitest";

import {
  AdaptiveQualityManager,
  qualitySettings,
} from "../../src/performance/qualityManager.js";

describe("performance policy", () => {
  it("keeps all quality resources within explicit hard caps", () => {
    for (const settings of Object.values(qualitySettings)) {
      expect(settings.depthGrid).toBeLessThanOrEqual(40);
      expect(settings.portalResolution).toBeLessThanOrEqual(768);
      expect(settings.portalParticles).toBeLessThanOrEqual(256);
      expect(settings.destructionFragments).toBeLessThanOrEqual(12);
      expect(settings.activeEnemies).toBeLessThanOrEqual(2);
      expect(settings.inferenceQueue).toBeLessThanOrEqual(3);
    }
  });

  it("does not oscillate during brief timing spikes", () => {
    const manager = new AdaptiveQualityManager("balanced");
    for (let frame = 0; frame < 10; frame += 1) manager.update(22);
    for (let frame = 0; frame < 50; frame += 1) manager.update(11);
    expect(manager.tier).toBe("balanced");
  });
});
