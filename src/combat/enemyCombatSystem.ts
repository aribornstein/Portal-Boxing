import { AudioUtils, createSystem, MathUtils, Vector3 } from "@iwsdk/core";
import type { Mesh, Object3D } from "@iwsdk/core";

import {
  createEnemyBehaviorScores,
  selectEnemyBehaviorInto,
  type EnemyBehavior,
  type EnemyBehaviorScores,
  type EnemyPerception,
} from "../ai/enemyDecision.js";
import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import type { EnemyArchetype } from "../generation/stageGenerator.js";
import { OpponentVisual } from "../gameplay/presentationSystem.js";
import {
  distanceToNearestObstacle,
  opponentSpacingDirection,
  resolveObstacleAwareStepInto,
  type PlanarStep,
} from "./obstacleSteering.js";
import { enemyStrikeConnects } from "./enemyStrikeContact.js";
import { combatInputMode } from "./combatInputMode.js";

type AttackPhase = "idle" | "windup" | "strike" | "recover";

interface EnemyRuntimeState {
  phase: AttackPhase;
  phaseEndsAt: number;
  lastAttackTime: number;
  nextDecisionTime: number;
  behavior: EnemyBehavior;
  readonly perception: MutableEnemyPerception;
  readonly scores: EnemyBehaviorScores;
}

type MutableEnemyPerception = {
  -readonly [Key in keyof EnemyPerception]: EnemyPerception[Key];
};

const runtimeStateKey = "enemyCombatRuntime";
const attackWindupSeconds = 0.65;
const attackDurationSeconds = 0.14;
const recoverySeconds = 0.7;
const guardRadius = 0.48;
const opponentRadius = 0.32;
const opponentApproachDistance = 1.05;
const bossApproachDistance = 1.25;
const opponentStrikeContactRadius = 0.6;
const bossStrikeContactRadius = 0.7;
const diagnosticTargetDistanceMeters = 1.2;

