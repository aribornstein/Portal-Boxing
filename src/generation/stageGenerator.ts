import type { PortalCandidate } from "../portal/portalCandidateService.js";

export type StageTheme = "neon-city" | "subway-platform";
export type EnemyArchetype = "striker" | "guard" | "bruiser" | "heavyweight";
export type Difficulty = "easy" | "normal" | "hard";

export interface WaveDefinition {
  readonly id: string;
  readonly enemies: readonly EnemyArchetype[];
  readonly spawnPortalIds: readonly string[];
  readonly spawnDelayMilliseconds: number;
  readonly healthModifier: number;
  readonly speedModifier: number;
  readonly aggression: number;
  readonly activeEnemyCap: number;
  readonly musicIntensity: number;
  readonly bossTrigger: boolean;
}

export interface StageManifest {
  readonly schemaVersion: 1;
  readonly gameVersion: string;
  readonly roomSnapshotHash: string;
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly theme: StageTheme;
  readonly portalStyle: "violet-plasma" | "amber-rail";
  readonly portalPlacements: readonly PortalCandidate[];
  readonly windowView: "rainy-city" | "arriving-train";
  readonly lighting: "neon-reflections" | "industrial-flicker";
  readonly soundscape: "city-rain" | "subway-rumble";
  readonly hazard: "electrical-arcs" | "warning-lights";
  readonly waves: readonly WaveDefinition[];
  readonly bossModifiers: {
    readonly armor: number;
    readonly aggression: number;
  };
  readonly scoreModifier: number;
}

export interface GenerationContext {
  readonly gameVersion: string;
  readonly roomSnapshotHash: string;
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly portalCandidates: readonly PortalCandidate[];
  readonly previousThemes?: readonly StageTheme[];
  readonly performanceEnemyCap: number;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }

  integer(maximumExclusive: number) {
    if (!Number.isInteger(maximumExclusive) || maximumExclusive < 1) {
      throw new RangeError("Random integer bound must be a positive integer");
    }
    return Math.floor(this.next() * maximumExclusive);
  }
}

export function generateStage(context: GenerationContext): StageManifest {
  if (context.portalCandidates.length === 0) {
    throw new Error(
      "Stage generation requires at least one safe portal candidate",
    );
  }
  const random = new SeededRandom(context.seed);
  const themes: readonly StageTheme[] = ["neon-city", "subway-platform"];
  let theme = themes[random.integer(themes.length)];
  const previousTheme =
    context.previousThemes?.[context.previousThemes.length - 1];
  if (
    previousTheme === theme &&
    context.previousThemes!.length < themes.length
  ) {
    theme = theme === "neon-city" ? "subway-platform" : "neon-city";
  }
  const portalCount = Math.min(2, context.portalCandidates.length);
  const portalOffset = random.integer(context.portalCandidates.length);
  const placements = Array.from(
    { length: portalCount },
    (_, index) =>
      context.portalCandidates[
        (portalOffset + index) % context.portalCandidates.length
      ],
  );
  const difficultyScale =
    context.difficulty === "easy"
      ? 0.85
      : context.difficulty === "hard"
        ? 1.2
        : 1;
  const activeEnemyCap = 1;
  const portalIds = placements.map((portal) => portal.surfaceId);
  const waves: WaveDefinition[] = [
    wave(
      "wave-1",
      ["striker"],
      portalIds,
      700,
      0.9,
      1.05,
      0.45,
      activeEnemyCap,
      0.3,
    ),
    wave("wave-2", ["guard"], portalIds, 900, 1, 1, 0.6, activeEnemyCap, 0.55),
    wave(
      "wave-3",
      ["bruiser"],
      portalIds,
      1100,
      1.05,
      0.95,
      0.72,
      activeEnemyCap,
      0.78,
    ),
    {
      ...wave("boss", ["heavyweight"], portalIds, 1500, 1.2, 0.9, 0.82, 1, 1),
      bossTrigger: true,
    },
  ].map((definition) => ({
    ...definition,
    healthModifier: definition.healthModifier * difficultyScale,
    aggression: Math.min(1, definition.aggression * difficultyScale),
  }));

  return {
    schemaVersion: 1,
    gameVersion: context.gameVersion,
    roomSnapshotHash: context.roomSnapshotHash,
    seed: context.seed,
    difficulty: context.difficulty,
    theme,
    portalStyle: theme === "neon-city" ? "violet-plasma" : "amber-rail",
    portalPlacements: placements,
    windowView: theme === "neon-city" ? "rainy-city" : "arriving-train",
    lighting: theme === "neon-city" ? "neon-reflections" : "industrial-flicker",
    soundscape: theme === "neon-city" ? "city-rain" : "subway-rumble",
    hazard: theme === "neon-city" ? "electrical-arcs" : "warning-lights",
    waves,
    bossModifiers: {
      armor: 1.25 * difficultyScale,
      aggression: Math.min(1, 0.75 * difficultyScale),
    },
    scoreModifier: difficultyScale,
  };
}

function wave(
  id: string,
  enemies: readonly EnemyArchetype[],
  spawnPortalIds: readonly string[],
  spawnDelayMilliseconds: number,
  healthModifier: number,
  speedModifier: number,
  aggression: number,
  activeEnemyCap: number,
  musicIntensity: number,
): WaveDefinition {
  return {
    id,
    enemies,
    spawnPortalIds,
    spawnDelayMilliseconds,
    healthModifier,
    speedModifier,
    aggression,
    activeEnemyCap,
    musicIntensity,
    bossTrigger: false,
  };
}
