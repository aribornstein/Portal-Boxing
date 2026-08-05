import type { KickDepthEvidence } from "./kickRecognition.js";

export const kickMaskFootprintState = 48;
export const kickMaskValidDepthState = 112;
export const kickMaskNearbyDepthState = 240;

export interface KickDepthMaskConfig {
  readonly maskSize: number;
  readonly targetDiameterMeters: number;
  readonly targetDepthMeters: number;
  readonly minimumSeparationMeters: number;
  readonly maximumSeparationMeters: number;
  readonly approachThresholdMeters: number;
  readonly contactThresholdMeters: number;
  readonly minimumLocalizedSpeedMps: number;
}

export interface KickContactVolume {
  readonly diameterMeters: number;
  readonly depthMeters: number;
  readonly centerOffsetMeters: number;
}

export function kickContactVolume(
  config: KickDepthMaskConfig,
): KickContactVolume {
  const referenceSurfaceOffsetMeters = config.targetDepthMeters * 0.5;
  const backMeters =
    referenceSurfaceOffsetMeters + config.minimumSeparationMeters;
  const frontMeters =
    referenceSurfaceOffsetMeters + config.contactThresholdMeters;
  return {
    diameterMeters: config.targetDiameterMeters,
    depthMeters: frontMeters - backMeters,
    centerOffsetMeters: (frontMeters + backMeters) * 0.5,
  };
}

export class KickDepthMaskReducer {
  private readonly approachCandidates: Uint8Array;
  private readonly contactCandidates: Uint8Array;
  private readonly visited: Uint8Array;
  private readonly queue: Uint16Array;
  private readonly largestComponent: Uint16Array;
  private readonly separations: Float32Array;
  private readonly localX: Float32Array;
  private readonly localY: Float32Array;
  private readonly previousStates: Uint8Array;
  private readonly previousSeparations: Float32Array;
  private previousTimestampUs = 0;

  constructor(private readonly config: KickDepthMaskConfig) {
    const pointCount = config.maskSize * config.maskSize;
    this.approachCandidates = new Uint8Array(pointCount);
    this.contactCandidates = new Uint8Array(pointCount);
    this.visited = new Uint8Array(pointCount);
    this.queue = new Uint16Array(pointCount);
    this.largestComponent = new Uint16Array(pointCount);
    this.separations = new Float32Array(pointCount);
    this.localX = new Float32Array(pointCount);
    this.localY = new Float32Array(pointCount);
    this.previousStates = new Uint8Array(pointCount);
    this.previousSeparations = new Float32Array(pointCount);
  }

  reduce(pixels: Uint8Array, timestampUs: number): KickDepthEvidence {
    const expectedBytes = this.config.maskSize * this.config.maskSize * 4;
    if (pixels.length !== expectedBytes) {
      throw new RangeError(
        `Expected ${expectedBytes} mask bytes, received ${pixels.length}`,
      );
    }

    this.approachCandidates.fill(0);
    this.contactCandidates.fill(0);
    this.separations.fill(Number.POSITIVE_INFINITY);
    let footprintSampleCount = 0;
    let validSampleCount = 0;
    let localizedApproachSampleCount = 0;
    let localizedApproachSpeedSum = 0;
    let localizedRetreatSampleCount = 0;
    let localizedRetreatSpeedSum = 0;
    let minimumSeparationMeters = Number.POSITIVE_INFINITY;
    const elapsedSeconds =
      this.previousTimestampUs > 0
        ? (timestampUs - this.previousTimestampUs) / 1_000_000
        : 0;

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const pixelIndex = offset >> 2;
      const state = pixels[offset] ?? 0;
      if (state < kickMaskFootprintState) {
        this.previousStates[pixelIndex] = state;
        this.previousSeparations[pixelIndex] = 0;
        continue;
      }
      footprintSampleCount += 1;
      if (state < kickMaskValidDepthState) {
        this.previousStates[pixelIndex] = state;
        this.previousSeparations[pixelIndex] = 0;
        continue;
      }
      validSampleCount += 1;
      if (state < kickMaskNearbyDepthState) {
        this.previousStates[pixelIndex] = state;
        this.previousSeparations[pixelIndex] = 0;
        continue;
      }

      const separationMeters = this.decodeSeparation(pixels[offset + 1] ?? 0);
      const localXCode = pixels[offset + 2] ?? 128;
      const localYCode = pixels[offset + 3] ?? 128;
      this.separations[pixelIndex] = separationMeters;
      this.localX[pixelIndex] =
        (localXCode / 255 - 0.5) * this.config.targetDiameterMeters;
      this.localY[pixelIndex] =
        (localYCode / 255 - 0.5) * this.config.targetDiameterMeters;
      minimumSeparationMeters = Math.min(
        minimumSeparationMeters,
        separationMeters,
      );
      if (separationMeters <= this.config.approachThresholdMeters) {
        this.approachCandidates[pixelIndex] = 1;
      }
      if (separationMeters <= this.config.contactThresholdMeters) {
        this.contactCandidates[pixelIndex] = 1;
      }
      if (
        elapsedSeconds > 0 &&
        this.previousStates[pixelIndex] >= kickMaskNearbyDepthState
      ) {
        const speedMps =
          (this.previousSeparations[pixelIndex]! - separationMeters) /
          elapsedSeconds;
        if (speedMps >= this.config.minimumLocalizedSpeedMps) {
          localizedApproachSampleCount += 1;
          localizedApproachSpeedSum += speedMps;
        } else if (speedMps <= -this.config.minimumLocalizedSpeedMps) {
          localizedRetreatSampleCount += 1;
          localizedRetreatSpeedSum -= speedMps;
        }
      }
      this.previousStates[pixelIndex] = state;
      this.previousSeparations[pixelIndex] = separationMeters;
    }
    this.previousTimestampUs = timestampUs;

