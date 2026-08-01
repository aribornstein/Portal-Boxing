import {
  AudioSource,
  BoxGeometry,
  CircleGeometry,
  Color,
  createComponent,
  createSystem,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  PlaybackMode,
  SphereGeometry,
  TorusGeometry,
  Types,
} from "@iwsdk/core";
import type { Entity, Object3D } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import {
  reactionForImpact,
  type HitRegion,
  type ImpactReaction,
} from "../combat/combatImpact.js";
import type {
  EnemyArchetype,
  StageTheme,
} from "../generation/stageGenerator.js";

export const PortalVisual = createComponent("PortalVisual", {
  active: { type: Types.Boolean, default: false },
  theme: { type: Types.String, default: "neon-city" },
});

export const OpponentVisual = createComponent("OpponentVisual", {
  slot: { type: Types.Int8, default: 0 },
  archetype: { type: Types.String, default: "striker" },
  boss: { type: Types.Boolean, default: false },
  behavior: { type: Types.String, default: "approach" },
  telegraphing: { type: Types.Boolean, default: false },
});

const simulationGlobal = "portalBoxingSimulation";

export class GameplayPresentationSystem extends createSystem({
  portals: { required: [PortalVisual] },
  opponents: { required: [OpponentVisual] },
}) {
  private simulation: GameSimulation | undefined;
  private snapshot: SimulationSnapshot | undefined;
  private opponentSignature = "";
  private appliedImpactSequence = 0;

  init() {
    this.world.registerComponent(PortalVisual);
    this.world.registerComponent(OpponentVisual);
    this.simulation = this.globals[simulationGlobal] as
      GameSimulation | undefined;
    if (!this.simulation) {
      console.warn("Gameplay presentation has no simulation source");
      return;
    }
    this.cleanupFuncs.push(
      this.simulation.subscribe((snapshot) => {
        this.snapshot = snapshot;
        this.syncPortal(snapshot);
        this.syncOpponents(snapshot);
        this.syncImpact(snapshot);
      }),
    );
  }

  update(_delta: number, time: number) {
    const seconds = time;
    for (const entity of this.queries.portals.entities) {
      const root = entity.object3D;
      const ring = root?.userData.ring as Mesh | undefined;
      if (!root || !ring) continue;
      ring.rotation.z = seconds * 0.35;
      const pulse = 1 + Math.sin(seconds * 3.2) * 0.025;
      ring.scale.set(pulse, pulse, 1);
    }
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      const slot = entity.getValue(OpponentVisual, "slot") ?? 0;
      const boss = entity.getValue(OpponentVisual, "boss");
      const baseScale = Number(root.userData.baseScale ?? 1);
      root.scale.setScalar(
        time < Number(root.userData.hitFlashUntil ?? 0)
          ? baseScale * 1.06
          : baseScale,
      );
      root.position.y = Math.sin(seconds * 2.4 + slot) * 0.025;
      this.updateImpactReaction(root, seconds, slot);
      const leftGlove = root.userData.leftGlove as Mesh | undefined;
      const rightGlove = root.userData.rightGlove as Mesh | undefined;
      if (leftGlove && rightGlove) {
        const guard = boss ? 1.25 : 1;
        leftGlove.position.z = 0.2 + Math.sin(seconds * 1.7) * 0.025;
        rightGlove.position.z = 0.2 + Math.cos(seconds * 1.9) * 0.025;
        leftGlove.position.y = 1.35 * guard;
        rightGlove.position.y = 1.35 * guard;
      }
    }
  }

  private syncPortal(snapshot: SimulationSnapshot) {
    const placement =
      snapshot.stage?.portalPlacements[snapshot.activePortalIndex];
    if (!placement) {
      this.disposeQuery(this.queries.portals.entities);
      return;
    }
    const existing = this.queries.portals.entities.values().next().value;
    if (existing?.object3D?.userData.portalSurfaceId === placement.surfaceId) {
      existing.setValue(
        PortalVisual,
        "active",
        snapshot.application === "PLAYING",
      );
      existing.object3D!.visible = snapshot.application !== "SESSION_ENDED";
      updateVitalityBars(existing.object3D!, snapshot);
      return;
    }
    if (existing) this.disposeQuery(this.queries.portals.entities);
    const theme = snapshot.stage?.theme ?? "neon-city";
    const group = createPortal(theme, placement.width, placement.height);
    group.name = `Portal-${placement.surfaceId}`;
    group.userData.portalSurfaceId = placement.surfaceId;
    group.position.set(...placement.center);
    group.lookAt(
      placement.center[0] + placement.facing[0],
      placement.center[1] + placement.facing[1],
      placement.center[2] + placement.facing[2],
    );
    const entity = this.world.createTransformEntity(group, {
      parent: this.world.activeLevel.value,
    });
    entity.addComponent(PortalVisual, {
      active: snapshot.application === "PLAYING",
      theme,
    });
    updateVitalityBars(group, snapshot);
  }

  private syncOpponents(snapshot: SimulationSnapshot) {
    const wave =
      snapshot.encounter === "BOSS_COMBAT"
        ? snapshot.stage?.waves[3]
        : snapshot.encounter === "COMBAT" && snapshot.waveIndex >= 0
          ? snapshot.stage?.waves[snapshot.waveIndex]
          : undefined;
    const desired = wave?.enemies ?? [];
    const signature = `${snapshot.encounter}:${snapshot.waveIndex}:${desired.join(",")}`;
    if (signature === this.opponentSignature) return;
    this.opponentSignature = signature;
    this.disposeQuery(this.queries.opponents.entities);
    if (!snapshot.stage || desired.length === 0) return;
    const portal = snapshot.stage.portalPlacements[snapshot.activePortalIndex];
    desired.slice(0, 1).forEach((archetype, slot) => {
      const boss = archetype === "heavyweight";
      const group = createOpponent(archetype, snapshot.stage!.theme, boss);
      group.name = boss ? "Boss-Heavyweight" : `Opponent-${slot}-${archetype}`;
      group.position.set(
        portal.center[0] + portal.facing[0] * 0.85,
        0,
        portal.center[2] + portal.facing[2] * 0.85,
      );
      group.lookAt(
        group.position.x + portal.facing[0],
        group.position.y,
        group.position.z + portal.facing[2],
      );
      const entity = this.world.createTransformEntity(group, {
        parent: this.world.activeLevel.value,
      });
      entity.addComponent(OpponentVisual, { slot, archetype, boss });
      entity.addComponent(AudioSource, {
        src: "./assets/audio/telegraph.wav",
        positional: true,
        volume: 0.55,
        refDistance: 0.75,
        maxDistance: 7,
        playbackMode: PlaybackMode.Restart,
      });
    });
  }

  private syncImpact(snapshot: SimulationSnapshot) {
    const impact = snapshot.latestImpact;
    if (!impact || impact.sequence <= this.appliedImpactSequence) return;
    this.appliedImpactSequence = impact.sequence;
    const reaction = reactionForImpact(impact);
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      root.userData.impactReaction = reaction;
      root.userData.impactStartedAt = impact.timestamp;
      root.userData.impactRegion = impact.region;
    }
  }

  private updateImpactReaction(root: Object3D, time: number, slot: number) {
    const visualRoot = root.userData.reactionRoot as Group | undefined;
    if (!visualRoot) return;
    const head = root.userData.head as Mesh | undefined;
    const torso = root.userData.torso as Mesh | undefined;
    const hips = root.userData.hips as Mesh | undefined;
    visualRoot.position.set(0, 0, 0);
    visualRoot.rotation.set(0, Math.sin(time * 0.8 + slot) * 0.08, 0);
    head?.rotation.set(0, 0, 0);
    torso?.rotation.set(0, 0, 0);
    hips?.rotation.set(0, 0, 0);

    const reaction = root.userData.impactReaction as ImpactReaction | undefined;
    const startedAt = Number(root.userData.impactStartedAt ?? 0);
    const region = root.userData.impactRegion as HitRegion | undefined;
    if (!reaction) return;
    const progress = (time - startedAt) / reaction.durationSeconds;
    if (progress < 0 || progress >= 1) {
      root.userData.impactReaction = undefined;
      return;
    }
    const envelope = Math.sin(progress * Math.PI);
    visualRoot.position.z = -reaction.displacementMeters * envelope;
    visualRoot.rotation.x = reaction.pitchRadians * envelope;
    visualRoot.rotation.y += reaction.yawRadians * envelope;
    visualRoot.rotation.z = reaction.rollRadians * envelope;
    if (region === "head" && head) {
      head.rotation.y = reaction.yawRadians * envelope * 1.4;
      head.rotation.z = reaction.rollRadians * envelope * 1.5;
    } else if ((region === "torso" || region === "guard") && torso) {
      torso.rotation.x = reaction.pitchRadians * envelope * 1.5;
    } else if (region === "abdomen" && hips) {
      hips.rotation.x = reaction.pitchRadians * envelope * 1.8;
    }
  }

  private disposeQuery(entities: Set<Entity>) {
    for (const entity of [...entities]) entity.dispose();
  }
}

