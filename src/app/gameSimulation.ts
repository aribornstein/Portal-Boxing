import { bossPhase } from "../ai/enemyDecision.js";
import type { CombatImpact } from "../combat/combatImpact.js";
import {
  generateStage,
  type StageManifest,
} from "../generation/stageGenerator.js";
import {
  validatePortalSurface,
  type PortalCandidate,
} from "../portal/portalCandidateService.js";
import {
  calculateSafeZone,
  createObservation,
  mergeDuplicateSurfaces,
  type Bounds3,
  type RoomObservation,
  type SafeZone,
  type Vec3,
} from "../room/roomUnderstanding.js";
import {
  ApplicationState,
  applicationTransitions,
  EncounterState,
  encounterTransitions,
  StateMachine,
  type TransitionRecord,
} from "../state/stateMachine.js";

export interface SimulationSnapshot {
  readonly application: ApplicationState;
  readonly encounter: EncounterState;
  readonly stage?: StageManifest;
  readonly waveIndex: number;
  readonly bossPhase: 1 | 2 | 3;
  readonly encounterHealth: number;
  readonly encounterHealthMaximum: number;
  readonly playerHealth: number;
  readonly playerHealthMaximum: number;
  readonly playerGuarding: boolean;
  readonly physicalContactDiagnosticsEnabled: boolean;
  readonly activePortalIndex: number;
  readonly score: number;
  readonly safeZone?: SafeZone;
  readonly navigationObstacles: readonly Bounds3[];
  readonly safetyReady: boolean;
  readonly safetyBypassEnabled: boolean;
  readonly semanticConfirmed: boolean;
  readonly status: string;
  readonly latestImpact?: CombatImpact & { readonly sequence: number };
}

export class GameSimulation {
  readonly application = new StateMachine(
    ApplicationState.Boot,
    applicationTransitions,
  );
  readonly encounter = new StateMachine(
    EncounterState.Idle,
    encounterTransitions,
  );
  private readonly observers = new Set<
    (snapshot: SimulationSnapshot) => void
  >();
  private stage: StageManifest | undefined;
  private stageNumber = 0;
  private waveIndex = -1;
  private bossHealthRatio = 1;
  private encounterHealth = 0;
  private encounterHealthMaximum = 0;
  private playerHealth = 100;
  private readonly playerHealthMaximum = 100;
  private playerGuarding = false;
  private physicalContactDiagnosticsEnabled = false;
  private pauseIsResumable = false;
  private score = 0;
  private safeZone: SafeZone | undefined;
  private navigationObstacles: readonly Bounds3[] = [];
  private safetyReady = false;
  private safetyBypassEnabled = false;
  private roomSafe = false;
  private semanticConfirmed = false;
  private status = "Runtime booting";
  private latestImpact:
    (CombatImpact & { readonly sequence: number }) | undefined;
  private impactSequence = 0;
  private portals: readonly PortalCandidate[] = [];
  private roomSnapshotHash = "unscanned-room";

  constructor(debugLogging = true) {
    const log = (transition: TransitionRecord<string>) => {
      if (debugLogging)
        console.info(
          `[state] ${transition.from} -> ${transition.to}: ${transition.reason}`,
        );
      this.notify();
    };
    this.application.subscribe(log);
    this.encounter.subscribe(log);
  }

  get snapshot(): SimulationSnapshot {
    return {
      application: this.application.state,
      encounter: this.encounter.state,
      stage: this.stage,
      waveIndex: this.waveIndex,
      bossPhase: bossPhase(this.bossHealthRatio),
      encounterHealth: this.encounterHealth,
      encounterHealthMaximum: this.encounterHealthMaximum,
      playerHealth: this.playerHealth,
      playerHealthMaximum: this.playerHealthMaximum,
      playerGuarding: this.playerGuarding,
      physicalContactDiagnosticsEnabled: this.physicalContactDiagnosticsEnabled,
      activePortalIndex: activePortalIndex(
        this.waveIndex,
        this.encounter.state === EncounterState.BossCombat,
        this.stage?.portalPlacements.length ?? 0,
      ),
      score: this.score,
      safeZone: this.safeZone,
      navigationObstacles: this.navigationObstacles,
      safetyReady: this.safetyReady,
      safetyBypassEnabled: this.safetyBypassEnabled,
      semanticConfirmed: this.semanticConfirmed,
      status: this.status,
      latestImpact: this.latestImpact,
    };
  }

