import {
  Color,
  CylinderGeometry,
  GLSL3,
  Matrix4,
  Mesh,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from "@iwsdk/core";
import type {
  Object3D,
  PerspectiveCamera,
  Texture,
  WebGLRenderer,
} from "@iwsdk/core";

import {
  KickDepthMaskReducer,
  kickMaskFootprintState,
  kickMaskValidDepthState,
  type KickDepthMaskConfig,
} from "./kickDepthMask.js";
import type { KickDepthEvidence } from "./kickRecognition.js";
import { targetSurfaceMotionMps } from "./kickTargetMotion.js";

export const kickTargetDepthSampleRateHz = 24;

export const defaultKickTargetDepthMaskConfig: KickDepthMaskConfig = {
  maskSize: 64,
  targetDiameterMeters: 0.3,
  targetDepthMeters: 0.06,
  minimumSeparationMeters: -0.12,
  maximumSeparationMeters: 0.32,
  approachThresholdMeters: 0.13,
  contactThresholdMeters: 0.025,
  minimumLocalizedSpeedMps: 0.35,
};

export interface KickTargetDepthMaskInput {
  readonly depthTexture: Texture;
  readonly depthData: XRWebGLDepthInformation;
  readonly camera: PerspectiveCamera;
  readonly target: Object3D;
  readonly timestampUs: number;
}

export interface KickTargetDepthMaskMetrics {
  readonly bytesReadBack: number;
  readonly readbackTimeUs: number;
  readonly skippedReadbacks: number;
  readonly failedReadbacks: number;
  readonly processingTimeUs: number;
}

export interface KickTargetDepthMaskResult {
  readonly evidence: KickDepthEvidence;
  readonly targetMotionMps: number;
  readonly metrics: KickTargetDepthMaskMetrics;
}

const sampleIntervalUs = 1_000_000 / kickTargetDepthSampleRateHz;

export class KickTargetDepthMask {
  private readonly scene = new Scene();
  private readonly renderTarget: WebGLRenderTarget;
  private readonly pixels: Uint8Array;
  private readonly material: ShaderMaterial;
  private readonly volume: Mesh;
  private readonly reducer: KickDepthMaskReducer;
  private readonly clearColor = new Color();
  private readonly previousTargetPosition = new Vector3();
  private readonly currentTargetPosition = new Vector3();
  private readonly previousTargetQuaternion = new Quaternion();
  private readonly currentTargetQuaternion = new Quaternion();
  private readonly currentTargetScale = new Vector3();
  private previousTargetTimestampUs = 0;
  private nextSampleTimestampUs = 0;
  private skippedReadbacks = 0;
  private failedReadbacks = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly config = defaultKickTargetDepthMaskConfig,
  ) {
    this.renderTarget = new WebGLRenderTarget(
      config.maskSize,
      config.maskSize,
      {
        format: RGBAFormat,
        type: UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );
    this.pixels = new Uint8Array(config.maskSize * config.maskSize * 4);
    this.reducer = new KickDepthMaskReducer(config);
    this.material = createKickTargetMaskMaterial(config);
    const geometry = new CylinderGeometry(
      config.targetDiameterMeters * 0.5,
      config.targetDiameterMeters * 0.5,
      config.targetDepthMeters,
      48,
      1,
      false,
    );
    geometry.rotateX(Math.PI / 2);
    this.volume = new Mesh(geometry, this.material);
    this.volume.matrixAutoUpdate = false;
    this.volume.frustumCulled = false;
    this.scene.add(this.volume);
  }

  process(input: KickTargetDepthMaskInput): KickTargetDepthMaskResult | null {
    if (input.timestampUs < this.nextSampleTimestampUs) {
      this.skippedReadbacks += 1;
      return null;
    }
    this.nextSampleTimestampUs = input.timestampUs + sampleIntervalUs;
    const started = performance.now();
    const targetMotionMps = this.updateTargetMotion(
      input.target,
      input.timestampUs,
    );
    input.target.updateWorldMatrix(true, false);
    this.volume.matrix.copy(input.target.matrixWorld);
    this.material.uniforms.uDepthTexture.value = input.depthTexture;
    this.material.uniforms.uRawValueToMeters.value =
      input.depthData.rawValueToMeters;
    this.material.uniforms.uDepthNear.value = depthNear(
      input.depthData,
      input.camera,
    );
    this.material.uniforms.uDepthUvFromView.value.fromArray(
      input.depthData.normDepthBufferFromNormView.matrix,
    );
    this.material.uniforms.uDepthLayer.value = input.depthData.imageIndex ?? 0;

    const previousTarget = this.renderer.getRenderTarget();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(this.clearColor);
    const xrEnabled = this.renderer.xr.enabled;
    const readbackStarted = performance.now();
    try {
      this.renderer.xr.enabled = false;
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, false);
      this.renderer.render(this.scene, input.camera);
      this.renderer.readRenderTargetPixels(
        this.renderTarget,
        0,
        0,
        this.config.maskSize,
        this.config.maskSize,
        this.pixels,
      );
    } catch {
      this.failedReadbacks += 1;
      return null;
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(this.clearColor, previousAlpha);
      this.renderer.xr.enabled = xrEnabled;
    }

    const completed = performance.now();
    return {
      evidence: this.reducer.reduce(this.pixels, input.timestampUs),
      targetMotionMps,
      metrics: {
        bytesReadBack: this.pixels.byteLength,
        readbackTimeUs: Math.round((completed - readbackStarted) * 1_000),
        skippedReadbacks: this.skippedReadbacks,
        failedReadbacks: this.failedReadbacks,
        processingTimeUs: Math.round((completed - started) * 1_000),
      },
    };
  }

  reset() {
    this.nextSampleTimestampUs = 0;
    this.previousTargetTimestampUs = 0;
    this.reducer.reset();
  }

  dispose() {
    this.volume.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }

  private updateTargetMotion(target: Object3D, timestampUs: number) {
    target.getWorldPosition(this.currentTargetPosition);
    target.getWorldQuaternion(this.currentTargetQuaternion);
    target.getWorldScale(this.currentTargetScale);
    const elapsedSeconds =
      (timestampUs - this.previousTargetTimestampUs) / 1_000_000;
    const speed =
      this.previousTargetTimestampUs > 0 && elapsedSeconds > 0
        ? targetSurfaceMotionMps(
            this.currentTargetPosition.distanceTo(this.previousTargetPosition),
            this.previousTargetQuaternion.angleTo(this.currentTargetQuaternion),
            Math.hypot(
              this.config.targetDiameterMeters *
                0.5 *
                Math.max(
                  Math.abs(this.currentTargetScale.x),
                  Math.abs(this.currentTargetScale.y),
                ),
              this.config.targetDepthMeters *
                0.5 *
                Math.abs(this.currentTargetScale.z),
            ),
            elapsedSeconds,
          )
        : 0;
    this.previousTargetPosition.copy(this.currentTargetPosition);
    this.previousTargetQuaternion.copy(this.currentTargetQuaternion);
    this.previousTargetTimestampUs = timestampUs;
    return speed;
  }
}