function createPortal(theme: StageTheme, width: number, height: number) {
  const group = new Group();
  const color = theme === "neon-city" ? 0x4ecbee : 0xffb248;
  const ring = new Mesh(
    new TorusGeometry(0.5, 0.045, 16, 64),
    new MeshBasicMaterial({ color, toneMapped: false }),
  );
  ring.scale.set(width, height, 1);
  ring.renderOrder = 2;
  const window = new Mesh(
    new CircleGeometry(0.48, 64),
    new MeshBasicMaterial({
      color: theme === "neon-city" ? 0x07153c : 0x241407,
      opacity: 0.82,
      transparent: true,
      depthWrite: false,
    }),
  );
  window.scale.set(width, height, 1);
  window.position.z = -0.015;
  const light = new PointLight(color, 8, 4, 2);
  light.position.z = 0.25;
  const playerBar = createVitalityBar(0x55cdf6, height * 0.63);
  const enemyBar = createVitalityBar(0xff4d3d, height * 0.56);
  group.add(window, ring, light, playerBar.root, enemyBar.root);
  group.userData.ring = ring;
  group.userData.playerBar = playerBar.root;
  group.userData.playerBarFill = playerBar.fill;
  group.userData.enemyBar = enemyBar.root;
  group.userData.enemyBarFill = enemyBar.fill;
  return group;
}