  subscribe(observer: (snapshot: SimulationSnapshot) => void) {
    this.observers.add(observer);
    observer(this.snapshot);
    return () => this.observers.delete(observer);
  }

  markRuntimeReady() {
    this.application.transition(
      ApplicationState.LoadingRuntime,
      "IWSDK bootstrap started",
    );
    this.application.transition(
      ApplicationState.LoadingAssets,
      "Local manifest checked",
    );
    this.application.transition(
      ApplicationState.LoadingModels,
      "Optional model artifact checked",
    );
    this.application.transition(
      ApplicationState.Ready,
      "Core runtime ready; vision model capability-gated",
    );
    this.status = "Ready for room setup";
    this.notify();
  }

  enterRoomSetup(reason = "Desktop simulation entered") {
    if (this.application.state === ApplicationState.SessionEnded)
      this.application.transition(ApplicationState.Ready, "Session reset");
    this.application.transition(ApplicationState.EnteringXR, reason);
    this.application.transition(
      ApplicationState.ScanningRoom,
      "Room scan started",
    );
    this.status = "Scanning room fixture";
    this.notify();
  }

  loadRoomFixture() {
    this.requireApplication(ApplicationState.ScanningRoom);
    const observations = [
      createObservation(
        "floor",
        "floor",
        [0, 0, 0],
        [4.4, 0.05, 4.4],
        [0, 1, 0],
        "plane",
        1,
      ),
      createObservation(
        "east-wall",
        "wall",
        [2.2, 1.25, 0],
        [3.2, 2.5, 0.05],
        [-1, 0, 0],
        "plane",
        1,
      ),
      createObservation(
        "north-wall",
        "wall",
        [0, 1.25, -2.2],
        [3.6, 2.5, 0.05],
        [0, 0, 1],
        "plane",
        1,
      ),
    ];
    this.processRoomObservations(
      observations,
      [0, 1.6, 0],
      "synthetic-room-v1",
      "Synthetic planes, meshes, and depth loaded",
    );
  }

  loadRoomObservations(
    observations: readonly RoomObservation[],
    playerPosition: Vec3,
    roomSnapshotHash = roomObservationHash(observations),
  ) {
    this.requireApplication(ApplicationState.ScanningRoom);
    if (observations.length === 0)
      throw new Error("No live room geometry is available");
    this.processRoomObservations(
      observations,
      playerPosition,
      roomSnapshotHash,
      "Live IWSDK planes and meshes captured",
    );
  }

  private processRoomObservations(
    observations: readonly RoomObservation[],
    playerPosition: Vec3,
    roomSnapshotHash: string,
    transitionReason: string,
  ) {
    this.application.transition(
      ApplicationState.ProcessingRoom,
      transitionReason,
    );
    const merged = mergeDuplicateSurfaces(observations);
    const floor = merged.find((observation) => observation.label === "floor");
    const obstacles = merged.filter(
      (observation) =>
        observation.label !== "floor" &&
        observation.label !== "wall" &&
        observation.label !== "ceiling",
    );
    const safeZone = calculateSafeZone(floor, obstacles);
    this.safeZone = safeZone;
    this.navigationObstacles = obstacles
      .filter((obstacle) => obstacle.trackingConfidence > 0.5)
      .map((obstacle) => obstacle.bounds);
    const portals: PortalCandidate[] = [];
    for (const surface of merged) {
      const result = validatePortalSurface(
        surface,
        playerPosition,
        obstacles,
        portals,
      );
      if (result.candidate) portals.push(result.candidate);
    }
    this.portals = portals;
    this.roomSafe = safeZone.reasons.length === 0 && portals.length > 0;
    this.roomSnapshotHash = roomSnapshotHash;
    this.application.transition(
      ApplicationState.SemanticReview,
      "Room geometry processed with review-required labels",
    );
    this.status = this.roomSafe
      ? `Review ${merged.length} room surfaces and confirm the safety zone`
      : [...safeZone.reasons, portals.length === 0 ? "No safe portal wall" : ""]
          .filter(Boolean)
          .join("; ");
    this.notify();
  }

