import type { EnemyArchetype } from "../generation/stageGenerator.js";

export type EnemyBehavior =
  | "approach"
  | "retreat"
  | "circle"
  | "guard"
  | "dodge-left"
  | "dodge-right"
  | "duck"
  | "jab"
  | "cross"
  | "hook"
  | "body-attack"
  | "combo"
  | "feint"
  | "counterattack"
  | "recover"
  | "cover"
  | "return-to-zone";

export interface EnemyPerception {
  readonly distanceToPlayer: number;
  readonly relativeAngle: number;
  readonly playerHandSpeed: number;
  readonly playerGuarding: boolean;
  readonly enemyHealthRatio: number;
  readonly enemyStaminaRatio: number;
  readonly enemyPoiseRatio: number;
  readonly safeTargetAvailable: boolean;
  readonly obstacleDistance: number;
  readonly allyDistance: number;
  readonly timeSinceAttack: number;
  readonly attackCooldown: number;
}

export interface UtilityDecision {
  readonly selected: EnemyBehavior;
  readonly scores: Readonly<Record<EnemyBehavior, number>>;
}

export type EnemyBehaviorScores = Record<EnemyBehavior, number>;

const behaviors: readonly EnemyBehavior[] = [
  "approach",
  "retreat",
  "circle",
  "guard",
  "dodge-left",
  "dodge-right",
  "duck",
  "jab",
  "cross",
  "hook",
  "body-attack",
  "combo",
  "feint",
  "counterattack",
  "recover",
  "cover",
  "return-to-zone",
];

export function selectEnemyBehavior(
  archetype: EnemyArchetype,
  perception: EnemyPerception,
): UtilityDecision {
  const scores = createEnemyBehaviorScores();
  const selected = selectEnemyBehaviorInto(archetype, perception, scores);
  return { selected, scores };
}

export function createEnemyBehaviorScores(): EnemyBehaviorScores {
  return Object.fromEntries(
    behaviors.map((behavior) => [behavior, 0]),
  ) as EnemyBehaviorScores;
}

export function selectEnemyBehaviorInto(
  archetype: EnemyArchetype,
  perception: EnemyPerception,
  scores: EnemyBehaviorScores,
): EnemyBehavior {
  for (const behavior of behaviors) scores[behavior] = 0;
  if (!perception.safeTargetAvailable) scores["return-to-zone"] = 1;
  scores.approach = clamp(perception.distanceToPlayer - 1.2);
  scores.retreat = clamp(
    (1 - perception.enemyHealthRatio) * 0.7 +
      (perception.distanceToPlayer < 0.6 ? 0.5 : 0),
  );
  scores.circle = clamp(0.35 + Math.abs(perception.relativeAngle) * 0.2);
  scores.guard = clamp(
    perception.playerHandSpeed / 5 + (archetype === "guard" ? 0.35 : 0),
  );
  scores["dodge-left"] = clamp(
    perception.playerHandSpeed / 6 + (archetype === "striker" ? 0.2 : 0),
  );
  scores["dodge-right"] = scores["dodge-left"] * 0.97;
  scores.duck = clamp(perception.playerHandSpeed / 7);
  const attackRange = archetype === "heavyweight" ? 1.4 : 1.2;
  const attackReady =
    perception.timeSinceAttack >= perception.attackCooldown &&
    perception.enemyStaminaRatio > 0.2 &&
    perception.distanceToPlayer <= attackRange;
  if (attackReady && perception.safeTargetAvailable) {
    scores.jab = archetype === "striker" ? 0.82 : 0.58;
    scores.cross = archetype === "bruiser" ? 0.74 : 0.62;
    scores.hook = archetype === "bruiser" ? 0.8 : 0.52;
    scores["body-attack"] = perception.playerGuarding ? 0.76 : 0.45;
    scores.combo =
      perception.enemyStaminaRatio * (archetype === "striker" ? 0.85 : 0.55);
    scores.feint = perception.playerGuarding ? 0.7 : 0.25;
    scores.counterattack =
      perception.playerHandSpeed > 1.5 && archetype === "guard" ? 0.88 : 0.2;
  }
  scores.recover = clamp(
    (1 - perception.enemyStaminaRatio) * 0.9 +
      (1 - perception.enemyPoiseRatio) * 0.4,
  );
  scores.cover =
    perception.obstacleDistance < 0.8 && perception.enemyHealthRatio < 0.45
      ? 0.65
      : 0;
  if (perception.allyDistance < 0.6) scores.circle += 0.35;
  const selected = behaviors.reduce(
    (best, behavior) => (scores[behavior] > scores[best] ? behavior : best),
    behaviors[0],
  );
  return selected;
}

export function bossPhase(healthRatio: number): 1 | 2 | 3 {
  if (healthRatio <= 0.35) return 3;
  if (healthRatio <= 0.7) return 2;
  return 1;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