export class EnemyCombatSystem extends createSystem({
  opponents: { required: [OpponentVisual] },
}) {
  private simulation: GameSimulation | undefined;
  private snapshot: SimulationSnapshot | undefined;
  private readonly playerPosition = new Vector3();
  private readonly leftHandPosition = new Vector3();
  private readonly rightHandPosition = new Vector3();
  private readonly enemyGlovePosition = new Vector3();
  private readonly movementDirection = new Vector3();
  private readonly diagnosticAnchor = new Vector3();
  private readonly movementStep: PlanarStep = { x: 0, z: 0 };
  private diagnosticAnchorReady = false;

  init() {
    this.simulation = this.globals.portalBoxingSimulation as
      GameSimulation | undefined;
    if (this.simulation) {
      this.cleanupFuncs.push(
        this.simulation.subscribe((snapshot) => {
          this.snapshot = snapshot;
        }),
      );
    }
    this.queries.opponents.subscribe("qualify", (entity) => {
      const root = entity.object3D;
      if (!root) return;
      root.userData[runtimeStateKey] = createRuntimeState();
    });
  }

  setPhysicalContactDiagnostics(enabled: boolean) {
    this.diagnosticAnchorReady = false;
    this.simulation?.setPhysicalContactDiagnostics(enabled);
  }

  get isPhysicalContactDiagnosticsEnabled() {
    return this.snapshot?.physicalContactDiagnosticsEnabled ?? false;
  }

  update(delta: number, time: number) {
    const simulation = this.simulation;
    const snapshot = this.snapshot;
    if (!simulation || !snapshot) return;
    const combatActive =
      snapshot.application === "PLAYING" &&
      (snapshot.encounter === "COMBAT" || snapshot.encounter === "BOSS_COMBAT");
    if (!combatActive) {
      simulation.setPlayerGuarding(false);
      for (const entity of this.queries.opponents.entities) {
        if (entity.object3D) this.resetVisualState(entity.object3D);
      }
      return;
    }

    this.camera.getWorldPosition(this.playerPosition);
    if (snapshot.physicalContactDiagnosticsEnabled) {
      simulation.setPlayerGuarding(false);
      this.updatePhysicalContactDiagnostics();
      return;
    }
    this.diagnosticAnchorReady = false;
    simulation.setPlayerGuarding(this.readGuarding());
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      if (!root.userData.emergenceComplete) {
        const state = root.userData[runtimeStateKey] as
          EnemyRuntimeState | undefined;
        if (state) {
          state.phase = "idle";
          state.behavior = "approach";
          state.nextDecisionTime = Number.POSITIVE_INFINITY;
        }
        this.setTelegraph(root, false);
        continue;
      }
      const state = root.userData[runtimeStateKey] as
        EnemyRuntimeState | undefined;
      if (!state) continue;
      if (state.nextDecisionTime === Number.POSITIVE_INFINITY) {
        state.nextDecisionTime = time;
      }
      const archetype = (entity.getValue(OpponentVisual, "archetype") ??
        "striker") as EnemyArchetype;
      this.updateOpponent(
        root,
        state,
        archetype,
        snapshot,
        simulation,
        delta,
        time,
      );
      if (entity.getValue(OpponentVisual, "behavior") !== state.behavior) {
        entity.setValue(OpponentVisual, "behavior", state.behavior);
      }
      const telegraphing = state.phase === "windup";
      if (entity.getValue(OpponentVisual, "telegraphing") !== telegraphing) {
        entity.setValue(OpponentVisual, "telegraphing", telegraphing);
        if (telegraphing) AudioUtils.play(entity);
      }
    }
  }

  private updatePhysicalContactDiagnostics() {
    if (!this.diagnosticAnchorReady) {
      this.camera.getWorldDirection(this.movementDirection);
      this.movementDirection.y = 0;
      if (this.movementDirection.lengthSq() <= 0.0001) {
        this.movementDirection.set(0, 0, -1);
      } else {
        this.movementDirection.normalize();
      }
      this.diagnosticAnchor
        .copy(this.playerPosition)
        .addScaledVector(
          this.movementDirection,
          diagnosticTargetDistanceMeters,
        );
      this.diagnosticAnchor.y = 0;
      this.diagnosticAnchorReady = true;
    }
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      const state = root.userData[runtimeStateKey] as
        EnemyRuntimeState | undefined;
      root.position.copy(this.diagnosticAnchor);
      root.lookAt(
        this.playerPosition.x,
        root.position.y,
        this.playerPosition.z,
      );
      root.userData.impactReaction = undefined;
      if (state) {
        state.phase = "idle";
        state.behavior = "recover";
        state.nextDecisionTime = Number.POSITIVE_INFINITY;
      }
      this.setTelegraph(root, false);
      if (entity.getValue(OpponentVisual, "behavior") !== "recover") {
        entity.setValue(OpponentVisual, "behavior", "recover");
      }
      if (entity.getValue(OpponentVisual, "telegraphing")) {
        entity.setValue(OpponentVisual, "telegraphing", false);
      }
    }
  }

  private updateOpponent(
    root: Object3D,
    state: EnemyRuntimeState,
    archetype: EnemyArchetype,
    snapshot: SimulationSnapshot,
    simulation: GameSimulation,
    delta: number,
    time: number,
  ) {
    const offsetX = this.playerPosition.x - root.position.x;
    const offsetZ = this.playerPosition.z - root.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (state.phase === "idle" && time >= state.nextDecisionTime) {
      const wave =
        snapshot.stage?.waves[
          snapshot.encounter === "BOSS_COMBAT" ? 3 : snapshot.waveIndex
        ];
      const perception = state.perception;
      perception.distanceToPlayer = distance;
      perception.playerGuarding = snapshot.playerGuarding;
      perception.enemyHealthRatio =
        snapshot.encounterHealthMaximum > 0
          ? snapshot.encounterHealth / snapshot.encounterHealthMaximum
          : 1;
      perception.safeTargetAvailable = isInsideSafeZone(
        root.position.x,
        root.position.z,
        snapshot.safeZone,
      );
      perception.obstacleDistance = Math.max(
        0,
        distanceToNearestObstacle(
          root.position.x,
          root.position.z,
          snapshot.navigationObstacles,
        ) - opponentRadius,
      );
      perception.timeSinceAttack = time - state.lastAttackTime;
      perception.attackCooldown = MathUtils.lerp(
        2.6,
        1.25,
        wave?.aggression ?? 0.5,
      );
      state.behavior = selectEnemyBehaviorInto(
        archetype,
        perception,
        state.scores,
      );
      state.nextDecisionTime = time + 0.25;
      if (isAttack(state.behavior)) {
        state.phase = "windup";
        state.phaseEndsAt = time + attackWindupSeconds;
      }
    }

    if (state.phase === "idle") {
      this.updateMovement(root, state, archetype, distance, delta, snapshot);
    } else if (state.phase === "windup") {
      this.setTelegraph(root, true);
      const glove = root.userData.rightGlove as Mesh | undefined;
      if (glove) glove.position.z = 0.08;
      if (time >= state.phaseEndsAt) {
        state.phase = "strike";
        state.phaseEndsAt = time + attackDurationSeconds;
        state.lastAttackTime = time;
        if (glove) {
          glove.position.z = 0.72;
          root.updateMatrixWorld(true);
          glove.getWorldPosition(this.enemyGlovePosition);
          if (
            enemyStrikeConnects(
              this.enemyGlovePosition,
              this.playerPosition,
              archetype === "heavyweight"
                ? bossStrikeContactRadius
                : opponentStrikeContactRadius,
            )
          ) {
            simulation.applyEnemyStrike(attackDamage(archetype));
          }
        }
      }
    } else if (state.phase === "strike") {
      this.setTelegraph(root, false);
      const glove = root.userData.rightGlove as Mesh | undefined;
      if (glove) glove.position.z = 0.72;
      if (time >= state.phaseEndsAt) {
        state.phase = "recover";
        state.phaseEndsAt = time + recoverySeconds;
      }
    } else if (time >= state.phaseEndsAt) {
      state.phase = "idle";
      state.behavior = "recover";
      state.nextDecisionTime = time + 0.2;
    }
  }

  private updateMovement(
    root: Object3D,
    state: EnemyRuntimeState,
    archetype: EnemyArchetype,
    distance: number,
    delta: number,
    snapshot: SimulationSnapshot,
  ) {
    const offsetX = this.playerPosition.x - root.position.x;
    const offsetZ = this.playerPosition.z - root.position.z;
    const boss = archetype === "heavyweight";
    const spacingDirection = opponentSpacingDirection(
      distance,
      boss ? bossApproachDistance : opponentApproachDistance,
    );
    if (state.behavior === "approach") {
      if (spacingDirection <= 0) return;
      this.movementDirection.set(offsetX, 0, offsetZ).normalize();
    } else if (state.behavior === "retreat") {
      return;
    } else if (state.behavior === "circle") {
      this.movementDirection.set(-offsetZ, 0, offsetX).normalize();
    } else if (state.behavior === "return-to-zone" && snapshot.safeZone) {
      this.movementDirection
        .set(
          snapshot.safeZone.center[0] - root.position.x,
          0,
          snapshot.safeZone.center[2] - root.position.z,
        )
        .normalize();
    } else {
      return;
    }
    const speed =
      0.45 * (snapshot.stage?.waves[snapshot.waveIndex]?.speedModifier ?? 1);
    const canMove = resolveObstacleAwareStepInto(
      root.position.x,
      root.position.z,
      this.movementDirection.x,
      this.movementDirection.z,
      speed * delta,
      opponentRadius,
      snapshot.navigationObstacles,
      snapshot.safeZone,
      this.movementStep,
    );
    if (canMove) {
      root.position.x = this.movementStep.x;
      root.position.z = this.movementStep.z;
    }
    root.lookAt(this.playerPosition.x, root.position.y, this.playerPosition.z);
  }

  private readGuarding() {
    if (
      !this.readCombatInputPosition("left", this.leftHandPosition) ||
      !this.readCombatInputPosition("right", this.rightHandPosition)
    ) {
      return false;
    }
    return (
      this.leftHandPosition.distanceToSquared(this.playerPosition) <=
        guardRadius * guardRadius &&
      this.rightHandPosition.distanceToSquared(this.playerPosition) <=
        guardRadius * guardRadius
    );
  }

  private readCombatInputPosition(
    handedness: "left" | "right",
    output: Vector3,
  ) {
    const inputMode = combatInputMode(
      this.input.xr.getPrimaryInputSource(handedness),
    );
    if (inputMode === "none") return false;
    const poseSpace =
      inputMode === "hand"
        ? this.player.indexTipSpaces[handedness]
        : this.player.gripSpaces[handedness];
    poseSpace.getWorldPosition(output);
    return true;
  }

  private resetVisualState(root: Object3D) {
    const state = root.userData[runtimeStateKey] as
      EnemyRuntimeState | undefined;
    if (state) state.phase = "idle";
    this.setTelegraph(root, false);
  }

  private setTelegraph(root: Object3D, visible: boolean) {
    const telegraph = root.userData.attackTelegraph as Mesh | undefined;
    if (telegraph) telegraph.visible = visible;
  }
}

