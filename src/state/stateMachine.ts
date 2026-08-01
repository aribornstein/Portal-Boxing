export enum ApplicationState {
  Boot = "BOOT",
  LoadingRuntime = "LOADING_RUNTIME",
  LoadingAssets = "LOADING_ASSETS",
  LoadingModels = "LOADING_MODELS",
  Ready = "READY",
  EnteringXR = "ENTERING_XR",
  ScanningRoom = "SCANNING_ROOM",
  ProcessingRoom = "PROCESSING_ROOM",
  SemanticReview = "SEMANTIC_REVIEW",
  Calibrating = "CALIBRATING",
  GeneratingStage = "GENERATING_STAGE",
  PlacingPortals = "PLACING_PORTALS",
  StageReady = "STAGE_READY",
  Playing = "PLAYING",
  Paused = "PAUSED",
  SessionInterrupted = "SESSION_INTERRUPTED",
  SessionEnded = "SESSION_ENDED",
  FatalError = "FATAL_ERROR",
}

export enum EncounterState {
  Idle = "IDLE",
  PortalCharging = "PORTAL_CHARGING",
  PortalOpening = "PORTAL_OPENING",
  WaveAnnouncement = "WAVE_ANNOUNCEMENT",
  Spawning = "SPAWNING",
  Combat = "COMBAT",
  WaveClear = "WAVE_CLEAR",
  Intermission = "INTERMISSION",
  BossIntro = "BOSS_INTRO",
  BossCombat = "BOSS_COMBAT",
  BossDefeated = "BOSS_DEFEATED",
  StageClear = "STAGE_CLEAR",
  Restarting = "RESTARTING",
}

export enum EnemyState {
  Dormant = "DORMANT",
  Emerging = "EMERGING",
  Observing = "OBSERVING",
  Approaching = "APPROACHING",
  Circling = "CIRCLING",
  Guarding = "GUARDING",
  Dodging = "DODGING",
  AttackWindup = "ATTACK_WINDUP",
  Attacking = "ATTACKING",
  Combo = "COMBO",
  Recovering = "RECOVERING",
  Staggered = "STAGGERED",
  KnockedDown = "KNOCKED_DOWN",
  Enraged = "ENRAGED",
  Retreating = "RETREATING",
  Defeated = "DEFEATED",
  Despawning = "DESPAWNING",
}

export enum SemanticObjectState {
  Unobserved = "UNOBSERVED",
  GeometryDetected = "GEOMETRY_DETECTED",
  ClassificationPending = "CLASSIFICATION_PENDING",
  Classified = "CLASSIFIED",
  LowConfidence = "LOW_CONFIDENCE",
  UserConfirmed = "USER_CONFIRMED",
  UserCorrected = "USER_CORRECTED",
  Tracking = "TRACKING",
  Occluded = "OCCLUDED",
  Lost = "LOST",
  Removed = "REMOVED",
}

export interface TransitionRecord<State extends string> {
  readonly from: State;
  readonly to: State;
  readonly reason: string;
  readonly timestamp: number;
}

export type TransitionObserver<State extends string> = (
  transition: TransitionRecord<State>,
) => void;

