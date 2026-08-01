import { createSystem, Vector3 } from "@iwsdk/core";
import type { Mesh, Object3D } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import { OpponentVisual } from "../gameplay/presentationSystem.js";
import { DepthSafetySystem } from "../xr/depthSafetySystem.js";
import { combatInputMode, type CombatInputMode } from "./combatInputMode.js";
import { calculateDamage } from "./combatTracking.js";

type Handedness = "left" | "right";

interface HandMotionState {
  readonly position: Vector3;
  readonly previous: Vector3;
  readonly velocity: Vector3;
  initialized: boolean;
  lastTime: number;
  lastHitTime: number;
  contactActive: boolean;
  inputMode: CombatInputMode;
}

const minimumStrikeSpeed = 1.15;
const handContactRadius = 0.34;
const controllerContactRadius = 0.34;
const cooldownSeconds = 0.22;

export class HandCombatSystem extends createSystem({
  opponents: { required: [OpponentVisual] },
}) {
  private simulation: GameSimulation | undefined;
  private depthSafety: DepthSafetySystem | undefined;
  private snapshot: SimulationSnapshot | undefined;
  private readonly targetPosition = new Vector3();
  private readonly targetDirection = new Vector3();
  private contactRoot: Object3D | undefined;
  private contactRegion: "head" | "torso" = "torso";
  private contactDistance = Number.POSITIVE_INFINITY;
  private readonly left = createHandState();
  private readonly right = createHandState();

  init() {
    this.depthSafety = this.world.getSystem(DepthSafetySystem);
    this.simulation = this.globals.portalBoxingSimulation as
      GameSimulation | undefined;
    if (this.simulation) {
      this.cleanupFuncs.push(
        this.simulation.subscribe((snapshot) => {
          this.snapshot = snapshot;
        }),
      );
    }
  }

  update(_delta: number, time: number) {
    const simulation = this.simulation;
    const snapshot = this.snapshot;
    if (
      !simulation ||
      !snapshot ||
      snapshot.application !== "PLAYING" ||
      snapshot.physicalContactDiagnosticsEnabled ||
      (snapshot.encounter !== "COMBAT" && snapshot.encounter !== "BOSS_COMBAT")
    ) {
      this.resetHand(this.left);
      this.resetHand(this.right);
      return;
    }
    this.sampleHand("left", this.left, time, simulation);
    this.sampleHand("right", this.right, time, simulation);
  }

  private sampleHand(
    handedness: Handedness,
    state: HandMotionState,
    time: number,
    simulation: GameSimulation,
  ) {
    const inputSource = this.input.xr.getPrimaryInputSource(handedness);
    const inputMode = combatInputMode(inputSource);
    if (inputMode === "none") {
      this.resetHand(state);
      return;
    }
    if (state.inputMode !== inputMode) {
      this.resetHand(state);
      state.inputMode = inputMode;
    }
    const poseSpace =
      inputMode === "hand"
        ? this.player.indexTipSpaces[handedness]
        : this.player.gripSpaces[handedness];
    poseSpace.getWorldPosition(state.position);
    if (!state.initialized || time <= state.lastTime) {
      state.previous.copy(state.position);
      state.lastTime = time;
      state.initialized = true;
      return;
    }
    const inverseDeltaSeconds = 1 / (time - state.lastTime);
    state.velocity
      .copy(state.position)
      .sub(state.previous)
      .multiplyScalar(inverseDeltaSeconds);
    state.previous.copy(state.position);
    state.lastTime = time;

    if (
      !this.findContact(
        state.position,
        inputMode === "hand" ? handContactRadius : controllerContactRadius,
      )
    ) {
      state.contactActive = false;
      return;
    }
    const speed = state.velocity.length();
    this.targetDirection.copy(this.targetPosition).sub(state.position);
    const movingTowardTarget = state.velocity.dot(this.targetDirection) > 0;
    if (
      state.contactActive ||
      speed < minimumStrikeSpeed ||
      !movingTowardTarget ||
      (this.depthSafety !== undefined &&
        !this.depthSafety.isStrikePathClear(
          state.position,
          this.targetPosition,
          time,
        )) ||
      time - state.lastHitTime < cooldownSeconds
    ) {
      return;
    }
    state.contactActive = true;
    state.lastHitTime = time;
    const damage = calculateDamage({
      speed: Math.min(speed, 8),
      type: handedness === "left" ? "jab" : "cross",
      hitRegion: this.contactRegion,
      guarded: false,
      combo: 0,
      difficulty: 1,
      safetyMaximum: 32,
    });
    this.contactRoot!.userData.hitFlashUntil = time + 0.11;
    this.targetDirection.copy(state.velocity).normalize();
    simulation.applyPlayerImpact(damage, {
      source: "punch",
      region: this.contactRegion,
      direction: [
        this.targetDirection.x,
        this.targetDirection.y,
        this.targetDirection.z,
      ],
      speed,
      confidence: 1,
      timestamp: time,
    });
  }

  private findContact(position: Vector3, contactRadius: number) {
    this.contactRoot = undefined;
    this.contactDistance = Number.POSITIVE_INFINITY;
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      const head = root.userData.head as Mesh | undefined;
      const torso = root.userData.torso as Mesh | undefined;
      if (head) {
        head.getWorldPosition(this.targetPosition);
        const distance = position.distanceTo(this.targetPosition);
        if (distance <= contactRadius && distance < this.contactDistance) {
          this.contactRoot = root;
          this.contactRegion = "head";
          this.contactDistance = distance;
        }
      }
      if (torso) {
        torso.getWorldPosition(this.targetPosition);
        const distance = position.distanceTo(this.targetPosition);
        if (
          distance <= contactRadius + 0.08 &&
          distance < this.contactDistance
        ) {
          this.contactRoot = root;
          this.contactRegion = "torso";
          this.contactDistance = distance;
        }
      }
    }
    if (this.contactRoot) {
      const target =
        this.contactRegion === "head"
          ? (this.contactRoot.userData.head as Mesh)
          : (this.contactRoot.userData.torso as Mesh);
      target.getWorldPosition(this.targetPosition);
    }
    return Boolean(this.contactRoot);
  }

  private resetHand(state: HandMotionState) {
    state.initialized = false;
    state.contactActive = false;
    state.velocity.set(0, 0, 0);
  }
}

function createHandState(): HandMotionState {
  return {
    position: new Vector3(),
    previous: new Vector3(),
    velocity: new Vector3(),
    initialized: false,
    lastTime: 0,
    lastHitTime: Number.NEGATIVE_INFINITY,
    contactActive: false,
    inputMode: "none",
  };
}