function createVitalityBar(color: number, verticalPosition: number) {
  const root = new Group();
  root.position.set(0, verticalPosition, 0.04);
  const background = new Mesh(
    new BoxGeometry(1.04, 0.075, 0.025),
    new MeshBasicMaterial({ color: 0x07090b, toneMapped: false }),
  );
  const fill = new Mesh(
    new BoxGeometry(1, 0.045, 0.032),
    new MeshBasicMaterial({ color, toneMapped: false }),
  );
  fill.position.z = 0.02;
  root.add(background, fill);
  return { root, fill };
}

function updateVitalityBars(root: Object3D, snapshot: SimulationSnapshot) {
  const playerBar = root.userData.playerBar as Group | undefined;
  const playerFill = root.userData.playerBarFill as Mesh | undefined;
  const enemyBar = root.userData.enemyBar as Group | undefined;
  const enemyFill = root.userData.enemyBarFill as Mesh | undefined;
  const visible = snapshot.application === "PLAYING";
  if (playerBar) playerBar.visible = visible;
  if (enemyBar) enemyBar.visible = visible;
  if (playerFill) {
    setBarRatio(
      playerFill,
      snapshot.playerHealthMaximum > 0
        ? snapshot.playerHealth / snapshot.playerHealthMaximum
        : 0,
    );
  }
  if (enemyFill) {
    setBarRatio(
      enemyFill,
      snapshot.encounterHealthMaximum > 0
        ? snapshot.encounterHealth / snapshot.encounterHealthMaximum
        : 0,
    );
  }
}

function setBarRatio(fill: Mesh, ratio: number) {
  const clamped = Math.max(0, Math.min(1, ratio));
  fill.scale.x = clamped;
  fill.position.x = (clamped - 1) * 0.5;
}

