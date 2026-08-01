import {
  BoxGeometry,
  Color,
  createSystem,
  DepthSensingSystem,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from "@iwsdk/core";
import type { Object3D, PerspectiveCamera, Texture } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import { OpponentVisual } from "../gameplay/presentationSystem.js";
import { PhysicalContactTracker, type HitRegion } from "./combatImpact.js";
import { combatInputMode } from "./combatInputMode.js";
import { calculateDamage } from "./combatTracking.js";

interface ContactZone {
  readonly mesh: Mesh;
  readonly debugMesh: Mesh;
  readonly sourceKey: string;
  readonly region: HitRegion;
  readonly regionIndex: number;
  readonly radius: readonly [number, number, number];
}

export type PhysicalContactDiagnosticState =
  | "idle"
  | "waiting-depth"
  | "waiting-opponent"
  | "clear"
  | "contact"
  | "accepted";

export interface PhysicalContactDiagnostic {
  readonly state: PhysicalContactDiagnosticState;
  readonly message: string;
}

export type PhysicalContactDiagnosticListener = (
  diagnostic: PhysicalContactDiagnostic,
) => void;

export type PhysicalContactDebugListener = (enabled: boolean) => void;

const maskSize = 64;
const debugColumns = 64;
const debugRows = 48;
const debugCubeSizeMeters = 0.05;
const floorDebugToleranceMeters = 0.08;
const sampleIntervalSeconds = 1 / 12;
const minimumSeparationMeters = -0.04;
const maximumSeparationMeters = 0.32;
const localizedPixelMinimumSpeed = 0.7;
const minimumLocalizedPixelCount = 2;
const regionCodes = [0, 51, 102, 153, 204] as const;
const regions: readonly HitRegion[] = [
  "guard",
  "head",
  "torso",
  "abdomen",
  "limb",
];

export class PhysicalContactSystem extends createSystem({
  opponents: { required: [OpponentVisual] },
}) {
  private readonly diagnosticListeners =
    new Set<PhysicalContactDiagnosticListener>();
  private readonly debugListeners = new Set<PhysicalContactDebugListener>();
  private diagnostic: PhysicalContactDiagnostic = {
    state: "idle",
    message: "ARMED / START COMBAT",
  };
  private diagnosticSignature = "";
  private simulation: GameSimulation | undefined;
  private snapshot: SimulationSnapshot | undefined;
  private depthSystem: DepthSensingSystem | undefined;
  private readonly tracker = new PhysicalContactTracker();
  private readonly maskScene = new Scene();
  private readonly maskTarget = new WebGLRenderTarget(maskSize, maskSize, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  private readonly pixels = new Uint8Array(maskSize * maskSize * 4);
  private readonly geometry = new SphereGeometry(1, 12, 8);
  private readonly debugZoneGeometry = new SphereGeometry(1, 12, 8);
  private readonly debugRoot = new Group();
  private readonly debugGeometry = new BoxGeometry(1, 1, 1);
  private readonly debugMaterial = createDepthDebugMaterial();
  private readonly debugCubes = new InstancedMesh(
    this.debugGeometry,
    this.debugMaterial,
    debugColumns * debugRows,
  );
  private readonly depthUvTransform = new Matrix4();
  private readonly identityMatrix = new Matrix4();
  private readonly zones: ContactZone[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly counts = new Uint16Array(regions.length);
  private readonly separationSums = new Float32Array(regions.length);
  private readonly localizedCounts = new Uint16Array(regions.length);
  private readonly localizedSpeedSums = new Float32Array(regions.length);
  private readonly localizedRetreatCounts = new Uint16Array(regions.length);
  private readonly localizedRetreatSpeedSums = new Float32Array(regions.length);
  private readonly previousRegionIndices = new Uint8Array(maskSize * maskSize);
  private readonly previousSeparations = new Float32Array(maskSize * maskSize);
  private readonly zoneCounts = new Uint8Array(regions.length);
  private readonly regionCenters = regions.map(() => new Vector3());
  private readonly previousRegionCenters = regions.map(() => new Vector3());
  private readonly targetMotionSpeeds = new Float32Array(regions.length);
  private readonly leftInputPosition = new Vector3();
  private readonly rightInputPosition = new Vector3();
  private readonly previousLeftInputPosition = new Vector3();
  private readonly previousRightInputPosition = new Vector3();
  private readonly leftInputVelocity = new Vector3();
  private readonly rightInputVelocity = new Vector3();
  private readonly worldScale = new Vector3();
  private readonly direction = new Vector3();
  private readonly clearColor = new Color();
  private nextSampleTime = 0;
  private leftInputActive = false;
  private rightInputActive = false;
  private previousLeftInputActive = false;
  private previousRightInputActive = false;
  private inputMotionInitialized = false;
  private lastInputSampleTime = 0;
  private acceptedDiagnosticUntil = 0;
  private previousMaskTime = 0;
  private previousDiagnosticsEnabled = false;
  private heldObjectActive = false;
  private debugEnabled = false;

  init() {
    this.simulation = this.globals.portalBoxingSimulation as
      GameSimulation | undefined;
    this.depthSystem = this.world.getSystem(DepthSensingSystem);
    if (this.simulation) {
      this.cleanupFuncs.push(
        this.simulation.subscribe((snapshot) => {
          this.snapshot = snapshot;
        }),
      );
    }
    this.debugRoot.name = "PhysicalContactDebugView";
    this.debugRoot.visible = false;
    const debugRootEntity = this.world.createTransformEntity(this.debugRoot, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    this.debugCubes.name = "PhysicalDepthDebugCubes";
    this.debugCubes.frustumCulled = false;
    this.debugCubes.renderOrder = 1000;
    const debugUv = new Float32Array(debugColumns * debugRows * 2);
    let debugUvOffset = 0;
    for (let row = 0; row < debugRows; row += 1) {
      for (let column = 0; column < debugColumns; column += 1) {
        const instanceIndex = row * debugColumns + column;
        debugUv[debugUvOffset] = (column + 0.5) / debugColumns;
        debugUv[debugUvOffset + 1] = (row + 0.5) / debugRows;
        debugUvOffset += 2;
        this.debugCubes.setMatrixAt(instanceIndex, this.identityMatrix);
      }
    }
    this.debugGeometry.setAttribute(
      "debugUv",
      new InstancedBufferAttribute(debugUv, 2),
    );
    this.debugCubes.instanceMatrix.needsUpdate = true;
    this.debugRoot.add(this.debugCubes);
    this.addZone("head", "head", 1, [0.24, 0.22, 0.23]);
    this.addZone("torso", "torso", 2, [0.4, 0.43, 0.31]);
    this.addZone("hips", "abdomen", 3, [0.35, 0.28, 0.29]);
    this.addZone("leftKnee", "limb", 4, [0.2, 0.42, 0.22]);
    this.addZone("rightKnee", "limb", 4, [0.2, 0.42, 0.22]);
    this.cleanupFuncs.push(() => {
      this.diagnosticListeners.clear();
      this.debugListeners.clear();
      this.maskTarget.dispose();
      this.geometry.dispose();
      for (const material of this.materials) material.dispose();
      debugRootEntity.dispose();
    });
  }

  subscribeDiagnostics(listener: PhysicalContactDiagnosticListener) {
    this.diagnosticListeners.add(listener);
    listener(this.diagnostic);
    return () => this.diagnosticListeners.delete(listener);
  }

  subscribeDebugVisibility(listener: PhysicalContactDebugListener) {
    this.debugListeners.add(listener);
    listener(this.debugEnabled);
    return () => this.debugListeners.delete(listener);
  }

  setDebugVisible(enabled: boolean) {
    if (enabled === this.debugEnabled) return;
    this.debugEnabled = enabled;
    if (!enabled) this.debugRoot.visible = false;
    for (const listener of this.debugListeners) listener(enabled);
  }

  get isDebugVisible() {
    return this.debugEnabled;
  }

  setHeldObjectActive(enabled: boolean) {
    if (this.heldObjectActive === enabled) return;
    this.heldObjectActive = enabled;
    this.tracker.reset();
  }

  update(_delta: number, time: number) {
    const snapshot = this.snapshot;
    const diagnosticsEnabled =
      snapshot?.physicalContactDiagnosticsEnabled ?? false;
    if (diagnosticsEnabled !== this.previousDiagnosticsEnabled) {
      this.tracker.reset();
      this.previousMaskTime = 0;
      this.previousRegionIndices.fill(0);
      this.previousDiagnosticsEnabled = diagnosticsEnabled;
    }
    const combatActive =
      snapshot?.application === "PLAYING" &&
      (snapshot.encounter === "COMBAT" || snapshot.encounter === "BOSS_COMBAT");
    if (!combatActive) {
      this.tracker.reset();
      this.previousMaskTime = 0;
      this.previousRegionIndices.fill(0);
      this.inputMotionInitialized = false;
      this.previousLeftInputActive = false;
      this.previousRightInputActive = false;
      for (const zone of this.zones) {
        zone.mesh.visible = false;
        zone.debugMesh.visible = false;
      }
      this.publishDiagnostic("idle", "ARMED / START COMBAT");
    }
    if (time < this.nextSampleTime) return;
    this.nextSampleTime = time + sampleIntervalSeconds;
    const depthData = this.depthSystem?.gpuDepthData[0];
    const depthTexture = this.renderer.xr.getDepthTexture();
    const xrCamera = this.renderer.xr.getCamera().cameras[0];
    if (!depthData || !depthTexture || !xrCamera) {
      this.debugRoot.visible = false;
      if (combatActive) {
        this.publishDiagnostic("waiting-depth", "WAITING FOR CAMERA DEPTH");
      }
      return;
    }
    const depthNear = Number(
      (depthData as XRWebGLDepthInformation & { depthNear?: number })
        .depthNear ?? xrCamera.near,
    );
    this.updateDepthResources(
      depthTexture,
      depthData.rawValueToMeters,
      depthNear,
      depthData.normDepthBufferFromNormView.matrix,
      xrCamera.matrixWorld,
    );
    if (!combatActive) return;
    if (!this.syncZones()) {
      this.previousMaskTime = 0;
      this.previousRegionIndices.fill(0);
      this.publishDiagnostic("waiting-opponent", "WAITING FOR OPPONENT");
      return;
    }

    this.readInputPositions(time);
    this.renderMask(xrCamera);
    this.processMask(time);
  }

  private addZone(
    sourceKey: string,
    region: HitRegion,
    regionIndex: number,
    radius: readonly [number, number, number],
  ) {
    const material = createContactMaterial(regionCodes[regionIndex] / 255);
    const mesh = new Mesh(this.geometry, material);
    const debugMesh = new Mesh(
      this.debugZoneGeometry,
      createZoneDebugMaterial(region),
    );
    mesh.frustumCulled = false;
    mesh.visible = false;
    debugMesh.name = `PhysicalContactDebug-${sourceKey}`;
    debugMesh.frustumCulled = false;
    debugMesh.renderOrder = 999;
    debugMesh.visible = false;
    this.materials.push(material);
    this.maskScene.add(mesh);
    this.debugRoot.add(debugMesh);
    this.zones.push({
      mesh,
      debugMesh,
      sourceKey,
      region,
      regionIndex,
      radius,
    });
  }

  private syncZones() {
    const opponent = this.queries.opponents.entities.values().next().value;
    const root = opponent?.object3D;
    this.zoneCounts.fill(0);
    for (const center of this.regionCenters) center.set(0, 0, 0);
    let visibleCount = 0;
    for (const zone of this.zones) {
      const source = root?.userData[zone.sourceKey] as Object3D | undefined;
      zone.mesh.visible = Boolean(source);
      zone.debugMesh.visible = Boolean(source);
      if (!source) continue;
      source.getWorldPosition(zone.mesh.position);
      source.getWorldQuaternion(zone.mesh.quaternion);
      source.getWorldScale(this.worldScale);
      zone.mesh.scale.set(
        zone.radius[0] * this.worldScale.x,
        zone.radius[1] * this.worldScale.y,
        zone.radius[2] * this.worldScale.z,
      );
      zone.debugMesh.position.copy(zone.mesh.position);
      zone.debugMesh.quaternion.copy(zone.mesh.quaternion);
      zone.debugMesh.scale.copy(zone.mesh.scale);
      this.regionCenters[zone.regionIndex].add(zone.mesh.position);
      this.zoneCounts[zone.regionIndex] += 1;
      visibleCount += 1;
    }
    for (let index = 1; index < this.regionCenters.length; index += 1) {
      const count = this.zoneCounts[index];
      if (count > 0) this.regionCenters[index].multiplyScalar(1 / count);
    }
    return visibleCount > 0;
  }

  private readInputPositions(time: number) {
    this.leftInputActive = this.readInputPosition(
      "left",
      this.leftInputPosition,
    );
    this.rightInputActive = this.readInputPosition(
      "right",
      this.rightInputPosition,
    );
    const deltaSeconds = time - this.lastInputSampleTime;
    if (this.inputMotionInitialized && deltaSeconds > 0) {
      if (this.leftInputActive && this.previousLeftInputActive) {
        this.leftInputVelocity
          .copy(this.leftInputPosition)
          .sub(this.previousLeftInputPosition)
          .multiplyScalar(1 / deltaSeconds);
      } else {
        this.leftInputVelocity.set(0, 0, 0);
      }
      if (this.rightInputActive && this.previousRightInputActive) {
        this.rightInputVelocity
          .copy(this.rightInputPosition)
          .sub(this.previousRightInputPosition)
          .multiplyScalar(1 / deltaSeconds);
      } else {
        this.rightInputVelocity.set(0, 0, 0);
      }
    } else {
      this.leftInputVelocity.set(0, 0, 0);
      this.rightInputVelocity.set(0, 0, 0);
      this.inputMotionInitialized = true;
    }
    if (this.leftInputActive) {
      this.previousLeftInputPosition.copy(this.leftInputPosition);
    }
    if (this.rightInputActive) {
      this.previousRightInputPosition.copy(this.rightInputPosition);
    }
    this.previousLeftInputActive = this.leftInputActive;
    this.previousRightInputActive = this.rightInputActive;
    this.lastInputSampleTime = time;
  }

  private readInputPosition(handedness: "left" | "right", output: Vector3) {
    const mode = combatInputMode(
      this.input.xr.getPrimaryInputSource(handedness),
    );
    if (mode === "none") return false;
    const space =
      mode === "hand"
        ? this.player.indexTipSpaces[handedness]
        : this.player.gripSpaces[handedness];
    space.getWorldPosition(output);
    return true;
  }

  private updateDepthResources(
    depthTexture: Texture,
    rawValueToMeters: number,
    depthNear: number,
    normDepthBufferFromNormView: Float32Array,
    cameraWorld: Matrix4,
  ) {
    this.depthUvTransform.fromArray(normDepthBufferFromNormView);
    for (const material of this.materials) {
      material.uniforms.uDepthTexture.value = depthTexture;
      material.uniforms.uRawValueToMeters.value = rawValueToMeters;
      material.uniforms.uDepthNear.value = depthNear;
      material.uniforms.uDepthUvFromView.value = this.depthUvTransform;
    }
    this.debugMaterial.uniforms.uDepthTexture.value = depthTexture;
    this.debugMaterial.uniforms.uRawValueToMeters.value = rawValueToMeters;
    this.debugMaterial.uniforms.uDepthNear.value = depthNear;
    this.debugMaterial.uniforms.uDepthUvFromView.value = this.depthUvTransform;
    this.debugMaterial.uniforms.uCameraWorld.value.copy(cameraWorld);
    this.debugMaterial.uniforms.uLowWorldHeight.value =
      this.player.position.y + floorDebugToleranceMeters;
    this.debugRoot.visible = this.debugEnabled;
  }

  private renderMask(camera: PerspectiveCamera) {
    const previousTarget = this.renderer.getRenderTarget();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(this.clearColor);
    const xrEnabled = this.renderer.xr.enabled;
    try {
      this.renderer.xr.enabled = false;
      this.renderer.setRenderTarget(this.maskTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, false);
      this.renderer.render(this.maskScene, camera);
      this.renderer.readRenderTargetPixels(
        this.maskTarget,
        0,
        0,
        maskSize,
        maskSize,
        this.pixels,
      );
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(this.clearColor, previousAlpha);
      this.renderer.xr.enabled = xrEnabled;
    }
  }

  private processMask(time: number) {
    this.counts.fill(0);
    this.separationSums.fill(0);
    this.localizedCounts.fill(0);
    this.localizedSpeedSums.fill(0);
    this.localizedRetreatCounts.fill(0);
    this.localizedRetreatSpeedSums.fill(0);
    this.targetMotionSpeeds.fill(0);
    const maskDeltaSeconds =
      this.previousMaskTime > 0 ? time - this.previousMaskTime : 0;
    if (maskDeltaSeconds > 0) {
      for (
        let regionIndex = 1;
        regionIndex < regions.length;
        regionIndex += 1
      ) {
        if (this.zoneCounts[regionIndex] > 0) {
          this.targetMotionSpeeds[regionIndex] =
            this.regionCenters[regionIndex].distanceTo(
              this.previousRegionCenters[regionIndex],
            ) / maskDeltaSeconds;
        }
      }
    }
    for (let regionIndex = 1; regionIndex < regions.length; regionIndex += 1) {
      this.previousRegionCenters[regionIndex].copy(
        this.regionCenters[regionIndex],
      );
    }
    for (let offset = 0; offset < this.pixels.length; offset += 4) {
      const pixelIndex = offset >> 2;
      const regionIndex = Math.round(this.pixels[offset] / 51);
      if (regionIndex <= 0 || regionIndex >= regions.length) {
        this.previousRegionIndices[pixelIndex] = 0;
        this.previousSeparations[pixelIndex] = 0;
        continue;
      }
      const normalizedSeparation = this.pixels[offset + 1] / 255;
      const separation =
        minimumSeparationMeters +
        normalizedSeparation *
          (maximumSeparationMeters - minimumSeparationMeters);
      this.counts[regionIndex] += 1;
      this.separationSums[regionIndex] += separation;
      if (
        maskDeltaSeconds > 0 &&
        this.previousRegionIndices[pixelIndex] === regionIndex
      ) {
        const previousSeparation = this.previousSeparations[pixelIndex];
        const localizedSpeed =
          (previousSeparation - separation) / maskDeltaSeconds;
        if (localizedSpeed >= localizedPixelMinimumSpeed) {
          this.localizedCounts[regionIndex] += 1;
          this.localizedSpeedSums[regionIndex] += localizedSpeed;
        } else if (localizedSpeed <= -localizedPixelMinimumSpeed) {
          this.localizedRetreatCounts[regionIndex] += 1;
          this.localizedRetreatSpeedSums[regionIndex] -= localizedSpeed;
        }
      }
      this.previousRegionIndices[pixelIndex] = regionIndex;
      this.previousSeparations[pixelIndex] = separation;
    }
    this.previousMaskTime = time;

    let selected: ReturnType<PhysicalContactTracker["update"]> | undefined;
    let selectedRegion: HitRegion = "limb";
    let selectedRegionIndex = 0;
    let selectedScore = 0;
    let closestRegionIndex = 0;
    let closestSeparation = Number.POSITIVE_INFINITY;
    let closestCoverage = 0;
    for (let regionIndex = 1; regionIndex < regions.length; regionIndex += 1) {
      const count = this.counts[regionIndex];
      const localizedCount = this.localizedCounts[regionIndex];
      const localizedRetreatCount = this.localizedRetreatCounts[regionIndex];
      const separation =
        count > 0
          ? this.separationSums[regionIndex] / count
          : Number.POSITIVE_INFINITY;
      if (separation < closestSeparation) {
        closestRegionIndex = regionIndex;
        closestSeparation = separation;
        closestCoverage = count / (maskSize * maskSize);
      }
      const center = this.regionCenters[regionIndex];
      const nearestHandDistance = Math.min(
        this.leftInputActive
          ? center.distanceTo(this.leftInputPosition)
          : Number.POSITIVE_INFINITY,
        this.rightInputActive
          ? center.distanceTo(this.rightInputPosition)
          : Number.POSITIVE_INFINITY,
      );
      const useLeftHand =
        leftDistanceFor(center, this.leftInputPosition, this.leftInputActive) <=
        leftDistanceFor(center, this.rightInputPosition, this.rightInputActive);
      const associatedVelocity = useLeftHand
        ? this.leftInputVelocity
        : this.rightInputVelocity;
      const associatedPosition = useLeftHand
        ? this.leftInputPosition
        : this.rightInputPosition;
      const associatedHandSpeed = associatedVelocity.length();
      this.direction.copy(center).sub(associatedPosition).normalize();
      const handMotionAlignment =
        Number.isFinite(nearestHandDistance) && associatedHandSpeed > 0
          ? associatedVelocity.dot(this.direction) / associatedHandSpeed
          : 0;
      const impact = this.tracker.update({
        region: regions[regionIndex],
        nearestHandDistance,
        associatedHandSpeed,
        handMotionAlignment,
        separationMeters: separation,
        contactCoverage: count / (maskSize * maskSize),
        localizedApproachSpeed:
          localizedCount >= minimumLocalizedPixelCount
            ? this.localizedSpeedSums[regionIndex] / localizedCount
            : 0,
        localizedRetreatSpeed:
          localizedRetreatCount >= minimumLocalizedPixelCount
            ? this.localizedRetreatSpeedSums[regionIndex] /
              localizedRetreatCount
            : 0,
        targetMotionSpeed: this.targetMotionSpeeds[regionIndex],
        heldObjectActive: this.heldObjectActive,
        timestamp: time,
      });
      const score = impact ? impact.speed * impact.confidence : 0;
      if (impact && score > selectedScore) {
        selected = impact;
        selectedRegion = regions[regionIndex];
        selectedRegionIndex = regionIndex;
        selectedScore = score;
      }
    }
    if (!selected || !this.simulation) {
      if (time >= this.acceptedDiagnosticUntil) {
        if (closestRegionIndex === 0) {
          this.publishDiagnostic("clear", "SCANNING / CLEAR");
        } else {
          const separationCentimeters = Math.round(closestSeparation * 100);
          const coveragePercent = (closestCoverage * 100).toFixed(1);
          this.publishDiagnostic(
            "contact",
            `CONTACT ${regions[closestRegionIndex].toUpperCase()} · ${separationCentimeters}CM · ${coveragePercent}%`,
          );
        }
      }
      return;
    }

    const center = this.regionCenters[selectedRegionIndex];
    const leftDistance = this.leftInputActive
      ? center.distanceTo(this.leftInputPosition)
      : Number.POSITIVE_INFINITY;
    const rightDistance = this.rightInputActive
      ? center.distanceTo(this.rightInputPosition)
      : Number.POSITIVE_INFINITY;
    if (selected.kind === "unclassified-depth-contact") {
      this.acceptedDiagnosticUntil = time + 1.5;
      this.publishDiagnostic(
        "contact",
        `UNCLASSIFIED CONTACT · ${selectedRegion.toUpperCase()} · ${selected.speed.toFixed(1)}M/S`,
      );
      console.info("[physical-contact] observed", {
        kind: selected.kind,
        region: selectedRegion,
        speed: selected.speed,
        confidence: selected.confidence,
      });
      return;
    }
    this.direction
      .copy(center)
      .sub(
        leftDistance <= rightDistance
          ? this.leftInputPosition
          : this.rightInputPosition,
      )
      .normalize();
    const damage = calculateDamage({
      speed: Math.min(selected.speed, 8),
      type: "held-object",
      hitRegion: selectedRegion,
      guarded: false,
      combo: 0,
      difficulty: 1,
      safetyMaximum: 42,
    });
    for (const entity of this.queries.opponents.entities) {
      if (entity.object3D) entity.object3D.userData.hitFlashUntil = time + 0.14;
    }
    this.simulation.applyPlayerImpact(damage, {
      source: "held-object",
      region: selectedRegion,
      direction: [this.direction.x, this.direction.y, this.direction.z],
      speed: selected.speed,
      confidence: selected.confidence,
      timestamp: time,
    });
    this.acceptedDiagnosticUntil = time + 1.5;
    const message = `OBJECT ACCEPTED · ${selectedRegion.toUpperCase()} · ${selected.speed.toFixed(1)}M/S`;
    this.publishDiagnostic("accepted", message);
    console.info("[physical-contact] accepted", {
      source: "held-object",
      region: selectedRegion,
      speed: selected.speed,
      confidence: selected.confidence,
      damage,
    });
  }

  private publishDiagnostic(
    state: PhysicalContactDiagnosticState,
    message: string,
  ) {
    const signature = `${state}:${message}`;
    if (signature === this.diagnosticSignature) return;
    this.diagnosticSignature = signature;
    this.diagnostic = { state, message };
    for (const listener of this.diagnosticListeners) listener(this.diagnostic);
  }
}

function leftDistanceFor(center: Vector3, input: Vector3, active: boolean) {
  return active ? center.distanceTo(input) : Number.POSITIVE_INFINITY;
}

function createContactMaterial(regionCode: number) {
  return new ShaderMaterial({
    name: "PhysicalContactMask",
    glslVersion: GLSL3,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uDepthTexture: { value: null },
      uRawValueToMeters: { value: 1 },
      uDepthNear: { value: 0.1 },
      uDepthUvFromView: { value: new Matrix4() },
      uRegionCode: { value: regionCode },
    },
    vertexShader: `
      out float vVirtualDepth;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vVirtualDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      precision highp sampler2DArray;
      uniform sampler2DArray uDepthTexture;
      uniform float uRawValueToMeters;
      uniform float uDepthNear;
      uniform mat4 uDepthUvFromView;
      uniform float uRegionCode;
      in float vVirtualDepth;
      out vec4 outputColor;

      void main() {
        vec2 viewUv = gl_FragCoord.xy / vec2(${maskSize.toFixed(1)});
        vec4 transformedUv = uDepthUvFromView * vec4(viewUv, 0.0, 1.0);
        vec2 depthUv = transformedUv.xy / transformedUv.w;
        if (any(lessThan(depthUv, vec2(0.0))) || any(greaterThan(depthUv, vec2(1.0)))) discard;
        float rawDepth = texture(uDepthTexture, vec3(depthUv, 0.0)).r;
        float denominator = 1.0 - rawDepth;
        if (denominator <= 0.0001) discard;
        float realDepth = uRawValueToMeters * uDepthNear / denominator;
        float separation = vVirtualDepth - realDepth;
        if (realDepth <= 0.0 || separation < ${minimumSeparationMeters.toFixed(3)} || separation > ${maximumSeparationMeters.toFixed(3)}) discard;
        float encodedSeparation = (separation - ${minimumSeparationMeters.toFixed(3)}) / ${(maximumSeparationMeters - minimumSeparationMeters).toFixed(3)};
        outputColor = vec4(uRegionCode, encodedSeparation, 1.0, 1.0);
      }
    `,
  });
}

function createDepthDebugMaterial() {
  return new ShaderMaterial({
    name: "PhysicalDepthDebugCubes",
    glslVersion: GLSL3,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uDepthTexture: { value: null },
      uRawValueToMeters: { value: 1 },
      uDepthNear: { value: 0.1 },
      uDepthUvFromView: { value: new Matrix4() },
      uCameraWorld: { value: new Matrix4() },
      uMaximumDepth: { value: 4 },
      uLowWorldHeight: { value: floorDebugToleranceMeters },
      uCubeSize: { value: debugCubeSizeMeters },
    },
    vertexShader: `
      precision highp sampler2DArray;
      uniform sampler2DArray uDepthTexture;
      uniform float uRawValueToMeters;
      uniform float uDepthNear;
      uniform mat4 uDepthUvFromView;
      uniform mat4 uCameraWorld;
      uniform float uMaximumDepth;
      uniform float uLowWorldHeight;
      uniform float uCubeSize;
      in vec2 debugUv;
      out vec3 vColor;
      out float vValid;
      out float vShade;

      #ifndef VIEW_ID
      #define VIEW_ID 0
      #endif

      void main() {
        vec2 viewUv = debugUv;
        vec4 transformedUv = uDepthUvFromView * vec4(viewUv, 0.0, 1.0);
        vec2 depthUv = transformedUv.xy / transformedUv.w;
        float rawDepth = texture(uDepthTexture, vec3(depthUv, float(VIEW_ID))).r;
        float denominator = 1.0 - rawDepth;
        float realDepth = denominator > 0.0001
          ? uRawValueToMeters * uDepthNear / denominator
          : 0.0;
        bool insideTexture = all(greaterThanEqual(depthUv, vec2(0.0))) &&
          all(lessThanEqual(depthUv, vec2(1.0)));
        vValid = insideTexture && realDepth > 0.05 && realDepth < uMaximumDepth
          ? 1.0
          : 0.0;

        vec2 ndc = viewUv * 2.0 - 1.0;
        vec4 centerViewPosition = vec4(
          (ndc.x + projectionMatrix[2][0]) * realDepth / projectionMatrix[0][0],
          (ndc.y + projectionMatrix[2][1]) * realDepth / projectionMatrix[1][1],
          -realDepth,
          1.0
        );
        vec4 centerWorldPosition = uCameraWorld * centerViewPosition;
        vColor = centerWorldPosition.y < uLowWorldHeight
          ? vec3(1.0, 0.18, 0.08)
          : vec3(0.05, 1.0, 0.35);
        vShade = 0.55 + 0.45 * max(dot(normal, normalize(vec3(0.4, 0.8, 0.3))), 0.0);
        vec4 worldPosition = centerWorldPosition;
        worldPosition.xyz += position * uCubeSize * vValid;
        if (vValid < 0.5) worldPosition.xyz = vec3(0.0, -1000.0, 0.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      in vec3 vColor;
      in float vValid;
      in float vShade;
      out vec4 outputColor;

      void main() {
        if (vValid < 0.5) discard;
        outputColor = vec4(vColor * vShade, 0.82);
      }
    `,
  });
}

function createZoneDebugMaterial(region: HitRegion) {
  const colors: Readonly<Record<HitRegion, number>> = {
    guard: 0xffffff,
    head: 0x00cfff,
    torso: 0xffd000,
    abdomen: 0xff7500,
    limb: 0xff2c75,
  };
  return new MeshBasicMaterial({
    name: `PhysicalContactDebug-${region}`,
    color: colors[region],
    transparent: true,
    opacity: 0.32,
    wireframe: true,
    depthTest: false,
    depthWrite: false,
  });
}
