export type DepthQuality = "low" | "balanced" | "high" | "debug-maximum";
export type DepthRepresentation =
  "cpu" | "gpu" | "synthetic" | "recorded" | "none";

export interface DepthCalibration {
  readonly floorY: number;
  readonly normDepthBufferFromNormView: Float32Array;
}

export interface DepthSampleFrame {
  readonly positions: Float32Array;
  readonly sampleCount: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly capturedAt: number;
  readonly ageMilliseconds: number;
  readonly representation: DepthRepresentation;
  readonly calibration: DepthCalibration;
}

export interface DepthAvailability {
  readonly available: boolean;
  readonly representation: DepthRepresentation;
  readonly reason?: string;
}

export interface DepthProvider {
  readonly availability: DepthAvailability;
  readonly quality: DepthQuality;
  setQuality(quality: DepthQuality): void;
  updateFrameTime(frameMilliseconds: number): void;
  sample(now: number): DepthSampleFrame | null;
  dispose(): void;
}

export interface DepthProviderConfig {
  readonly quality?: DepthQuality;
  readonly minimumDepthMeters?: number;
  readonly maximumDepthMeters?: number;
  readonly floorNoiseMeters?: number;
  readonly samplesPerSecond?: number;
}

export interface PhysicalDepthSource {
  readonly cpuDepth: XRCPUDepthInformation | undefined;
  readonly gpuDepthAvailable: boolean;
  readonly capturedAt: number;
  readonly floorY: number;
  unproject(
    normalizedX: number,
    normalizedY: number,
    depthMeters: number,
    output: Float32Array,
    offset: number,
  ): void;
}

const qualityGrid: Record<DepthQuality, number> = {
  low: 12,
  balanced: 24,
  high: 40,
  "debug-maximum": 64,
};

const identityCalibration = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

abstract class BaseDepthProvider implements DepthProvider {
  protected lastSampleTime = Number.NEGATIVE_INFINITY;
  protected readonly minimumDepthMeters: number;
  protected readonly maximumDepthMeters: number;
  protected readonly floorNoiseMeters: number;
  protected readonly minimumSampleInterval: number;
  protected output = new Float32Array(qualityGrid.balanced ** 2 * 3);
  quality: DepthQuality;

  abstract readonly availability: DepthAvailability;

  constructor(config: DepthProviderConfig = {}) {
    this.quality = config.quality ?? "balanced";
    this.minimumDepthMeters = config.minimumDepthMeters ?? 0.15;
    this.maximumDepthMeters = config.maximumDepthMeters ?? 5;
    this.floorNoiseMeters = config.floorNoiseMeters ?? 0.06;
    this.minimumSampleInterval = 1000 / (config.samplesPerSecond ?? 15);
    this.resizeOutput();
  }

  setQuality(quality: DepthQuality): void {
    if (this.quality === quality) {
      return;
    }
    this.quality = quality;
    this.resizeOutput();
  }

  updateFrameTime(frameMilliseconds: number): void {
    if (frameMilliseconds > 18 && this.quality !== "low") {
      this.setQuality(
        this.quality === "debug-maximum"
          ? "high"
          : this.quality === "high"
            ? "balanced"
            : "low",
      );
    }
  }

  abstract sample(now: number): DepthSampleFrame | null;

  dispose(): void {
    this.output = new Float32Array(0);
  }

  protected canSample(now: number) {
    return now - this.lastSampleTime >= this.minimumSampleInterval;
  }

  private resizeOutput() {
    const gridSize = qualityGrid[this.quality];
    this.output = new Float32Array(gridSize * gridSize * 3);
  }
}

export class PhysicalWebXRDepthProvider extends BaseDepthProvider {
  readonly availability: DepthAvailability;

  constructor(
    private readonly getSource: () => PhysicalDepthSource | null,
    config: DepthProviderConfig = {},
  ) {
    super(config);
    const source = getSource();
    this.availability = source?.cpuDepth
      ? { available: true, representation: "cpu" }
      : source?.gpuDepthAvailable
        ? {
            available: true,
            representation: "gpu",
            reason: "GPU depth supports occlusion but not CPU collision probes",
          }
        : {
            available: false,
            representation: "none",
            reason: "WebXR depth data is unavailable",
          };
  }