  confirmRoomSafety() {
    this.requireApplication(ApplicationState.SemanticReview);
    if (!this.roomSafe && !this.safetyBypassEnabled)
      throw new Error("Room safety requirements are not satisfied");
    this.semanticConfirmed = !this.safetyBypassEnabled;
    this.application.transition(
      ApplicationState.Calibrating,
      this.safetyBypassEnabled
        ? "DEBUG ONLY: room safety bypassed"
        : "Semantic labels confirmed",
    );
    this.safetyReady = !this.safetyBypassEnabled;
    this.application.transition(
      ApplicationState.GeneratingStage,
      this.safetyBypassEnabled
        ? "Debug fixture accepted without room safety"
        : "Safe zone inspected and confirmed",
    );
    this.generateNextStage();
    if (this.safetyBypassEnabled) {
      this.status = "DEBUG BYPASS ACTIVE: room safety is not validated";
      this.notify();
    }
  }

  setSafetyBypass(enabled: boolean) {
    if (
      ![
        ApplicationState.Ready,
        ApplicationState.EnteringXR,
        ApplicationState.ScanningRoom,
        ApplicationState.ProcessingRoom,
        ApplicationState.SemanticReview,
      ].includes(this.application.state)
    ) {
      throw new Error("Room safety bypass can only change during setup");
    }
    this.safetyBypassEnabled = enabled;
    this.status = enabled
      ? "DEBUG BYPASS ENABLED: continue without room safety"
      : "Room safety requirements restored";
    this.notify();
  }

  continueWithoutRoomSafety() {
    if (!this.safetyBypassEnabled)
      throw new Error("Enable the debug room safety bypass first");
    if (this.application.state === ApplicationState.ScanningRoom) {
      this.loadRoomFixture();
    }
    this.requireApplication(ApplicationState.SemanticReview);
    if (this.portals.length === 0) {
      throw new Error("Debug continuation still requires a portal surface");
    }
    this.confirmRoomSafety();
  }

  openPortal() {
    this.requireApplication(ApplicationState.StageReady);
    this.application.transition(ApplicationState.Playing, "Stage started");
    this.encounter.transition(
      EncounterState.PortalCharging,
      "Portal energy stable",
    );
    this.encounter.transition(
      EncounterState.PortalOpening,
      "Portal opening animation complete",
    );
    this.startNextWave();
    this.notify();
  }

  completeCurrentWave() {
    if (this.encounter.state !== EncounterState.Combat)
      throw new Error("No normal wave is in combat");
    this.encounterHealth = 0;
    this.score += 100 * (this.waveIndex + 1);
    this.encounter.transition(
      EncounterState.WaveClear,
      `Wave ${this.waveIndex + 1} defeated`,
    );
    if (this.waveIndex >= 2) {
      this.encounter.transition(
        EncounterState.BossIntro,
        "Three normal waves complete",
      );
      this.encounter.transition(
        EncounterState.BossCombat,
        "Heavyweight entered through the portal",
      );
      this.setEncounterHealth(3);
      this.status = "Boss phase 1";
    } else {
      this.encounter.transition(
        EncounterState.Intermission,
        "Recovery interval",
      );
      this.startNextWave();
    }
    this.notify();
  }

  advanceBossPhase() {
    if (this.encounter.state !== EncounterState.BossCombat)
      throw new Error("Boss combat is not active");
    this.bossHealthRatio = this.bossHealthRatio > 0.7 ? 0.65 : 0.3;
    this.status = `Boss phase ${bossPhase(this.bossHealthRatio)}`;
    this.notify();
  }

  applyPlayerStrike(damage: number) {
    return this.applyPlayerDamage(damage);
  }

  applyPlayerImpact(damage: number, impact: CombatImpact) {
    return this.applyPlayerDamage(damage, impact);
  }