function createKickTargetMaskMaterial(config: KickDepthMaskConfig) {
  const encodedRange =
    config.maximumSeparationMeters - config.minimumSeparationMeters;
  return new ShaderMaterial({
    name: "KickTargetPhysicalContactMask",
    glslVersion: GLSL3,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uDepthTexture: { value: null },
      uRawValueToMeters: { value: 1 },
      uDepthNear: { value: 0.1 },
      uDepthUvFromView: { value: new Matrix4() },
      uDepthLayer: { value: 0 },
    },
    vertexShader: `
      out float vVirtualDepth;
      out vec2 vTargetLocal;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vVirtualDepth = -viewPosition.z;
        vTargetLocal = position.xy;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      precision highp sampler2DArray;
      uniform sampler2DArray uDepthTexture;
      uniform float uRawValueToMeters;
      uniform float uDepthNear;
      uniform mat4 uDepthUvFromView;
      uniform int uDepthLayer;
      in float vVirtualDepth;
      in vec2 vTargetLocal;
      out vec4 outputColor;

      void main() {
        vec2 localCode = clamp(
          vTargetLocal / vec2(${config.targetDiameterMeters.toFixed(5)}) + 0.5,
          0.0,
          1.0
        );
        vec2 viewUv = gl_FragCoord.xy / vec2(${config.maskSize.toFixed(1)});
        vec4 transformedUv = uDepthUvFromView * vec4(viewUv, 0.0, 1.0);
        if (abs(transformedUv.w) < 0.00001) {
          outputColor = vec4(${(kickMaskFootprintState / 255).toFixed(8)}, 0.0, localCode);
          return;
        }
        vec2 depthUv = transformedUv.xy / transformedUv.w;
        if (any(lessThan(depthUv, vec2(0.0))) || any(greaterThan(depthUv, vec2(1.0)))) {
          outputColor = vec4(${(kickMaskFootprintState / 255).toFixed(8)}, 0.0, localCode);
          return;
        }
        float rawDepth = texture(uDepthTexture, vec3(depthUv, float(uDepthLayer))).r;
        float denominator = 1.0 - rawDepth;
        if (denominator <= 0.0001) {
          outputColor = vec4(${(kickMaskFootprintState / 255).toFixed(8)}, 0.0, localCode);
          return;
        }
        float realDepth = uRawValueToMeters * uDepthNear / denominator;
        if (realDepth <= 0.05) {
          outputColor = vec4(${(kickMaskFootprintState / 255).toFixed(8)}, 0.0, localCode);
          return;
        }
        float separation = vVirtualDepth - realDepth;
        if (separation < ${config.minimumSeparationMeters.toFixed(5)} || separation > ${config.maximumSeparationMeters.toFixed(5)}) {
          outputColor = vec4(${(kickMaskValidDepthState / 255).toFixed(8)}, 0.0, localCode);
          return;
        }
        float encodedSeparation =
          (separation - ${config.minimumSeparationMeters.toFixed(5)}) /
          ${encodedRange.toFixed(5)};
        outputColor = vec4(1.0, encodedSeparation, localCode);
      }
    `,
  });
}

function depthNear(
  depthData: XRWebGLDepthInformation,
  camera: PerspectiveCamera,
) {
  return (
    (depthData as XRWebGLDepthInformation & { readonly depthNear?: number })
      .depthNear ?? camera.near
  );
}
