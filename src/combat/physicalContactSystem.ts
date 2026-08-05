import {
  createSystem,
  CylinderGeometry,
  DepthSensingSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "@iwsdk/core";
import type { Object3D, PerspectiveCamera, Texture } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import { OpponentVisual } from "../gameplay/presentationSystem.js";
import { combatInputMode } from "./combatInputMode.js";
import { calculateDamage } from "./combatTracking.js";
import { kickContactVolume } from "./kickDepthMask.js";
import { KickRecognitionEngine } from "./kickRecognition";
import type {
  KickDepthEvidence,
  KickRecognitionDecision,
  KickTargetId,
  KickTrackedPose,
} from "./kickRecognition";
import { resolveKickImpactPolicy } from "./kickImpactPolicy.js";
import {
  defaultKickTargetDepthMaskConfig,
  KickTargetDepthMask,
  type KickTargetDepthMaskResult,
} from "./kickTargetDepthMask.js";
import { KickTelemetry, kickTelemetrySnapshot } from "./kickTelemetry.js";

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

const sampleIntervalSeconds = 1 / 24;
const kickTargetIds = [
  "opponent-left-target",
  "opponent-right-target",
  "opponent-groin-target",
] as const;
const kickTargetSourceKeys: Readonly<Record<KickTargetId, string>> = {
  "opponent-left-target": "opponentLeftKickTarget",
  "opponent-right-target": "opponentRightKickTarget",
  "opponent-groin-target": "opponentGroinKickTarget",
};
const kickTargetRegions: Readonly<Record<KickTargetId, "abdomen" | "limb">> = {
  "opponent-left-target": "limb",
  "opponent-right-target": "limb",
  "opponent-groin-target": "abdomen",
};
const kickDebugContactVolume = kickContactVolume(
  defaultKickTargetDepthMaskConfig,
);

export class KickCombatSystem extends createSystem({
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
  private readonly kickTargetDebugRoot = new Group();
  private readonly kickPadDebugGeometry = createKickPadDebugGeometry();
  private readonly kickPadDebugMaterials = {
    "opponent-left-target": createKickPadDebugMaterial(0x38d9ff),
    "opponent-right-target": createKickPadDebugMaterial(0xff4f9a),
    "opponent-groin-target": createKickPadDebugMaterial(0xffc928),
  } satisfies Record<KickTargetId, MeshBasicMaterial>;
  private readonly kickPadDebugMeshes: Record<KickTargetId, Mesh> = {
    "opponent-left-target": new Mesh(
      this.kickPadDebugGeometry,
      this.kickPadDebugMaterials["opponent-left-target"],
    ),
    "opponent-right-target": new Mesh(
      this.kickPadDebugGeometry,
      this.kickPadDebugMaterials["opponent-right-target"],
    ),
    "opponent-groin-target": new Mesh(
      this.kickPadDebugGeometry,
      this.kickPadDebugMaterials["opponent-groin-target"],
    ),
  };
  private readonly kickTargetMasks: Record<KickTargetId, KickTargetDepthMask> =
    {
      "opponent-left-target": new KickTargetDepthMask(this.renderer),
      "opponent-right-target": new KickTargetDepthMask(this.renderer),
      "opponent-groin-target": new KickTargetDepthMask(this.renderer),
    };
  private readonly kickRecognizers: Record<
    KickTargetId,
    KickRecognitionEngine
  > = {
    "opponent-left-target": new KickRecognitionEngine("opponent-left-target"),
    "opponent-right-target": new KickRecognitionEngine("opponent-right-target"),
    "opponent-groin-target": new KickRecognitionEngine("opponent-groin-target"),
  };
  private readonly kickTelemetry = new KickTelemetry();
  private readonly leftInputPosition = new Vector3();
  private readonly rightInputPosition = new Vector3();
  private readonly previousLeftInputPosition = new Vector3();
  private readonly previousRightInputPosition = new Vector3();
  private readonly leftInputVelocity = new Vector3();
  private readonly rightInputVelocity = new Vector3();
  private readonly leftInputTargetLocal = new Vector3();
  private readonly rightInputTargetLocal = new Vector3();
  private readonly kickImpactCenter = new Vector3();
  private readonly worldScale = new Vector3();
  private readonly kickDebugOffset = new Vector3();
  private readonly direction = new Vector3();
  private nextSampleTime = 0;
  private leftInputActive = false;
  private rightInputActive = false;
  private previousLeftInputActive = false;
  private previousRightInputActive = false;
  private inputMotionInitialized = false;
  private lastInputSampleTime = 0;
  private acceptedDiagnosticUntil = 0;
  private previousDiagnosticsEnabled = false;
  private debugEnabled = false;
  private kickTargetLock: KickTargetId | undefined;

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
    this.kickTargetDebugRoot.name = "KickTargetDebugView";
    this.kickTargetDebugRoot.visible = false;
    const kickTargetDebugRootEntity = this.world.createTransformEntity(
      this.kickTargetDebugRoot,
      {
        parent: this.world.sceneEntity,
        persistent: true,
      },
    );
    for (const targetId of kickTargetIds) {
      const debugMesh = this.kickPadDebugMeshes[targetId];
      debugMesh.name = `KickPadDebug-${targetId}`;
      debugMesh.frustumCulled = false;
      debugMesh.renderOrder = 1001;
      debugMesh.visible = false;
      this.kickTargetDebugRoot.add(debugMesh);
    }
    this.cleanupFuncs.push(() => {
      this.diagnosticListeners.clear();
      this.debugListeners.clear();
      for (const targetId of kickTargetIds) {
        this.kickTargetMasks[targetId].dispose();
      }
      this.kickPadDebugGeometry.dispose();
      for (const targetId of kickTargetIds) {
        this.kickPadDebugMaterials[targetId].dispose();
      }
      kickTargetDebugRootEntity.dispose();
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
    for (const listener of this.debugListeners) listener(enabled);
  }

  get isDebugVisible() {
    return this.debugEnabled;
  }

  update(_delta: number, time: number) {
    const snapshot = this.snapshot;
    const diagnosticsEnabled =
      snapshot?.physicalContactDiagnosticsEnabled ?? false;
    if (diagnosticsEnabled !== this.previousDiagnosticsEnabled) {
      this.resetKickRecognition();
      this.previousDiagnosticsEnabled = diagnosticsEnabled;
    }
    const combatActive =
      snapshot?.application === "PLAYING" &&
      (snapshot.encounter === "COMBAT" || snapshot.encounter === "BOSS_COMBAT");
    this.kickTargetDebugRoot.visible = combatActive && this.debugEnabled;
    if (!combatActive) {
      this.resetKickRecognition();
      this.inputMotionInitialized = false;
      this.previousLeftInputActive = false;
      this.previousRightInputActive = false;
      this.publishDiagnostic("idle", "ARMED / START COMBAT");
    }
    if (combatActive && !this.syncZones()) {
      this.resetKickRecognition();
      this.publishDiagnostic("waiting-opponent", "WAITING FOR OPPONENT");
      return;
    }
    if (time < this.nextSampleTime) return;
    this.nextSampleTime = time + sampleIntervalSeconds;
    const depthData = this.depthSystem?.gpuDepthData[0];
    const depthTexture = this.renderer.xr.getDepthTexture();
    const xrCamera = this.renderer.xr.getCamera().cameras[0];
    if (!depthData || !depthTexture || !xrCamera) {
      if (combatActive) {
        this.publishDiagnostic("waiting-depth", "WAITING FOR CAMERA DEPTH");
      }
      return;
    }
    if (!combatActive) return;

    this.readInputPositions(time);
    const kickDecision = this.processKickRecognition(
      time,
      depthTexture,
      depthData,
      xrCamera,
    );
    if (kickDecision) this.handleKickDecision(kickDecision, time);
    else if (time >= this.acceptedDiagnosticUntil) {
      this.publishDiagnostic("clear", "KICK TARGETS CLEAR");
    }
  }

  private syncZones() {
    const opponent = this.queries.opponents.entities.values().next().value;
    const root = opponent?.object3D;
    let visibleCount = 0;
    for (const targetId of kickTargetIds) {
      const source = root?.userData[kickTargetSourceKeys[targetId]] as
        Object3D | undefined;
      const debugMesh = this.kickPadDebugMeshes[targetId];
      debugMesh.visible = Boolean(source);
      if (!source) continue;
      source.getWorldPosition(debugMesh.position);
      source.getWorldQuaternion(debugMesh.quaternion);
      source.getWorldScale(this.worldScale);
      this.kickDebugOffset
        .set(
          0,
          0,
          kickDebugContactVolume.centerOffsetMeters * this.worldScale.z,
        )
        .applyQuaternion(debugMesh.quaternion);
      debugMesh.position.add(this.kickDebugOffset);
      debugMesh.scale.copy(this.worldScale);
      visibleCount += 1;
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

  private processKickRecognition(
    time: number,
    depthTexture: Texture,
    depthData: XRWebGLDepthInformation,
    camera: PerspectiveCamera,
  ) {
    const timestampUs = Math.round(time * 1_000_000);
    const opponent = this.queries.opponents.entities.values().next().value;
    const root = opponent?.object3D;
    if (!root) return undefined;
    const results = {} as Record<KickTargetId, KickTargetDepthMaskResult>;
    const targets = {} as Record<KickTargetId, Object3D>;
    for (const targetId of kickTargetIds) {
      const target = root.userData[kickTargetSourceKeys[targetId]] as
        Object3D | undefined;
      if (!target) return undefined;
      const result = this.kickTargetMasks[targetId].process({
        depthTexture,
        depthData,
        camera,
        target,
        timestampUs,
      });
      if (!result) return undefined;
      targets[targetId] = target;
      results[targetId] = result;
    }
    const previousLock = this.kickTargetLock;
    const decisions: Partial<Record<KickTargetId, KickRecognitionDecision>> =
      {};
    for (const targetId of kickTargetIds) {
      const decision = this.processKickTarget(
        targetId,
        results[targetId],
        targets[targetId],
        timestampUs,
      );
      if (decision) decisions[targetId] = decision;
    }
    let selectedTarget =
      previousLock &&
      (isKickTargetEngaged(this.kickRecognizers[previousLock]) ||
        decisions[previousLock])
        ? previousLock
        : undefined;
    let selectedRank = selectedTarget
      ? kickMotionRank(results[selectedTarget].evidence)
      : Number.NEGATIVE_INFINITY;
    if (!selectedTarget) {
      for (const targetId of kickTargetIds) {
        if (
          !isKickTargetEngaged(this.kickRecognizers[targetId]) &&
          !decisions[targetId]
        ) {
          continue;
        }
        const rank = kickMotionRank(results[targetId].evidence);
        if (rank > selectedRank) {
          selectedTarget = targetId;
          selectedRank = rank;
        }
      }
    }
    this.kickTargetLock =
      selectedTarget &&
      isKickTargetEngaged(this.kickRecognizers[selectedTarget])
        ? selectedTarget
        : undefined;
    const decision = selectedTarget ? decisions[selectedTarget] : undefined;
    this.emitKickTelemetry(results, timestampUs, decision);
    if (decision?.targetId === this.kickTargetLock) {
      this.kickTargetLock = undefined;
    }
    return decision;
  }

  private emitKickTelemetry(
    results: Readonly<Record<KickTargetId, KickTargetDepthMaskResult>>,
    timestampUs: number,
    decision?: KickRecognitionDecision,
  ) {
    if (this.snapshot?.physicalContactDiagnosticsEnabled !== true) return;
    for (const targetId of kickTargetIds) {
      const result = results[targetId];
      const emission = this.kickTelemetry.capture(
        kickTelemetrySnapshot(
          targetId,
          timestampUs,
          result.evidence,
          result.targetMotionMps,
          this.kickRecognizers[targetId].contactState,
          this.kickTargetLock,
          decision?.targetId === targetId ? decision.rejectReason : undefined,
        ),
      );
      if (emission) console.info("[kick-telemetry]", emission);
    }
  }

  private processKickTarget(
    targetId: KickTargetId,
    result: KickTargetDepthMaskResult,
    target: Object3D,
    timestampUs: number,
  ) {
    const hands: Partial<Record<"left" | "right", KickTrackedPose>> = {};
    if (this.leftInputActive) {
      hands.left = trackedPoseTargetLocal(
        this.leftInputPosition,
        target,
        this.leftInputTargetLocal,
        timestampUs,
      );
    }
    if (this.rightInputActive) {
      hands.right = trackedPoseTargetLocal(
        this.rightInputPosition,
        target,
        this.rightInputTargetLocal,
        timestampUs,
      );
    }
    return this.kickRecognizers[targetId].process({
      targetId,
      timestampUs,
      depth: result.evidence,
      targetMotionMps: result.targetMotionMps,
      hands,
    });
  }

  private handleKickDecision(decision: KickRecognitionDecision, time: number) {
    this.acceptedDiagnosticUntil = time + 1.5;
    const targetLabel = decision.targetId.replace(/-/g, " ").toUpperCase();
    const policy = resolveKickImpactPolicy(decision);
    if (policy.kind === "rejection-diagnostic") {
      this.publishDiagnostic(
        "contact",
        `KICK REJECTED · ${targetLabel} · ${decision.rejectReason?.replace(/-/g, " ").toUpperCase() ?? "UNKNOWN"}`,
      );
      console.info("[kick-recognition] rejected", decision);
      return;
    }
    const simulation = this.simulation;
    if (!simulation) return;
    const opponent = this.queries.opponents.entities.values().next().value;
    const target = opponent?.object3D?.userData[
      kickTargetSourceKeys[decision.targetId]
    ] as Object3D | undefined;
    if (!target) return;
    target.getWorldPosition(this.kickImpactCenter);
    this.camera.getWorldPosition(this.direction);
    this.direction.copy(this.kickImpactCenter).sub(this.direction).normalize();
    const region = kickTargetRegions[decision.targetId];
    const damage = calculateDamage({
      speed: Math.min(decision.speedMps, 8),
      type: "front-kick",
      hitRegion: region,
      guarded: false,
      combo: 0,
      difficulty: 1,
      safetyMaximum: 42,
    });
    for (const entity of this.queries.opponents.entities) {
      if (entity.object3D) entity.object3D.userData.hitFlashUntil = time + 0.14;
    }
    simulation.applyPlayerImpact(damage, {
      source: "kick",
      region,
      direction: [this.direction.x, this.direction.y, this.direction.z],
      speed: decision.speedMps,
      confidence: decision.confidence,
      timestamp: time,
    });
    this.publishDiagnostic(
      "accepted",
      `KICK ACCEPTED · ${targetLabel} · ${decision.speedMps.toFixed(1)}M/S`,
    );
    console.info("[kick-recognition] accepted", {
      ...decision,
      policy,
      damage,
    });
  }

  private resetKickRecognition() {
    this.kickTargetLock = undefined;
    for (const targetId of kickTargetIds) {
      this.kickTargetMasks[targetId].reset();
      this.kickRecognizers[targetId].reset();
    }
    this.kickTelemetry.reset();
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

function kickMotionRank(evidence: KickDepthEvidence) {
  return (
    evidence.localizedApproachSampleCount * 1_000 +
    evidence.localizedApproachSpeedMps
  );
}

function isKickTargetEngaged(recognizer: KickRecognitionEngine) {
  return (
    recognizer.contactState === "APPROACHING" ||
    recognizer.contactState === "CONTACT"
  );
}

function trackedPoseTargetLocal(
  position: Vector3,
  target: Object3D,
  targetLocal: Vector3,
  timestampUs: number,
): KickTrackedPose {
  targetLocal.copy(position);
  target.worldToLocal(targetLocal);
  return {
    position: [targetLocal.x, targetLocal.y, targetLocal.z],
    timestampUs,
    trackingQuality: 1,
  };
}

function createKickPadDebugMaterial(color: number) {
  return new MeshBasicMaterial({
    name: "KickPadDebug",
    color,
    transparent: true,
    opacity: 0.8,
    wireframe: true,
    depthTest: false,
    depthWrite: false,
  });
}

function createKickPadDebugGeometry() {
  const geometry = new CylinderGeometry(
    kickDebugContactVolume.diameterMeters * 0.5,
    kickDebugContactVolume.diameterMeters * 0.5,
    kickDebugContactVolume.depthMeters,
    16,
    4,
    false,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
