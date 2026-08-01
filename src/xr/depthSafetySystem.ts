import { createSystem, DepthSensingSystem, Matrix4 } from "@iwsdk/core";
import type { Vector3 } from "@iwsdk/core";

import {
  PhysicalWebXRDepthProvider,
  type DepthSampleFrame,
  type PhysicalDepthSource,
} from "./depthProvider.js";
import { isDepthSegmentClear } from "./depthClearance.js";
import { unprojectDepthPointInto } from "./depthUnprojection.js";

const maximumStrikeSampleAgeMilliseconds = 180;
const strikeClearanceRadius = 0.11;
const handExclusionDistance = 0.08;

export class DepthSafetySystem extends createSystem({}) {
  private depthSystem: DepthSensingSystem | undefined;
  private provider: PhysicalWebXRDepthProvider | undefined;
  private frame: DepthSampleFrame | undefined;
  private cpuDepth: XRCPUDepthInformation | undefined;
  private capturedAtMilliseconds = 0;
  private sampleNowMilliseconds = 0;
  private readonly inverseProjection = new Matrix4();
  private readonly sensorTransform = new Matrix4();
  private readonly referenceFromSensor = new Matrix4();
  private readonly strikeStart = new Float32Array(3);
  private readonly strikeEnd = new Float32Array(3);
  private readonly source: PhysicalDepthSource = {
    get cpuDepth() {
      return this.owner.cpuDepth;
    },
    get gpuDepthAvailable() {
      return Boolean(this.owner.depthSystem?.gpuDepthData[0]);
    },
    get capturedAt() {
      return this.owner.capturedAtMilliseconds;
    },
    get floorY() {
      return this.owner.player.position.y;
    },
    unproject: (normalizedX, normalizedY, depthMeters, output, offset) => {
      if (
        !unprojectDepthPointInto(
          normalizedX,
          normalizedY,
          depthMeters,
          this.inverseProjection.elements,
          this.referenceFromSensor.elements,
          output,
          offset,
        )
      ) {
        output[offset] = Number.NaN;
        output[offset + 1] = Number.NaN;
        output[offset + 2] = Number.NaN;
      }
    },
    owner: this,
  } as PhysicalDepthSource & { owner: DepthSafetySystem };

  init() {
    this.depthSystem = this.world.getSystem(DepthSensingSystem);
    this.provider = new PhysicalWebXRDepthProvider(
      () => (this.prepareSource() ? this.source : null),
      { quality: "low", samplesPerSecond: 12, maximumDepthMeters: 4 },
    );
    this.cleanupFuncs.push(() => this.provider?.dispose());
  }

  update(delta: number, time: number) {
    const provider = this.provider;
    if (!provider) return;
    provider.updateFrameTime(delta * 1000);
    this.sampleNowMilliseconds = time * 1000;
    try {
      const frame = provider.sample(this.sampleNowMilliseconds);
      if (frame) this.frame = frame;
    } catch {
      this.frame = undefined;
      this.cpuDepth = undefined;
    }
  }

  isStrikePathClear(start: Vector3, end: Vector3, time: number): boolean {
    const frame = this.frame;
    if (
      !frame ||
      time * 1000 - frame.capturedAt > maximumStrikeSampleAgeMilliseconds
    ) {
      return true;
    }
    this.strikeStart[0] = start.x;
    this.strikeStart[1] = start.y;
    this.strikeStart[2] = start.z;
    this.strikeEnd[0] = end.x;
    this.strikeEnd[1] = end.y;
    this.strikeEnd[2] = end.z;
    return isDepthSegmentClear(
      frame.positions,
      frame.sampleCount,
      this.strikeStart,
      this.strikeEnd,
      strikeClearanceRadius,
      handExclusionDistance,
    );
  }

  private prepareSource(): boolean {
    const depth = this.depthSystem?.cpuDepthData[0];
    const referenceSpace = this.xrManager.getReferenceSpace();
    if (!depth || depth === this.cpuDepth || !referenceSpace || !this.xrFrame) {
      return false;
    }
    const view = this.xrFrame.getViewerPose(referenceSpace)?.views[0];
    const projection = depth.projectionMatrix ?? view?.projectionMatrix;
    const referenceTransform =
      depth.transform?.matrix ?? view?.transform.matrix;
    if (!projection || !referenceTransform) return false;

    this.cpuDepth = depth;
    this.capturedAtMilliseconds = this.sampleNowMilliseconds;
    this.inverseProjection.fromArray(projection).invert();
    this.sensorTransform.fromArray(referenceTransform);
    this.player.updateWorldMatrix(true, false);
    this.referenceFromSensor.multiplyMatrices(
      this.player.matrixWorld,
      this.sensorTransform,
    );
    return true;
  }
}