export class IllegalTransitionError<State extends string> extends Error {
  constructor(
    readonly from: State,
    readonly to: State,
  ) {
    super(`Illegal state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class StateMachine<State extends string> {
  private readonly observers = new Set<TransitionObserver<State>>();
  private readonly transitionHistory: TransitionRecord<State>[] = [];
  private currentState: State;

  constructor(
    initialState: State,
    private readonly transitions: ReadonlyMap<State, ReadonlySet<State>>,
    private readonly historyLimit = 64,
  ) {
    if (historyLimit < 1) {
      throw new RangeError("State-machine history limit must be positive");
    }
    this.currentState = initialState;
  }

  get state(): State {
    return this.currentState;
  }

  get history(): readonly TransitionRecord<State>[] {
    return this.transitionHistory;
  }

  canTransition(to: State): boolean {
    return this.transitions.get(this.currentState)?.has(to) ?? false;
  }

  transition(to: State, reason: string, timestamp = performance.now()) {
    if (!this.canTransition(to)) {
      throw new IllegalTransitionError(this.currentState, to);
    }

    const record: TransitionRecord<State> = {
      from: this.currentState,
      to,
      reason,
      timestamp,
    };
    this.currentState = to;
    this.transitionHistory.push(record);
    if (this.transitionHistory.length > this.historyLimit) {
      this.transitionHistory.shift();
    }
    for (const observer of this.observers) {
      observer(record);
    }
    return record;
  }

  subscribe(observer: TransitionObserver<State>): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }
}

function transitionMap<State extends string>(
  entries: ReadonlyArray<readonly [State, readonly State[]]>,
) {
  return new Map(entries.map(([from, to]) => [from, new Set(to)]));
}

export const applicationTransitions = transitionMap<ApplicationState>([
  [
    ApplicationState.Boot,
    [ApplicationState.LoadingRuntime, ApplicationState.FatalError],
  ],
  [
    ApplicationState.LoadingRuntime,
    [ApplicationState.LoadingAssets, ApplicationState.FatalError],
  ],
  [
    ApplicationState.LoadingAssets,
    [ApplicationState.LoadingModels, ApplicationState.FatalError],
  ],
  [
    ApplicationState.LoadingModels,
    [ApplicationState.Ready, ApplicationState.FatalError],
  ],
  [
    ApplicationState.Ready,
    [ApplicationState.EnteringXR, ApplicationState.FatalError],
  ],
  [
    ApplicationState.EnteringXR,
    [
      ApplicationState.ScanningRoom,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.ScanningRoom,
    [
      ApplicationState.ProcessingRoom,
      ApplicationState.Paused,
      ApplicationState.SessionInterrupted,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.ProcessingRoom,
    [
      ApplicationState.SemanticReview,
      ApplicationState.Paused,
      ApplicationState.SessionInterrupted,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.SemanticReview,
    [
      ApplicationState.Calibrating,
      ApplicationState.Paused,
      ApplicationState.SessionInterrupted,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.Calibrating,
    [
      ApplicationState.GeneratingStage,
      ApplicationState.SemanticReview,
      ApplicationState.Paused,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.GeneratingStage,
    [
      ApplicationState.PlacingPortals,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.PlacingPortals,
    [
      ApplicationState.StageReady,
      ApplicationState.Calibrating,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.StageReady,
    [
      ApplicationState.Playing,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.Playing,
    [
      ApplicationState.Paused,
      ApplicationState.SessionInterrupted,
      ApplicationState.SessionEnded,
      ApplicationState.GeneratingStage,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.Paused,
    [
      ApplicationState.Playing,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.SessionInterrupted,
    [
      ApplicationState.Playing,
      ApplicationState.Paused,
      ApplicationState.SessionEnded,
      ApplicationState.FatalError,
    ],
  ],
  [
    ApplicationState.SessionEnded,
    [
      ApplicationState.Ready,
      ApplicationState.EnteringXR,
      ApplicationState.FatalError,
    ],
  ],
  [ApplicationState.FatalError, [ApplicationState.LoadingRuntime]],
]);

export const encounterTransitions = transitionMap<EncounterState>([
  [
    EncounterState.Idle,
    [EncounterState.PortalCharging, EncounterState.Restarting],
  ],
  [
    EncounterState.PortalCharging,
    [EncounterState.PortalOpening, EncounterState.Restarting],
  ],
  [
    EncounterState.PortalOpening,
    [EncounterState.WaveAnnouncement, EncounterState.Restarting],
  ],
  [
    EncounterState.WaveAnnouncement,
    [
      EncounterState.Spawning,
      EncounterState.BossIntro,
      EncounterState.Restarting,
    ],
  ],
  [EncounterState.Spawning, [EncounterState.Combat, EncounterState.Restarting]],
  [
    EncounterState.Combat,
    [EncounterState.WaveClear, EncounterState.Restarting],
  ],
  [
    EncounterState.WaveClear,
    [
      EncounterState.Intermission,
      EncounterState.BossIntro,
      EncounterState.StageClear,
      EncounterState.Restarting,
    ],
  ],
  [
    EncounterState.Intermission,
    [EncounterState.WaveAnnouncement, EncounterState.Restarting],
  ],
  [
    EncounterState.BossIntro,
    [EncounterState.BossCombat, EncounterState.Restarting],
  ],
  [
    EncounterState.BossCombat,
    [EncounterState.BossDefeated, EncounterState.Restarting],
  ],
  [
    EncounterState.BossDefeated,
    [EncounterState.StageClear, EncounterState.Restarting],
  ],
  [
    EncounterState.StageClear,
    [EncounterState.Restarting, EncounterState.PortalCharging],
  ],
  [EncounterState.Restarting, [EncounterState.Idle]],
]);

export const enemyTransitions = transitionMap<EnemyState>([
  [EnemyState.Dormant, [EnemyState.Emerging, EnemyState.Despawning]],
  [EnemyState.Emerging, [EnemyState.Observing, EnemyState.Defeated]],
  [
    EnemyState.Observing,
    [
      EnemyState.Approaching,
      EnemyState.Circling,
      EnemyState.Guarding,
      EnemyState.Retreating,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Approaching,
    [
      EnemyState.Circling,
      EnemyState.Guarding,
      EnemyState.Dodging,
      EnemyState.AttackWindup,
      EnemyState.Retreating,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Circling,
    [
      EnemyState.Approaching,
      EnemyState.Guarding,
      EnemyState.Dodging,
      EnemyState.AttackWindup,
      EnemyState.Retreating,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Guarding,
    [
      EnemyState.Approaching,
      EnemyState.Dodging,
      EnemyState.AttackWindup,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Dodging,
    [
      EnemyState.Observing,
      EnemyState.Recovering,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.AttackWindup,
    [
      EnemyState.Attacking,
      EnemyState.Guarding,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Attacking,
    [
      EnemyState.Combo,
      EnemyState.Recovering,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Combo,
    [
      EnemyState.Attacking,
      EnemyState.Recovering,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Recovering,
    [
      EnemyState.Observing,
      EnemyState.Guarding,
      EnemyState.Enraged,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Staggered,
    [EnemyState.KnockedDown, EnemyState.Recovering, EnemyState.Defeated],
  ],
  [
    EnemyState.KnockedDown,
    [EnemyState.Recovering, EnemyState.Enraged, EnemyState.Defeated],
  ],
  [
    EnemyState.Enraged,
    [
      EnemyState.Approaching,
      EnemyState.AttackWindup,
      EnemyState.Staggered,
      EnemyState.Defeated,
    ],
  ],
  [
    EnemyState.Retreating,
    [EnemyState.Observing, EnemyState.Guarding, EnemyState.Defeated],
  ],
  [EnemyState.Defeated, [EnemyState.Despawning]],
  [EnemyState.Despawning, []],
]);

export const semanticObjectTransitions = transitionMap<SemanticObjectState>([
  [
    SemanticObjectState.Unobserved,
    [SemanticObjectState.GeometryDetected, SemanticObjectState.Removed],
  ],
  [
    SemanticObjectState.GeometryDetected,
    [
      SemanticObjectState.ClassificationPending,
      SemanticObjectState.Classified,
      SemanticObjectState.LowConfidence,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.ClassificationPending,
    [
      SemanticObjectState.Classified,
      SemanticObjectState.LowConfidence,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.Classified,
    [
      SemanticObjectState.UserConfirmed,
      SemanticObjectState.UserCorrected,
      SemanticObjectState.Tracking,
      SemanticObjectState.LowConfidence,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.LowConfidence,
    [
      SemanticObjectState.UserConfirmed,
      SemanticObjectState.UserCorrected,
      SemanticObjectState.ClassificationPending,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.UserConfirmed,
    [
      SemanticObjectState.Tracking,
      SemanticObjectState.UserCorrected,
      SemanticObjectState.Occluded,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.UserCorrected,
    [
      SemanticObjectState.Tracking,
      SemanticObjectState.Occluded,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.Tracking,
    [
      SemanticObjectState.Occluded,
      SemanticObjectState.LowConfidence,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.Occluded,
    [
      SemanticObjectState.Tracking,
      SemanticObjectState.Lost,
      SemanticObjectState.Removed,
    ],
  ],
  [
    SemanticObjectState.Lost,
    [SemanticObjectState.GeometryDetected, SemanticObjectState.Removed],
  ],
  [SemanticObjectState.Removed, []],
]);