  private applyPlayerDamage(damage: number, impact?: CombatImpact) {
    if (
      this.encounter.state !== EncounterState.Combat &&
      this.encounter.state !== EncounterState.BossCombat
    ) {
      return false;
    }
    if (!Number.isFinite(damage) || damage <= 0) return false;
    if (impact) {
      this.impactSequence += 1;
      this.latestImpact = { ...impact, sequence: this.impactSequence };
    }
    this.encounterHealth = Math.max(0, this.encounterHealth - damage);
    this.score += Math.max(1, Math.round(damage));
    if (this.encounter.state === EncounterState.BossCombat) {
      this.bossHealthRatio =
        this.encounterHealthMaximum > 0
          ? this.encounterHealth / this.encounterHealthMaximum
          : 0;
    }
    if (this.encounterHealth === 0) {
      if (this.encounter.state === EncounterState.BossCombat) this.defeatBoss();
      else this.completeCurrentWave();
    } else {
      this.status = `${this.encounter.state === EncounterState.BossCombat ? "Boss" : "Wave"} hit: ${Math.ceil(this.encounterHealth)} HP remaining`;
      this.notify();
    }
    return true;
  }

  setPlayerGuarding(guarding: boolean) {
    if (this.playerGuarding === guarding) return;
    this.playerGuarding = guarding;
    this.notify();
  }

  setPhysicalContactDiagnostics(enabled: boolean) {
    if (this.physicalContactDiagnosticsEnabled === enabled) return;
    this.physicalContactDiagnosticsEnabled = enabled;
    this.status = enabled
      ? "Kick test mode: opponent held in place"
      : "Kick test mode ended";
    this.notify();
  }

  applyEnemyStrike(damage: number, guarded = this.playerGuarding) {
    if (
      this.application.state !== ApplicationState.Playing ||
      (this.encounter.state !== EncounterState.Combat &&
        this.encounter.state !== EncounterState.BossCombat)
    ) {
      return false;
    }
    if (this.physicalContactDiagnosticsEnabled) return false;
    if (!Number.isFinite(damage) || damage <= 0) return false;
    const appliedDamage = Math.max(
      1,
      Math.round(damage * (guarded ? 0.25 : 1)),
    );
    this.playerHealth = Math.max(0, this.playerHealth - appliedDamage);
    if (this.playerHealth === 0) {
      this.pauseIsResumable = false;
      this.application.transition(
        ApplicationState.Paused,
        "Player health depleted",
      );
      this.status = "Knocked out. Restart when the combat zone is clear.";
    } else {
      this.status = guarded
        ? `Guard absorbed the attack: ${this.playerHealth} HP remaining`
        : `Opponent hit: ${this.playerHealth} HP remaining`;
    }
    this.notify();
    return true;
  }

  defeatBoss() {
    if (this.encounter.state !== EncounterState.BossCombat)
      throw new Error("Boss combat is not active");
    this.bossHealthRatio = 0;
    this.encounterHealth = 0;
    this.score += 1000;
    this.encounter.transition(
      EncounterState.BossDefeated,
      "Heavyweight defeated",
    );
    this.encounter.transition(
      EncounterState.StageClear,
      "Boss defeat triggered stage clear",
    );
    this.status = "Stage clear. Opening the next portal.";
    this.notify();
    this.nextStage();
    this.openPortal();
  }

  nextStage() {
    if (this.encounter.state !== EncounterState.StageClear)
      throw new Error("Current stage is not clear");
    this.application.transition(
      ApplicationState.GeneratingStage,
      "Next stage requested",
    );
    this.encounter.transition(
      EncounterState.Restarting,
      "Encounter reset for next stage",
    );
    this.encounter.transition(EncounterState.Idle, "Next stage idle");
    this.generateNextStage();
  }

  restart() {
    if (
      this.encounter.state !== EncounterState.Idle &&
      this.encounter.canTransition(EncounterState.Restarting)
    )
      this.encounter.transition(EncounterState.Restarting, "Emergency restart");
    if (this.encounter.state === EncounterState.Restarting)
      this.encounter.transition(
        EncounterState.Idle,
        "Encounter reset complete",
      );
    if (
      this.application.state !== ApplicationState.SessionEnded &&
      this.application.canTransition(ApplicationState.SessionEnded)
    )
      this.application.transition(
        ApplicationState.SessionEnded,
        "Session restart requested",
      );
    this.stage = undefined;
    this.waveIndex = -1;
    this.bossHealthRatio = 1;
    this.latestImpact = undefined;
    this.encounterHealth = 0;
    this.encounterHealthMaximum = 0;
    this.playerHealth = this.playerHealthMaximum;
    this.playerGuarding = false;
    this.pauseIsResumable = false;
    this.score = 0;
    this.safeZone = undefined;
    this.navigationObstacles = [];
    this.safetyReady = false;
    this.safetyBypassEnabled = false;
    this.roomSafe = false;
    this.semanticConfirmed = false;
    this.roomSnapshotHash = "unscanned-room";
    this.status = "Restarted cleanly";
    this.notify();
  }

