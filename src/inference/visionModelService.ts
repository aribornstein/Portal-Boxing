import * as ort from "onnxruntime-web/webgpu";

import { validateEmbedding } from "./preprocessing.js";

export type OnnxExecutionProvider = "webgpu" | "wasm";

export interface VisionModelDefinition {
  readonly modelUrl: string;
  readonly inputName: string;
  readonly outputName: string;
  readonly inputDimensions: readonly [1, 3, number, number];
  readonly embeddingDimensions: number;
}

export interface InferenceMetrics {
  readonly provider: OnnxExecutionProvider;
  readonly durationMilliseconds: number;
}

export class VisionModelService {
  private session: ort.InferenceSession | undefined;
  private provider: OnnxExecutionProvider | undefined;

  constructor(readonly definition: VisionModelDefinition) {
    assertLocalUrl(definition.modelUrl);
  }

  get selectedProvider() {
    return this.provider;
  }

  async initialize(preferWebGpu: boolean) {
    const providers: readonly OnnxExecutionProvider[] = preferWebGpu
      ? ["webgpu", "wasm"]
      : ["wasm"];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        this.session = await ort.InferenceSession.create(
          this.definition.modelUrl,
          {
            executionProviders: [provider],
            graphOptimizationLevel: "all",
          },
        );
        this.provider = provider;
        return provider;
      } catch (error) {
        lastError = error;
      }
    }
    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`No ONNX execution provider could initialize${detail}`);
  }

  async encode(
    input: Float32Array,
  ): Promise<{ embedding: Float32Array; metrics: InferenceMetrics }> {
    if (!this.session || !this.provider)
      throw new Error("Vision model is not initialized");
    const expectedSize = this.definition.inputDimensions.reduce(
      (total, value) => total * value,
      1,
    );
    if (input.length !== expectedSize)
      throw new RangeError(`Expected ${expectedSize} image tensor values`);
    const startedAt = performance.now();
    const results = await this.session.run({
      [this.definition.inputName]: new ort.Tensor("float32", input, [
        ...this.definition.inputDimensions,
      ]),
    });
    const output = results[this.definition.outputName];
    const embedding = validateEmbedding(
      output?.data,
      this.definition.embeddingDimensions,
    );
    return {
      embedding,
      metrics: {
        provider: this.provider,
        durationMilliseconds: performance.now() - startedAt,
      },
    };
  }

  async dispose() {
    await this.session?.release();
    this.session = undefined;
    this.provider = undefined;
  }
}

export class ModelCacheService {
  constructor(private readonly cacheName = "portalar-models-v1") {}

  async state(modelUrl: string): Promise<"unsupported" | "missing" | "cached"> {
    assertLocalUrl(modelUrl);
    if (!("caches" in globalThis)) return "unsupported";
    return (await caches.match(modelUrl)) ? "cached" : "missing";
  }

  async cache(modelUrl: string) {
    assertLocalUrl(modelUrl);
    if (!("caches" in globalThis))
      throw new Error("Cache Storage is unavailable");
    const cache = await caches.open(this.cacheName);
    await cache.add(modelUrl);
  }
}

function assertLocalUrl(url: string) {
  const parsed = new URL(
    url,
    globalThis.location?.origin ?? "https://local.invalid",
  );
  const origin = globalThis.location?.origin ?? parsed.origin;
  if (parsed.origin !== origin)
    throw new Error("Model URL must be same-origin");
}