function createOpponent(
  archetype: EnemyArchetype,
  theme: StageTheme,
  boss: boolean,
) {
  const group = new Group();
  const reactionRoot = new Group();
  group.add(reactionRoot);
  const accent = theme === "neon-city" ? 0x41cfee : 0xffb248;
  const gloveColor = theme === "neon-city" ? 0xff365f : 0xe84b2c;
  const bodyColor =
    archetype === "guard"
      ? 0x36535c
      : archetype === "bruiser" || boss
        ? 0x631f23
        : 0x1f3138;
  const bodyMaterial = new MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.72,
    emissive: new Color(bodyColor).multiplyScalar(0.08),
  });
  const accentMaterial = new MeshStandardMaterial({
    color: accent,
    roughness: 0.35,
    emissive: new Color(accent).multiplyScalar(0.18),
    flatShading: true,
  });
  const darkMaterial = new MeshStandardMaterial({
    color: 0x11171b,
    roughness: 0.62,
    metalness: 0.42,
  });
  const gloveMaterial = new MeshStandardMaterial({
    color: gloveColor,
    roughness: 0.5,
    emissive: new Color(gloveColor).multiplyScalar(0.08),
    flatShading: true,
  });
  const torso = new Mesh(
    new CylinderGeometry(0.26, boss ? 0.4 : 0.35, 0.7, 8),
    bodyMaterial,
  );
  torso.position.y = 1.04;
  const chestPlate = new Mesh(
    new BoxGeometry(boss ? 0.64 : 0.55, 0.42, 0.16),
    accentMaterial,
  );
  chestPlate.position.set(0, 1.08, 0.26);
  const chestCore = new Mesh(
    new SphereGeometry(boss ? 0.09 : 0.075, 12, 8),
    gloveMaterial,
  );
  chestCore.position.set(0, 1.08, 0.36);
  const waist = new Mesh(
    new CylinderGeometry(0.23, 0.28, 0.2, 8),
    darkMaterial,
  );
  waist.position.y = 0.62;
  const belt = new Mesh(new BoxGeometry(0.5, 0.13, 0.31), accentMaterial);
  belt.position.set(0, 0.62, 0.03);

  const neck = new Mesh(
    new CylinderGeometry(0.105, 0.12, 0.13, 8),
    darkMaterial,
  );
  neck.position.y = 1.43;
  const head = new Mesh(new BoxGeometry(0.36, 0.3, 0.31), bodyMaterial);
  head.position.y = 1.61;
  const facePlate = new Mesh(new BoxGeometry(0.29, 0.16, 0.035), darkMaterial);
  facePlate.position.set(0, 1.62, 0.17);
  const leftEye = new Mesh(new SphereGeometry(0.035, 8, 6), accentMaterial);
  leftEye.position.set(-0.085, 1.64, 0.2);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.085;
  const leftAntenna = new Mesh(
    new CylinderGeometry(0.012, 0.018, boss ? 0.24 : 0.18, 6),
    darkMaterial,
  );
  leftAntenna.position.set(-0.1, boss ? 1.9 : 1.86, 0);
  leftAntenna.rotation.z = -0.15;
  const rightAntenna = leftAntenna.clone();
  rightAntenna.position.x = 0.1;
  rightAntenna.rotation.z = 0.15;
  const leftAntennaTip = new Mesh(
    new SphereGeometry(boss ? 0.045 : 0.035, 8, 6),
    gloveMaterial,
  );
  leftAntennaTip.position.set(-0.115, boss ? 2.02 : 1.96, 0);
  const rightAntennaTip = leftAntennaTip.clone();
  rightAntennaTip.position.x = 0.115;

  const leftShoulder = new Mesh(
    new SphereGeometry(boss ? 0.17 : 0.14, 10, 8),
    accentMaterial,
  );
  leftShoulder.position.set(boss ? -0.43 : -0.37, 1.28, 0);
  const rightShoulder = leftShoulder.clone();
  rightShoulder.position.x *= -1;
  const leftUpperArm = new Mesh(
    new CylinderGeometry(0.07, 0.085, 0.32, 8),
    bodyMaterial,
  );
  leftUpperArm.position.set(-0.46, 1.16, 0.06);
  leftUpperArm.rotation.z = -0.48;
  const rightUpperArm = leftUpperArm.clone();
  rightUpperArm.position.x *= -1;
  rightUpperArm.rotation.z *= -1;
  const leftElbow = new Mesh(new SphereGeometry(0.09, 8, 6), darkMaterial);
  leftElbow.position.set(-0.51, 1.04, 0.1);
  const rightElbow = leftElbow.clone();
  rightElbow.position.x *= -1;
  const leftForearm = new Mesh(
    new CylinderGeometry(0.085, 0.07, 0.34, 8),
    bodyMaterial,
  );
  leftForearm.position.set(-0.47, 1.2, 0.16);
  leftForearm.rotation.set(-0.34, 0, 0.42);
  const rightForearm = leftForearm.clone();
  rightForearm.position.x *= -1;
  rightForearm.rotation.z *= -1;
  const leftCuff = new Mesh(
    new CylinderGeometry(0.115, 0.13, 0.16, 10),
    darkMaterial,
  );
  leftCuff.position.set(-0.39, 1.3, 0.19);
  leftCuff.rotation.x = Math.PI / 2;
  const rightCuff = leftCuff.clone();
  rightCuff.position.x *= -1;
  const leftGlove = new Mesh(new SphereGeometry(0.16, 12, 8), gloveMaterial);
  leftGlove.scale.set(1.12, 0.96, 1.24);
  leftGlove.position.set(-0.38, 1.35, 0.24);
  const rightGlove = leftGlove.clone();
  rightGlove.position.x = 0.38;

  const hips = new Mesh(new BoxGeometry(0.46, 0.19, 0.3), bodyMaterial);
  hips.position.y = 0.5;
  const leftThigh = new Mesh(
    new CylinderGeometry(0.1, 0.12, 0.3, 8),
    bodyMaterial,
  );
  leftThigh.position.set(-0.14, 0.34, 0);
  const rightThigh = leftThigh.clone();
  rightThigh.position.x *= -1;
  const leftKnee = new Mesh(new SphereGeometry(0.115, 8, 6), accentMaterial);
  leftKnee.position.set(-0.14, 0.19, 0.03);
  const rightKnee = leftKnee.clone();
  rightKnee.position.x *= -1;
  const leftShin = new Mesh(new BoxGeometry(0.15, 0.25, 0.17), bodyMaterial);
  leftShin.position.set(-0.14, 0.09, 0);
  const rightShin = leftShin.clone();
  rightShin.position.x *= -1;
  const leftBoot = new Mesh(new BoxGeometry(0.23, 0.13, 0.34), darkMaterial);
  leftBoot.position.set(-0.14, -0.02, 0.08);
  const rightBoot = leftBoot.clone();
  rightBoot.position.x *= -1;

  const attackTelegraph = new Mesh(
    new TorusGeometry(0.24, 0.025, 8, 24),
    new MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }),
  );
  attackTelegraph.position.z = 0.015;
  attackTelegraph.visible = false;
  rightGlove.add(attackTelegraph);
  reactionRoot.add(
    torso,
    chestPlate,
    chestCore,
    waist,
    belt,
    neck,
    head,
    facePlate,
    leftEye,
    rightEye,
    leftAntenna,
    rightAntenna,
    leftAntennaTip,
    rightAntennaTip,
    leftShoulder,
    rightShoulder,
    leftUpperArm,
    rightUpperArm,
    leftElbow,
    rightElbow,
    leftForearm,
    rightForearm,
    leftCuff,
    rightCuff,
    leftGlove,
    rightGlove,
    hips,
    leftThigh,
    rightThigh,
    leftKnee,
    rightKnee,
    leftShin,
    rightShin,
    leftBoot,
    rightBoot,
  );
  if (archetype === "guard") {
    const leftGuard = new Mesh(
      new BoxGeometry(0.18, 0.28, 0.07),
      accentMaterial,
    );
    leftGuard.position.set(-0.5, 1.2, 0.22);
    const rightGuard = leftGuard.clone();
    rightGuard.position.x *= -1;
    reactionRoot.add(leftGuard, rightGuard);
  }
  if (boss) {
    const leftPauldron = new Mesh(
      new BoxGeometry(0.27, 0.14, 0.34),
      gloveMaterial,
    );
    leftPauldron.position.set(-0.46, 1.34, 0);
    leftPauldron.rotation.z = -0.18;
    const rightPauldron = leftPauldron.clone();
    rightPauldron.position.x *= -1;
    rightPauldron.rotation.z *= -1;
    reactionRoot.add(leftPauldron, rightPauldron);
  }
  group.userData.reactionRoot = reactionRoot;
  group.userData.torso = torso;
  group.userData.head = head;
  group.userData.hips = hips;
  group.userData.leftKnee = leftKnee;
  group.userData.rightKnee = rightKnee;
  group.userData.leftGlove = leftGlove;
  group.userData.rightGlove = rightGlove;
  group.userData.attackTelegraph = attackTelegraph;
  group.userData.visualStyle = "project-owned-procedural-robot-v2";
  group.userData.baseScale = boss ? 1.22 : 1;
  if (boss) group.scale.setScalar(group.userData.baseScale);
  return group;
}