function createRuntimeState(): EnemyRuntimeState {
  return {
    phase: "idle",
    phaseEndsAt: 0,
    lastAttackTime: Number.NEGATIVE_INFINITY,
    nextDecisionTime: 0,
    behavior: "approach",
    perception: {
      distanceToPlayer: Number.POSITIVE_INFINITY,
      relativeAngle: 0,
      playerHandSpeed: 0,
      playerGuarding: false,
      enemyHealthRatio: 1,
      enemyStaminaRatio: 1,
      enemyPoiseRatio: 1,
      safeTargetAvailable: true,
      obstacleDistance: Number.POSITIVE_INFINITY,
      allyDistance: Number.POSITIVE_INFINITY,
      timeSinceAttack: Number.POSITIVE_INFINITY,
      attackCooldown: 2,
    },
    scores: createEnemyBehaviorScores(),
  };
}

function isAttack(behavior: EnemyBehavior) {
  return (
    behavior === "jab" ||
    behavior === "cross" ||
    behavior === "hook" ||
    behavior === "body-attack" ||
    behavior === "combo" ||
    behavior === "counterattack"
  );
}

function attackDamage(archetype: EnemyArchetype) {
  if (archetype === "heavyweight") return 24;
  if (archetype === "bruiser") return 18;
  if (archetype === "guard") return 12;
  return 10;
}

function isInsideSafeZone(
  x: number,
  z: number,
  safeZone: SimulationSnapshot["safeZone"],
) {
  if (!safeZone) return false;
  return (
    Math.abs(x - safeZone.center[0]) <= safeZone.halfExtents[0] &&
    Math.abs(z - safeZone.center[2]) <= safeZone.halfExtents[2]
  );
}
