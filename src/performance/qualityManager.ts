export type QualityTier = "low" | "balanced" | "high";

export interface QualitySettings {
  readonly depthGrid: number;
  readonly portalResolution: number;
  readonly portalParticles: number;
  readonly destructionFragments: number;
  readonly activeEnemies: number;
  readonly inferenceQueue: number;
}

export const qualitySettings: Record<QualityTier, QualitySettings> = {
  low: {
    depthGrid: 12,
    portalResolution: 256,
    portalParticles: 48,
    destructionFragments: 4,
    activeEnemies: 1,
    inferenceQueue: 1,
  },
  balanced: {
    depthGrid: 24,
    portalResolution: 512,
    portalParticles: 128,
    destructionFragments: 8,
    activeEnemies: 2,
    inferenceQueue: 2,
  },
  high: {
    depthGrid: 40,
    portalResolution: 768,
    portalParticles: 256,
    destructionFragments: 12,
    activeEnemies: 2,
    inferenceQueue: 3,
  },
};

export class AdaptiveQualityManager {
  private pressureFrames = 0;
  private recoveryFrames = 0;

  constructor(public tier: QualityTier = "balanced") {}

  update(frameMilliseconds: number) {
    if (frameMilliseconds > 16) {
      this.pressureFrames += 1;
      this.recoveryFrames = 0;
    } else if (frameMilliseconds < 12) {
      this.recoveryFrames += 1;
      this.pressureFrames = Math.max(0, this.pressureFrames - 1);
    }
    if (this.pressureFrames >= 30) {
      this.tier = this.tier === "high" ? "balanced" : "low";
      this.pressureFrames = 0;
    } else if (this.recoveryFrames >= 300) {
      this.tier = this.tier === "low" ? "balanced" : "high";
      this.recoveryFrames = 0;
    }
    return qualitySettings[this.tier];
  }
}