  pause(reason = "Emergency stop", resumable = false) {
    if (this.application.state === ApplicationState.Playing) {
      this.pauseIsResumable = resumable;
      this.application.transition(ApplicationState.Paused, reason);
    } else if (!resumable) {
      this.pauseIsResumable = false;
    }
    this.status = reason;
    this.notify();
  }

  resume(reason = "Combat resumed") {
    if (
      this.application.state !== ApplicationState.Paused ||
      !this.pauseIsResumable
    ) {
      return false;
    }
    this.pauseIsResumable = false;
    this.application.transition(ApplicationState.Playing, reason);
    this.status = reason;
    this.notify();
    return true;
  }

  private generateNextStage() {
    this.stageNumber += 1;
    const previousThemes = this.stage ? [this.stage.theme] : [];
    this.stage = generateStage({
      gameVersion: "0.1.0",
      roomSnapshotHash: this.roomSnapshotHash,
      seed: 0x504f5254 + this.stageNumber,
      difficulty: "normal",
      portalCandidates: this.portals,
      previousThemes,
      performanceEnemyCap: 2,
    });
    this.waveIndex = -1;
    this.bossHealthRatio = 1;
    this.application.transition(
      ApplicationState.PlacingPortals,
      "Deterministic stage manifest generated",
    );
    this.application.transition(
      ApplicationState.StageReady,
      `${this.stage.theme} portals placed`,
    );
    this.status = `Stage ${this.stageNumber}: ${this.stage.theme}`;
    this.notify();
  }

  private startNextWave() {
    this.latestImpact = undefined;
    if (
      this.encounter.state === EncounterState.PortalOpening ||
      this.encounter.state === EncounterState.Intermission
    )
      this.encounter.transition(
        EncounterState.WaveAnnouncement,
        `Wave ${this.waveIndex + 2}`,
      );
    this.waveIndex += 1;
    this.setEncounterHealth(this.waveIndex);
    this.encounter.transition(
      EncounterState.Spawning,
      "Spawn clearance and active cap validated",
    );
    this.encounter.transition(
      EncounterState.Combat,
      `Wave ${this.waveIndex + 1} active`,
    );
    this.status = `Wave ${this.waveIndex + 1} combat`;
  }

  private setEncounterHealth(waveIndex: number) {
    const wave = this.stage?.waves[waveIndex];
    const baseHealth = {
      striker: 70,
      guard: 90,
      bruiser: 120,
      heavyweight: 320,
    } as const;
    this.encounterHealthMaximum = Math.round(
      (wave?.enemies.reduce(
        (total, archetype) => total + baseHealth[archetype],
        0,
      ) ?? 0) * (wave?.healthModifier ?? 1),
    );
    this.encounterHealth = this.encounterHealthMaximum;
    if (waveIndex === 3) this.bossHealthRatio = 1;
  }

  private requireApplication(state: ApplicationState) {
    if (this.application.state !== state)
      throw new Error(`Expected ${state}, received ${this.application.state}`);
  }

  private notify() {
    for (const observer of this.observers) observer(this.snapshot);
  }
}

function roomObservationHash(observations: readonly RoomObservation[]) {
  let hash = 0x811c9dc5;
  const signature = observations
    .map((observation) => observation.id)
    .sort()
    .join("|");
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `live-room-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function activePortalIndex(
  waveIndex: number,
  bossCombat: boolean,
  portalCount: number,
) {
  if (!Number.isInteger(portalCount) || portalCount <= 1) return 0;
  const encounterIndex = bossCombat ? 3 : Math.max(0, waveIndex);
  return encounterIndex % portalCount;
}
