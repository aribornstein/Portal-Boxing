export interface ImagePreprocessingConfig {
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly mean: readonly [number, number, number];
  readonly standardDeviation: readonly [number, number, number];
}

export function preprocessRgbaToNchw(
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  config: ImagePreprocessingConfig,
  output = new Float32Array(config.inputWidth * config.inputHeight * 3),
) {
  if (rgba.length !== sourceWidth * sourceHeight * 4) {
    throw new RangeError("RGBA input length does not match source dimensions");
  }
  const planeSize = config.inputWidth * config.inputHeight;
  if (output.length !== planeSize * 3) {
    throw new RangeError("Preprocessing output has an invalid length");
  }
  for (let targetY = 0; targetY < config.inputHeight; targetY += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((targetY + 0.5) * sourceHeight) / config.inputHeight),
    );
    for (let targetX = 0; targetX < config.inputWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((targetX + 0.5) * sourceWidth) / config.inputWidth),
      );
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = targetY * config.inputWidth + targetX;
      for (let channel = 0; channel < 3; channel += 1) {
        const normalized = rgba[sourceOffset + channel] / 255;
        output[channel * planeSize + targetOffset] =
          (normalized - config.mean[channel]) /
          config.standardDeviation[channel];
      }
    }
  }
  return output;
}

export function validateEmbedding(
  value: unknown,
  expectedDimensions: number,
): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== expectedDimensions) {
    throw new TypeError(
      `Expected a Float32 embedding with ${expectedDimensions} dimensions`,
    );
  }
  if (value.some((item) => !Number.isFinite(item))) {
    throw new TypeError("Embedding contains a non-finite value");
  }
  return value;
}