    const approachSampleCount = this.largestConnectedComponent(
      this.approachCandidates,
    );
    minimumSeparationMeters = Number.POSITIVE_INFINITY;
    for (let index = 0; index < approachSampleCount; index += 1) {
      minimumSeparationMeters = Math.min(
        minimumSeparationMeters,
        this.separations[this.largestComponent[index]!]!,
      );
    }
    const contactSampleCount = this.largestConnectedComponent(
      this.contactCandidates,
    );
    let centroidX = 0;
    let centroidY = 0;
    for (let index = 0; index < contactSampleCount; index += 1) {
      const pixelIndex = this.largestComponent[index]!;
      centroidX += this.localX[pixelIndex]!;
      centroidY += this.localY[pixelIndex]!;
    }
    centroidX /= Math.max(1, contactSampleCount);
    centroidY /= Math.max(1, contactSampleCount);
    let spatialMoment = 0;
    for (let index = 0; index < contactSampleCount; index += 1) {
      const pixelIndex = this.largestComponent[index]!;
      const deltaX = this.localX[pixelIndex]! - centroidX;
      const deltaY = this.localY[pixelIndex]! - centroidY;
      spatialMoment += deltaX * deltaX + deltaY * deltaY;
    }
    spatialMoment /= Math.max(1, contactSampleCount);
    const targetArea =
      Math.PI * Math.pow(this.config.targetDiameterMeters * 0.5, 2);

    return {
      footprintSampleCount,
      validSampleCount,
      approachSampleCount,
      contactSampleCount,
      minimumSeparationMeters,
      validSampleFraction: validSampleCount / Math.max(1, footprintSampleCount),
      localizedApproachSampleCount,
      localizedApproachSpeedMps:
        localizedApproachSpeedSum / Math.max(1, localizedApproachSampleCount),
      localizedRetreatSampleCount,
      localizedRetreatSpeedMps:
        localizedRetreatSpeedSum / Math.max(1, localizedRetreatSampleCount),
      centroidTargetLocal: [centroidX, centroidY, 0],
      spatialMoment,
      coherentArea:
        (contactSampleCount / Math.max(1, footprintSampleCount)) * targetArea,
    };
  }

  reset() {
    this.previousStates.fill(0);
    this.previousSeparations.fill(0);
    this.previousTimestampUs = 0;
  }

  private decodeSeparation(encoded: number) {
    const signed =
      this.config.minimumSeparationMeters +
      (encoded / 255) *
        (this.config.maximumSeparationMeters -
          this.config.minimumSeparationMeters);
    return Math.max(0, signed);
  }

  private largestConnectedComponent(candidates: Uint8Array) {
    this.visited.fill(0);
    let largestSize = 0;
    for (let start = 0; start < candidates.length; start += 1) {
      if (candidates[start] === 0 || this.visited[start] !== 0) continue;
      let readIndex = 0;
      let writeIndex = 1;
      this.queue[0] = start;
      this.visited[start] = 1;
      while (readIndex < writeIndex) {
        const index = this.queue[readIndex++]!;
        const x = index % this.config.maskSize;
        const y = Math.floor(index / this.config.maskSize);
        if (x > 0) writeIndex = this.visit(index - 1, candidates, writeIndex);
        if (x + 1 < this.config.maskSize) {
          writeIndex = this.visit(index + 1, candidates, writeIndex);
        }
        if (y > 0) {
          writeIndex = this.visit(
            index - this.config.maskSize,
            candidates,
            writeIndex,
          );
        }
        if (y + 1 < this.config.maskSize) {
          writeIndex = this.visit(
            index + this.config.maskSize,
            candidates,
            writeIndex,
          );
        }
      }
      if (writeIndex > largestSize) {
        largestSize = writeIndex;
        this.largestComponent.set(this.queue.subarray(0, writeIndex));
      }
    }
    return largestSize;
  }

  private visit(index: number, candidates: Uint8Array, writeIndex: number) {
    if (candidates[index] === 0 || this.visited[index] !== 0) {
      return writeIndex;
    }
    this.visited[index] = 1;
    this.queue[writeIndex] = index;
    return writeIndex + 1;
  }
}