  sample(now: number): DepthSampleFrame | null {
    if (!this.canSample(now)) {
      return null;
    }
    const source = this.getSource();
    const depth = source?.cpuDepth;
    if (!source || !depth) {
      return null;
    }

    this.lastSampleTime = now;
    const gridSize = qualityGrid[this.quality];
    let sampleCount = 0;
    for (let row = 0; row < gridSize; row += 1) {
      const normalizedY = gridSize === 1 ? 0.5 : row / (gridSize - 1);
      for (let column = 0; column < gridSize; column += 1) {
        const normalizedX = gridSize === 1 ? 0.5 : column / (gridSize - 1);
        const depthMeters = depth.getDepthInMeters(normalizedX, normalizedY);
        if (
          !Number.isFinite(depthMeters) ||
          depthMeters < this.minimumDepthMeters ||
          depthMeters > this.maximumDepthMeters
        ) {
          continue;
        }

        const offset = sampleCount * 3;
        source.unproject(
          normalizedX,
          normalizedY,
          depthMeters,
          this.output,
          offset,
        );
        if (
          !Number.isFinite(this.output[offset]) ||
          !Number.isFinite(this.output[offset + 1]) ||
          !Number.isFinite(this.output[offset + 2]) ||
          this.output[offset + 1] <= source.floorY + this.floorNoiseMeters
        ) {
          continue;
        }
        sampleCount += 1;
      }
    }

    return {
      positions: this.output,
      sampleCount,
      sourceWidth: depth.width,
      sourceHeight: depth.height,
      capturedAt: source.capturedAt,
      ageMilliseconds: Math.max(0, now - source.capturedAt),
      representation: "cpu",
      calibration: {
        floorY: source.floorY,
        normDepthBufferFromNormView: new Float32Array(
          depth.normDepthBufferFromNormView.matrix,
        ),
      },
    };
  }
}

export interface StoredDepthFrame {
  readonly positions: Float32Array;
  readonly sampleCount: number;
  readonly capturedAt: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly floorY?: number;
}

export class SyntheticDepthProvider extends BaseDepthProvider {
  readonly availability = {
    available: true,
    representation: "synthetic",
  } as const;
  private frame: StoredDepthFrame;

  constructor(frame: StoredDepthFrame, config: DepthProviderConfig = {}) {
    super(config);
    this.frame = frame;
  }

  setFrame(frame: StoredDepthFrame) {
    this.frame = frame;
  }

  sample(now: number): DepthSampleFrame | null {
    if (!this.canSample(now)) {
      return null;
    }
    this.lastSampleTime = now;
    const count = Math.min(this.frame.sampleCount, this.output.length / 3);
    this.output.set(this.frame.positions.subarray(0, count * 3), 0);
    return storedFrameToSample(
      this.output,
      count,
      this.frame,
      now,
      "synthetic",
    );
  }
}

export class RecordedDepthProvider extends BaseDepthProvider {
  readonly availability = {
    available: true,
    representation: "recorded",
  } as const;
  private frameIndex = 0;

  constructor(
    private readonly frames: readonly StoredDepthFrame[],
    config: DepthProviderConfig = {},
  ) {
    super(config);
  }

  sample(now: number): DepthSampleFrame | null {
    if (!this.canSample(now) || this.frames.length === 0) {
      return null;
    }
    this.lastSampleTime = now;
    const frame = this.frames[this.frameIndex % this.frames.length];
    this.frameIndex += 1;
    const count = Math.min(frame.sampleCount, this.output.length / 3);
    this.output.set(frame.positions.subarray(0, count * 3), 0);
    return storedFrameToSample(this.output, count, frame, now, "recorded");
  }

  reset() {
    this.frameIndex = 0;
  }
}

export class NullDepthProvider extends BaseDepthProvider {
  readonly availability = {
    available: false,
    representation: "none",
    reason: "Depth sensing is not supported or permission was denied",
  } as const;

  sample(): null {
    return null;
  }
}

function storedFrameToSample(
  positions: Float32Array,
  sampleCount: number,
  frame: StoredDepthFrame,
  now: number,
  representation: "synthetic" | "recorded",
): DepthSampleFrame {
  return {
    positions,
    sampleCount,
    sourceWidth: frame.sourceWidth ?? 0,
    sourceHeight: frame.sourceHeight ?? 0,
    capturedAt: frame.capturedAt,
    ageMilliseconds: Math.max(0, now - frame.capturedAt),
    representation,
    calibration: {
      floorY: frame.floorY ?? 0,
      normDepthBufferFromNormView: identityCalibration,
    },
  };
}
