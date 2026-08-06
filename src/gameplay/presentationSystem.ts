import {
  AlwaysStencilFunc,
  AssetManager,
  AudioSource,
  BoxGeometry,
  CircleGeometry,
  Color,
  createComponent,
  createSystem,
  CylinderGeometry,
  EqualStencilFunc,
  Group,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  PlaybackMode,
  ReplaceStencilOp,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Types,
} from "@iwsdk/core";
import type { Entity, Material, Object3D } from "@iwsdk/core";

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
  StageManifest,
  StageTheme,
} from "../generation/stageGenerator.js";
import {
  enemyEmergenceProgress,
  portalChoreographyFrame,
} from "./portalChoreography.js";

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

export const StageVistaVisual = createComponent("StageVistaVisual", {
  theme: { type: Types.String, default: "neon-city" },
  view: { type: Types.String, default: "rainy-city" },
});

const simulationGlobal = "portalBoxingSimulation";

export class GameplayPresentationSystem extends createSystem({
  portals: { required: [PortalVisual] },
  opponents: { required: [OpponentVisual] },
  stageVistas: { required: [StageVistaVisual] },
}) {
  private simulation: GameSimulation | undefined;
  private snapshot: SimulationSnapshot | undefined;
  private opponentSignature = "";
  private stageVistaSignature = "";
  private appliedImpactSequence = 0;

  init() {
    this.world.registerComponent(PortalVisual);
    this.world.registerComponent(OpponentVisual);
    this.world.registerComponent(StageVistaVisual);
    this.simulation = this.globals[simulationGlobal] as
      GameSimulation | undefined;
    if (!this.simulation) {
      console.warn("Gameplay presentation has no simulation source");
      return;
    }
    this.cleanupFuncs.push(
      this.simulation.subscribe((snapshot) => {
        this.snapshot = snapshot;
        this.syncStageVista(snapshot);
        this.syncPortal(snapshot);
        this.syncOpponents(snapshot);
        this.syncImpact(snapshot);
      }),
    );
  }

  update(delta: number, time: number) {
    const seconds = time;
    for (const entity of this.queries.portals.entities) {
      const root = entity.object3D;
      const ring = root?.userData.ring as Mesh | undefined;
      if (!root || !ring) continue;
      if (!root.userData.portalEpisode) {
        root.visible = false;
        continue;
      }
      root.userData.portalElapsed =
        Number(root.userData.portalElapsed ?? 0) + delta;
      const choreography = portalChoreographyFrame(
        Number(root.userData.portalElapsed),
      );
      root.visible = choreography.visible;
      ring.rotation.z = seconds * 0.35;
      const width = Number(root.userData.portalWidth ?? 1);
      const height = Number(root.userData.portalHeight ?? 1);
      const portalRings = root.userData.portalRings as Mesh[] | undefined;
      for (let index = 0; index < (portalRings?.length ?? 0); index += 1) {
        const layer = portalRings![index]!;
        const pulse =
          1 + Math.sin(seconds * (2.4 + index * 0.35) + index) * 0.025;
        layer.rotation.z = seconds * (index % 2 === 0 ? 0.28 : -0.2) + index;
        layer.scale.set(
          width * pulse * choreography.aperture,
          height * pulse * choreography.aperture,
          1,
        );
      }
      const aperture = root.userData.aperture as Mesh | undefined;
      aperture?.scale.set(
        width * choreography.aperture,
        height * choreography.aperture,
        1,
      );
      const portalMaterial = root.userData.portalMaterial as
        ShaderMaterial | undefined;
      if (portalMaterial) {
        portalMaterial.uniforms.uTime!.value = seconds;
        portalMaterial.uniforms.uOpen!.value = choreography.aperture;
      }
      const portalLight = root.userData.portalLight as PointLight | undefined;
      const rimLight = root.userData.rimLight as PointLight | undefined;
      if (portalLight) portalLight.intensity = 14 * choreography.energy;
      if (rimLight) rimLight.intensity = 7 * choreography.energy;
      const portalSparks = root.userData.portalSparks as Mesh[] | undefined;
      for (let index = 0; index < (portalSparks?.length ?? 0); index += 1) {
        const spark = portalSparks![index]!;
        const angle =
          seconds * (0.45 + (index % 3) * 0.08) +
          (index / portalSparks!.length) * Math.PI * 2;
        const radius =
          (0.53 + Math.sin(seconds * 2.2 + index) * 0.035) *
          choreography.aperture;
        spark.position.set(
          Math.cos(angle) * radius * width,
          Math.sin(angle) * radius * height,
          0.035 + Math.sin(seconds * 1.7 + index) * 0.025,
        );
      }
    }
    for (const entity of this.queries.opponents.entities) {
      const root = entity.object3D;
      if (!root) continue;
      if (!root.userData.emergenceComplete) {
        root.userData.emergenceElapsed =
          Number(root.userData.emergenceElapsed ?? 0) + delta;
        const progress = enemyEmergenceProgress(
          Number(root.userData.emergenceElapsed),
        );
        root.visible = progress > 0;
        root.position.x =
          Number(root.userData.emergenceStartX) +
          (Number(root.userData.emergenceEndX) -
            Number(root.userData.emergenceStartX)) *
            progress;
        root.position.z =
          Number(root.userData.emergenceStartZ) +
          (Number(root.userData.emergenceEndZ) -
            Number(root.userData.emergenceStartZ)) *
            progress;
        if (progress >= 1) {
          root.userData.emergenceComplete = true;
          root.visible = true;
          releasePortalReveal(root);
        }
      }
      const slot = entity.getValue(OpponentVisual, "slot") ?? 0;
      const boss = entity.getValue(OpponentVisual, "boss");
      const baseScale = Number(root.userData.baseScale ?? 1);
      const reactionRoot = root.userData.reactionRoot as Group | undefined;
      root.scale.setScalar(baseScale);
      reactionRoot?.scale.setScalar(
        time < Number(root.userData.hitFlashUntil ?? 0) ? 1.06 : 1,
      );
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
    for (const entity of this.queries.stageVistas.entities) {
      const root = entity.object3D;
      if (!root) continue;
      const material = root.userData.vistaMaterial as
        ShaderMaterial | undefined;
      if (material) material.uniforms.uTime!.value = seconds;
    }
  }

  private syncStageVista(snapshot: SimulationSnapshot) {
    const stage = snapshot.stage;
    if (!stage || snapshot.application === "SESSION_ENDED") {
      this.stageVistaSignature = "";
      this.disposeQuery(this.queries.stageVistas.entities);
      return;
    }
    const activePlacement = stage.portalPlacements[snapshot.activePortalIndex];
    const placement =
      stage.portalPlacements.find(
        (_, index) => index !== snapshot.activePortalIndex,
      ) ?? activePlacement;
    if (!placement) return;
    const signature = `${stage.seed}:${stage.windowView}:${placement.surfaceId}`;
    if (signature === this.stageVistaSignature) return;
    this.stageVistaSignature = signature;
    this.disposeQuery(this.queries.stageVistas.entities);
    const width = Math.min(1.9, Math.max(1.25, placement.width * 1.25));
    const height = Math.min(1.2, Math.max(0.8, placement.height * 0.52));
    const group = createStageVista(stage, width, height);
    group.name = `StageVista-${stage.windowView}-L${snapshot.stageNumber}`;
    const sharesActiveSurface = placement === activePlacement;
    const tangentX = placement.facing[2];
    const tangentZ = -placement.facing[0];
    const tangentOffset = sharesActiveSurface ? placement.width * 1.05 : 0;
    group.position.set(
      placement.center[0] +
        tangentX * tangentOffset +
        placement.facing[0] * 0.035,
      placement.center[1],
      placement.center[2] +
        tangentZ * tangentOffset +
        placement.facing[2] * 0.035,
    );
    group.lookAt(
      group.position.x + placement.facing[0],
      group.position.y,
      group.position.z + placement.facing[2],
    );
    const entity = this.world.createTransformEntity(group, {
      parent: this.world.activeLevel.value,
    });
    entity.addComponent(StageVistaVisual, {
      theme: stage.theme,
      view: stage.windowView,
    });
  }

  private syncPortal(snapshot: SimulationSnapshot) {
    const placement =
      snapshot.stage?.portalPlacements[snapshot.activePortalIndex];
    if (!placement) {
      this.disposeQuery(this.queries.portals.entities);
      return;
    }
    const existing = this.queries.portals.entities.values().next().value;
    if (
      existing?.object3D?.userData.portalSurfaceId === placement.surfaceId &&
      existing.object3D.userData.portalStageSeed === snapshot.stage?.seed
    ) {
      existing.setValue(
        PortalVisual,
        "active",
        snapshot.application === "PLAYING",
      );
      existing.object3D!.visible = snapshot.application !== "SESSION_ENDED";
      const episode = portalEpisode(snapshot);
      if (episode && existing.object3D!.userData.portalEpisode !== episode) {
        existing.object3D!.userData.portalEpisode = episode;
        existing.object3D!.userData.portalElapsed = 0;
      }
      updateVitalityBars(existing.object3D!, snapshot);
      return;
    }
    if (existing) this.disposeQuery(this.queries.portals.entities);
    const theme = snapshot.stage?.theme ?? "neon-city";
    const group = createPortal(theme, placement.width, placement.height);
    group.name = `Portal-${placement.surfaceId}`;
    group.userData.portalSurfaceId = placement.surfaceId;
    group.userData.portalStageSeed = snapshot.stage?.seed;
    group.userData.portalEpisode = portalEpisode(snapshot);
    group.userData.portalElapsed = 0;
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
      const emergenceStartX = portal.center[0] - portal.facing[0] * 0.55;
      const emergenceStartZ = portal.center[2] - portal.facing[2] * 0.55;
      const emergenceEndX = portal.center[0] + portal.facing[0] * 0.85;
      const emergenceEndZ = portal.center[2] + portal.facing[2] * 0.85;
      group.position.set(emergenceStartX, 0, emergenceStartZ);
      group.userData.emergenceStartX = emergenceStartX;
      group.userData.emergenceStartZ = emergenceStartZ;
      group.userData.emergenceEndX = emergenceEndX;
      group.userData.emergenceEndZ = emergenceEndZ;
      group.userData.emergenceElapsed = 0;
      group.userData.emergenceComplete = false;
      configurePortalReveal(group);
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
    visualRoot.position.set(0, Math.sin(time * 2.4 + slot) * 0.025, 0);
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
  const color = theme === "neon-city" ? 0x8b4dff : 0xff8a24;
  const hotColor = theme === "neon-city" ? 0x55d9ff : 0xffd45c;
  const ring = new Mesh(
    new TorusGeometry(0.5, 0.035, 16, 96),
    new MeshBasicMaterial({
      color: hotColor,
      toneMapped: false,
      transparent: true,
      opacity: 0.98,
    }),
  );
  ring.scale.set(width, height, 1);
  ring.renderOrder = 5;
  const outerRing = new Mesh(
    new TorusGeometry(0.54, 0.028, 12, 64),
    new MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0.72,
      wireframe: true,
      depthWrite: false,
    }),
  );
  outerRing.scale.set(width, height, 1);
  outerRing.position.z = -0.012;
  outerRing.renderOrder = 4;
  const coronaRing = new Mesh(
    new TorusGeometry(0.585, 0.016, 8, 48),
    new MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0.34,
      wireframe: true,
      depthWrite: false,
    }),
  );
  coronaRing.scale.set(width, height, 1);
  coronaRing.position.z = -0.025;
  coronaRing.renderOrder = 3;
  const portalMaterial = createPortalMaterial(theme);
  const window = new Mesh(new CircleGeometry(0.48, 64), portalMaterial);
  window.scale.set(width, height, 1);
  window.position.z = -0.04;
  window.renderOrder = -10;
  window.material.stencilWrite = true;
  window.material.stencilRef = 1;
  window.material.stencilFunc = AlwaysStencilFunc;
  window.material.stencilFail = KeepStencilOp;
  window.material.stencilZFail = KeepStencilOp;
  window.material.stencilZPass = ReplaceStencilOp;
  const tunnelRings: Mesh[] = [];
  for (let index = 0; index < 4; index += 1) {
    const tunnel = new Mesh(
      new TorusGeometry(0.44 - index * 0.055, 0.008, 8, 48),
      new MeshBasicMaterial({
        color: index % 2 === 0 ? color : hotColor,
        toneMapped: false,
        transparent: true,
        opacity: 0.42 - index * 0.07,
        depthWrite: false,
      }),
    );
    tunnel.scale.set(width, height, 1);
    tunnel.position.z = -0.05 - index * 0.025;
    tunnel.renderOrder = 2;
    tunnelRings.push(tunnel);
  }
  const sparkGeometry = new SphereGeometry(0.012, 6, 4);
  const sparkMaterial = new MeshBasicMaterial({
    color: hotColor,
    toneMapped: false,
  });
  const portalSparks = Array.from({ length: 18 }, (_, index) => {
    const spark = new Mesh(sparkGeometry, sparkMaterial);
    const angle = (index / 18) * Math.PI * 2;
    spark.position.set(
      Math.cos(angle) * 0.55 * width,
      Math.sin(angle) * 0.55 * height,
      0.04,
    );
    spark.scale.setScalar(index % 4 === 0 ? 1.6 : 1);
    spark.renderOrder = 6;
    return spark;
  });
  const light = new PointLight(color, 14, 5.5, 1.65);
  light.position.z = 0.42;
  const rimLight = new PointLight(hotColor, 7, 3.5, 2);
  rimLight.position.set(0, height * 0.2, 0.65);
  const playerBar = createVitalityBar(0x55cdf6, height * 0.63);
  const enemyBar = createVitalityBar(0xff4d3d, height * 0.56);
  group.add(
    window,
    ...tunnelRings,
    coronaRing,
    outerRing,
    ring,
    ...portalSparks,
    light,
    rimLight,
    playerBar.root,
    enemyBar.root,
  );
  group.userData.ring = ring;
  group.userData.aperture = window;
  group.userData.portalMaterial = portalMaterial;
  group.userData.portalRings = [ring, outerRing, coronaRing];
  group.userData.portalSparks = portalSparks;
  group.userData.portalWidth = width;
  group.userData.portalHeight = height;
  group.userData.portalLight = light;
  group.userData.rimLight = rimLight;
  group.userData.playerBar = playerBar.root;
  group.userData.playerBarFill = playerBar.fill;
  group.userData.enemyBar = enemyBar.root;
  group.userData.enemyBarFill = enemyBar.fill;
  return group;
}

function portalEpisode(snapshot: SimulationSnapshot) {
  if (
    snapshot.application !== "PLAYING" ||
    (snapshot.encounter !== "COMBAT" && snapshot.encounter !== "BOSS_COMBAT")
  ) {
    return undefined;
  }
  return `${snapshot.stage?.seed}:${snapshot.encounter}:${snapshot.waveIndex}`;
}

function configurePortalReveal(root: Object3D) {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 0;
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const material of materials) {
    material.stencilWrite = true;
    material.stencilRef = 1;
    material.stencilFunc = EqualStencilFunc;
    material.stencilFail = KeepStencilOp;
    material.stencilZFail = KeepStencilOp;
    material.stencilZPass = KeepStencilOp;
    material.needsUpdate = true;
  }
  root.userData.portalRevealMaterials = [...materials];
}

function releasePortalReveal(root: Object3D) {
  const materials = root.userData.portalRevealMaterials as
    Material[] | undefined;
  for (const material of materials ?? []) {
    material.stencilWrite = false;
    material.stencilFunc = AlwaysStencilFunc;
    material.needsUpdate = true;
  }
}

function createStageVista(stage: StageManifest, width: number, height: number) {
  const group = new Group();
  const neon = stage.theme === "neon-city";
  const frameColor = neon ? 0x49cfff : 0xffa83d;
  const frameMaterial = new MeshStandardMaterial({
    color: 0x17232a,
    roughness: 0.34,
    metalness: 0.72,
    emissive: new Color(frameColor).multiplyScalar(0.12),
  });
  const vistaMaterial = createVistaMaterial(stage.theme);
  const backdrop = new Mesh(new PlaneGeometry(width, height), vistaMaterial);
  backdrop.position.z = -0.07;
  const top = new Mesh(
    new BoxGeometry(width + 0.16, 0.075, 0.075),
    frameMaterial,
  );
  top.position.set(0, height * 0.5 + 0.045, 0);
  const bottom = top.clone();
  bottom.position.y *= -1;
  const left = new Mesh(new BoxGeometry(0.075, height, 0.075), frameMaterial);
  left.position.set(-width * 0.5 - 0.045, 0, 0);
  const right = left.clone();
  right.position.x *= -1;
  const sillGlow = new Mesh(
    new BoxGeometry(width, 0.018, 0.025),
    new MeshBasicMaterial({ color: frameColor, toneMapped: false }),
  );
  sillGlow.position.set(0, -height * 0.5 + 0.025, 0.045);
  group.add(backdrop, top, bottom, left, right, sillGlow);
  group.userData.vistaMaterial = vistaMaterial;
  group.userData.visualStyle = `stage-vista-${stage.windowView}`;
  return group;
}

const visualVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function createPortalMaterial(theme: StageTheme) {
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uTheme: { value: theme === "neon-city" ? 1 : 0 },
    },
    vertexShader: visualVertexShader,
    fragmentShader: portalFragmentShader,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: AlwaysStencilFunc,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: ReplaceStencilOp,
  });
  material.toneMapped = false;
  return material;
}

function createVistaMaterial(theme: StageTheme) {
  const plate = AssetManager.getTexture(
    theme === "neon-city" ? "vista-neon-city" : "vista-subway-platform",
  );
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTheme: { value: theme === "neon-city" ? 1 : 0 },
      uPlate: { value: plate },
      uHasPlate: { value: plate ? 1 : 0 },
    },
    vertexShader: visualVertexShader,
    fragmentShader: vistaFragmentShader,
  });
  material.toneMapped = false;
  return material;
}

const portalFragmentShader = `
uniform float uTime;
uniform float uOpen;
uniform float uTheme;
varying vec2 vUv;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

void main() {
  vec2 point = vUv - 0.5;
  float radius = length(point) * 2.0;
  float angle = atan(point.y, point.x);
  vec3 deep = mix(vec3(0.045, 0.012, 0.005), vec3(0.012, 0.006, 0.06), uTheme);
  vec3 primary = mix(vec3(1.0, 0.22, 0.035), vec3(0.44, 0.08, 1.0), uTheme);
  vec3 hot = mix(vec3(1.0, 0.78, 0.18), vec3(0.12, 0.82, 1.0), uTheme);
  float spiral = sin(radius * 34.0 - uTime * 5.5 + angle * 7.0);
  float filaments = pow(max(0.0, spiral), 9.0);
  float cells = hash21(floor((point + 0.5) * 22.0 + uTime * 0.15));
  float horizon = smoothstep(0.48, 0.0, abs(point.y + 0.12));
  float core = smoothstep(1.0, 0.0, radius);
  float edge = smoothstep(1.0, 0.72, radius) * smoothstep(0.62, 0.88, radius);
  vec3 color = deep * (0.65 + core * 0.35);
  color += primary * filaments * core * 0.42;
  color += hot * edge * (0.55 + 0.45 * sin(angle * 13.0 + uTime * 6.0));
  color += hot * horizon * cells * 0.2;
  color *= 0.55 + uOpen * 0.45;
  gl_FragColor = vec4(color, 1.0);
}
`;

const vistaFragmentShader = `
uniform float uTime;
uniform float uTheme;
uniform float uHasPlate;
uniform sampler2D uPlate;
varying vec2 vUv;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

float boxMask(vec2 point, vec2 center, vec2 halfSize) {
  vec2 distance = abs(point - center) - halfSize;
  return 1.0 - step(0.0, max(distance.x, distance.y));
}

vec3 neonCity(vec2 uv) {
  vec3 color = mix(vec3(0.005, 0.015, 0.055), vec3(0.07, 0.025, 0.15), uv.y);
  color += vec3(0.02, 0.18, 0.32) * pow(max(0.0, 1.0 - abs(uv.y - 0.38) * 4.0), 5.0);
  for (int layer = 0; layer < 3; layer++) {
    float depth = float(layer);
    float columns = 7.0 + depth * 4.0;
    float shiftedX = uv.x + depth * 0.073;
    float column = floor(shiftedX * columns);
    float localX = fract(shiftedX * columns);
    float height = 0.27 + hash21(vec2(column, depth + 2.0)) * (0.42 - depth * 0.06);
    float building = step(uv.y, height) * step(0.07, localX) * step(localX, 0.94);
    vec3 facade = mix(vec3(0.018, 0.035, 0.09), vec3(0.045, 0.025, 0.12), depth / 2.0);
    color = mix(color, facade, building * (0.88 - depth * 0.18));
    vec2 windows = fract(vec2(shiftedX * columns * 4.0, uv.y * 22.0));
    float lit = step(0.22, windows.x) * step(windows.x, 0.7) * step(0.28, windows.y) * step(windows.y, 0.68);
    lit *= building * step(0.54, hash21(floor(vec2(shiftedX * columns * 4.0, uv.y * 22.0)) + depth));
    vec3 windowColor = mix(vec3(1.0, 0.15, 0.66), vec3(0.08, 0.84, 1.0), hash21(vec2(column, depth)));
    color += windowColor * lit * (0.48 + depth * 0.16);
  }
  float road = 1.0 - smoothstep(0.12, 0.2, uv.y);
  color = mix(color, vec3(0.012, 0.02, 0.045), road * 0.86);
  float lane = smoothstep(0.025, 0.0, abs(fract((uv.x - 0.5) * 7.0) - 0.5));
  color += road * lane * vec3(0.04, 0.45, 0.7) * 0.32;
  vec2 rainUv = vec2(uv.x * 31.0 + uv.y * 5.0, uv.y * 8.0 + uTime * 2.6);
  float rain = smoothstep(0.08, 0.0, abs(fract(rainUv.x) - 0.5));
  rain *= smoothstep(0.78, 1.0, fract(rainUv.y + hash21(vec2(floor(rainUv.x), 1.0))));
  color += vec3(0.22, 0.72, 1.0) * rain * 0.5;
  color += vec3(0.25, 0.55, 0.8) * smoothstep(0.018, 0.0, abs(uv.x - uv.y - 0.28)) * 0.16;
  return color;
}

vec3 subway(vec2 uv) {
  vec2 point = uv - vec2(0.5, 0.44);
  vec3 color = mix(vec3(0.018, 0.016, 0.02), vec3(0.11, 0.055, 0.025), uv.y);
  float tunnel = smoothstep(0.58, 0.12, length(point * vec2(1.0, 1.6)));
  color += vec3(0.2, 0.08, 0.018) * tunnel * 0.65;
  float rays = smoothstep(0.018, 0.0, abs(fract(atan(point.y, point.x) * 5.1) - 0.5));
  color += rays * tunnel * vec3(0.19, 0.09, 0.025) * 0.4;
  float platform = 1.0 - smoothstep(0.2, 0.28, uv.y);
  color = mix(color, vec3(0.07, 0.065, 0.06), platform * 0.9);
  float railA = smoothstep(0.012, 0.0, abs(uv.y - (0.1 + abs(uv.x - 0.5) * 0.12)));
  float railB = smoothstep(0.012, 0.0, abs(uv.y - (0.17 + abs(uv.x - 0.5) * 0.08)));
  color += (railA + railB) * vec3(1.0, 0.38, 0.06) * 0.7;
  float cycle = mod(uTime, 12.0);
  float trainX = 1.15 - smoothstep(0.0, 5.0, cycle) * 0.72;
  vec2 trainPoint = vec2(uv.x - trainX, uv.y);
  float body = boxMask(trainPoint, vec2(0.0, 0.5), vec2(0.43, 0.23));
  color = mix(color, vec3(0.08, 0.22, 0.3), body);
  float stripe = boxMask(trainPoint, vec2(0.0, 0.37), vec2(0.42, 0.025));
  color += stripe * vec3(1.0, 0.28, 0.035) * 0.85;
  vec2 windowGrid = vec2(fract((trainPoint.x + 0.36) * 7.0), trainPoint.y);
  float windows = step(0.14, windowGrid.x) * step(windowGrid.x, 0.76);
  windows *= step(0.44, windowGrid.y) * step(windowGrid.y, 0.62) * body;
  color += windows * vec3(0.36, 0.84, 1.0) * (0.72 + 0.2 * sin(uTime * 3.0));
  float headlight = smoothstep(0.1, 0.0, length(trainPoint - vec2(-0.39, 0.42)));
  color += headlight * vec3(1.0, 0.62, 0.18) * 1.8;
  float warning = step(0.84, fract(uv.x * 11.0 + uTime * 0.12)) * platform;
  color += warning * vec3(0.9, 0.25, 0.025) * 0.18;
  return color;
}

void main() {
  vec2 plateUv = vec2(fract(vUv.x * 0.34 + (uTheme > 0.5 ? 0.56 : 0.32)), mix(0.35, 0.68, vUv.y));
  vec3 authored = texture2D(uPlate, plateUv).rgb;
  vec3 procedural = uTheme > 0.5 ? neonCity(vUv) : subway(vUv);
  vec3 color = mix(procedural, authored, uHasPlate * 0.88);
  if (uTheme > 0.5) {
    vec2 rainUv = vec2(vUv.x * 31.0 + vUv.y * 5.0, vUv.y * 8.0 + uTime * 2.6);
    float rain = smoothstep(0.08, 0.0, abs(fract(rainUv.x) - 0.5));
    rain *= smoothstep(0.78, 1.0, fract(rainUv.y + hash21(vec2(floor(rainUv.x), 1.0))));
    color += vec3(0.18, 0.62, 1.0) * rain * 0.28;
    color = mix(color, color * vec3(0.72, 0.9, 1.18), 0.22);
  } else {
    float cycle = mod(uTime, 12.0);
    float arrivalGlow = smoothstep(0.0, 4.0, cycle) * (1.0 - smoothstep(8.0, 12.0, cycle));
    color += vec3(1.0, 0.42, 0.08) * arrivalGlow * smoothstep(0.35, 0.0, length(vUv - vec2(0.58, 0.47))) * 0.24;
    color = mix(color, color * vec3(1.12, 0.88, 0.68), 0.2);
  }
  vec2 edge = vUv * (1.0 - vUv);
  float vignette = pow(max(0.0, edge.x * edge.y * 18.0), 0.24);
  color *= 0.56 + vignette * 0.44;
  color = color / (color + vec3(0.78));
  gl_FragColor = vec4(color, 1.0);
}
`;

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
  const gloveColor = boss ? 0x9f261f : 0xd62d35;
  const skinColor =
    archetype === "guard"
      ? 0x8f5137
      : archetype === "bruiser" || boss
        ? 0x6d3824
        : 0xb66f49;
  const trunksColor =
    archetype === "guard"
      ? 0x173748
      : archetype === "bruiser"
        ? 0x43213f
        : boss
          ? 0x351b48
          : 0x174b77;
  const skinMaterial = new MeshStandardMaterial({
    color: skinColor,
    roughness: 0.68,
    metalness: 0,
    emissive: new Color(skinColor).multiplyScalar(0.035),
  });
  const accentMaterial = new MeshStandardMaterial({
    color: accent,
    roughness: 0.4,
    emissive: new Color(accent).multiplyScalar(0.12),
  });
  const darkMaterial = new MeshStandardMaterial({
    color: 0x100d0d,
    roughness: 0.76,
    metalness: 0.04,
  });
  const trunksMaterial = new MeshStandardMaterial({
    color: trunksColor,
    roughness: 0.48,
    metalness: 0.08,
    emissive: new Color(trunksColor).multiplyScalar(0.04),
  });
  const gloveMaterial = new MeshStandardMaterial({
    color: gloveColor,
    roughness: 0.38,
    metalness: 0.05,
    emissive: new Color(gloveColor).multiplyScalar(0.055),
  });
  const torso = new Mesh(
    new CylinderGeometry(boss ? 0.38 : 0.32, 0.235, 0.65, 16),
    skinMaterial,
  );
  torso.position.y = 1.08;
  torso.scale.z = 0.72;
  const leftPectoral = new Mesh(
    new SphereGeometry(boss ? 0.22 : 0.185, 16, 10),
    skinMaterial,
  );
  leftPectoral.scale.set(1.18, 0.72, 0.62);
  leftPectoral.position.set(boss ? -0.19 : -0.16, 1.24, 0.19);
  const rightPectoral = leftPectoral.clone();
  rightPectoral.position.x *= -1;
  const abdominalGeometry = new SphereGeometry(0.09, 12, 8);
  const abdominals = Array.from({ length: 6 }, (_, index) => {
    const abdominal = new Mesh(abdominalGeometry, skinMaterial);
    abdominal.scale.set(0.82, 0.58, 0.42);
    abdominal.position.set(
      index % 2 === 0 ? -0.085 : 0.085,
      1.08 - Math.floor(index / 2) * 0.125,
      0.225,
    );
    return abdominal;
  });
  const waist = new Mesh(
    new CylinderGeometry(0.23, 0.27, 0.2, 14),
    trunksMaterial,
  );
  waist.position.y = 0.62;
  waist.scale.z = 0.78;
  const belt = new Mesh(
    new CylinderGeometry(0.275, 0.275, 0.11, 14),
    accentMaterial,
  );
  belt.position.y = 0.7;
  belt.scale.z = 0.82;
  const trunks = new Mesh(
    new CylinderGeometry(0.275, 0.31, 0.26, 14),
    trunksMaterial,
  );
  trunks.position.y = 0.53;
  trunks.scale.z = 0.8;

  const neck = new Mesh(
    new CylinderGeometry(0.105, 0.13, 0.16, 12),
    skinMaterial,
  );
  neck.position.y = 1.46;
  const head = new Mesh(new SphereGeometry(0.2, 18, 12), skinMaterial);
  head.scale.set(boss ? 1.08 : 0.98, 1.12, 0.9);
  head.position.y = 1.65;
  const leftEar = new Mesh(new SphereGeometry(0.045, 8, 6), skinMaterial);
  leftEar.scale.set(0.55, 1, 0.55);
  leftEar.position.set(-0.195, 1.66, 0);
  const rightEar = leftEar.clone();
  rightEar.position.x *= -1;
  const nose = new Mesh(new SphereGeometry(0.045, 8, 6), skinMaterial);
  nose.scale.set(0.68, 0.95, 1.1);
  nose.position.set(0, 1.65, 0.185);
  const leftEye = new Mesh(new SphereGeometry(0.018, 8, 6), darkMaterial);
  leftEye.position.set(-0.072, 1.7, 0.17);
  const rightEye = leftEye.clone();
  rightEye.position.x *= -1;
  const mouth = new Mesh(
    new BoxGeometry(0.09, 0.018, 0.018),
    boss ? darkMaterial : gloveMaterial,
  );
  mouth.position.set(0, 1.57, 0.174);
  const hair = new Mesh(
    new SphereGeometry(0.205, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56),
    darkMaterial,
  );
  hair.scale.set(boss ? 1.08 : 0.98, 0.82, 0.92);
  hair.position.set(0, 1.74, -0.015);
  const beard = new Mesh(new SphereGeometry(0.16, 12, 8), darkMaterial);
  beard.scale.set(1, 0.56, 0.82);
  beard.position.set(0, 1.55, 0.035);
  beard.visible = boss;

  const leftShoulder = new Mesh(
    new SphereGeometry(boss ? 0.19 : 0.155, 12, 8),
    skinMaterial,
  );
  leftShoulder.position.set(boss ? -0.42 : -0.355, 1.3, 0.015);
  const rightShoulder = leftShoulder.clone();
  rightShoulder.position.x *= -1;
  const leftUpperArm = new Mesh(
    new CylinderGeometry(0.085, 0.11, 0.34, 12),
    skinMaterial,
  );
  leftUpperArm.position.set(-0.455, 1.17, 0.065);
  leftUpperArm.rotation.z = -0.48;
  const rightUpperArm = leftUpperArm.clone();
  rightUpperArm.position.x *= -1;
  rightUpperArm.rotation.z *= -1;
  const leftElbow = new Mesh(new SphereGeometry(0.095, 10, 7), skinMaterial);
  leftElbow.position.set(-0.51, 1.04, 0.1);
  const rightElbow = leftElbow.clone();
  rightElbow.position.x *= -1;
  const leftForearm = new Mesh(
    new CylinderGeometry(0.09, 0.075, 0.34, 12),
    skinMaterial,
  );
  leftForearm.position.set(-0.47, 1.2, 0.16);
  leftForearm.rotation.set(-0.34, 0, 0.42);
  const rightForearm = leftForearm.clone();
  rightForearm.position.x *= -1;
  rightForearm.rotation.z *= -1;
  const leftCuff = new Mesh(
    new CylinderGeometry(0.12, 0.135, 0.17, 12),
    gloveMaterial,
  );
  leftCuff.position.set(-0.39, 1.3, 0.19);
  leftCuff.rotation.x = Math.PI / 2;
  const rightCuff = leftCuff.clone();
  rightCuff.position.x *= -1;
  const leftGlove = new Mesh(new SphereGeometry(0.175, 16, 10), gloveMaterial);
  leftGlove.scale.set(1.12, 1, 1.25);
  leftGlove.position.set(-0.38, 1.35, 0.24);
  const rightGlove = leftGlove.clone();
  rightGlove.position.x = 0.38;

  const hips = new Mesh(new BoxGeometry(0.46, 0.19, 0.3), trunksMaterial);
  hips.position.y = 0.5;
  const leftThigh = new Mesh(
    new CylinderGeometry(0.11, 0.135, 0.34, 12),
    skinMaterial,
  );
  leftThigh.position.set(-0.14, 0.34, 0);
  const rightThigh = leftThigh.clone();
  rightThigh.position.x *= -1;
  const leftKnee = new Mesh(new SphereGeometry(0.105, 10, 7), skinMaterial);
  leftKnee.position.set(-0.14, 0.19, 0.03);
  const rightKnee = leftKnee.clone();
  rightKnee.position.x *= -1;
  const leftShin = new Mesh(
    new CylinderGeometry(0.075, 0.095, 0.28, 10),
    skinMaterial,
  );
  leftShin.position.set(-0.14, 0.07, 0);
  const rightShin = leftShin.clone();
  rightShin.position.x *= -1;
  const leftBoot = new Mesh(new BoxGeometry(0.22, 0.12, 0.32), darkMaterial);
  leftBoot.position.set(-0.14, -0.02, 0.08);
  const rightBoot = leftBoot.clone();
  rightBoot.position.x *= -1;
  const arenaMaterial = new MeshBasicMaterial({
    color: accent,
    toneMapped: false,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const arenaBoundary = new Group();
  const frontRail = new Mesh(
    new BoxGeometry(1.75, 0.012, 0.018),
    arenaMaterial,
  );
  frontRail.position.set(0, 0.012, 0.82);
  const backRail = frontRail.clone();
  backRail.position.z = -0.82;
  const leftRail = new Mesh(new BoxGeometry(0.018, 0.012, 1.64), arenaMaterial);
  leftRail.position.set(-0.875, 0.012, 0);
  const rightRail = leftRail.clone();
  rightRail.position.x *= -1;
  arenaBoundary.add(frontRail, backRail, leftRail, rightRail);
  const fighterLight = new PointLight(
    theme === "neon-city" ? 0x58cfff : 0xffb35c,
    boss ? 5.5 : 3.5,
    3.2,
    2,
  );
  fighterLight.position.set(0, 1.45, 0.7);
  const opponentLeftKickTarget = new Group();
  opponentLeftKickTarget.name = "OpponentLeftKickTarget";
  opponentLeftKickTarget.position.set(-0.14, 0.19, 0.145);
  opponentLeftKickTarget.userData.size = [0.3, 0.3, 0.06] as const;
  const opponentRightKickTarget = new Group();
  opponentRightKickTarget.name = "OpponentRightKickTarget";
  opponentRightKickTarget.position.set(0.14, 0.19, 0.145);
  opponentRightKickTarget.userData.size = [0.3, 0.3, 0.06] as const;
  const opponentGroinKickTarget = new Group();
  opponentGroinKickTarget.name = "OpponentGroinKickTarget";
  opponentGroinKickTarget.position.set(0, 0.5, 0.16);
  opponentGroinKickTarget.userData.size = [0.28, 0.22, 0.06] as const;
  const opponentHeadPunchTarget = new Group();
  opponentHeadPunchTarget.name = "OpponentHeadPunchTarget";
  opponentHeadPunchTarget.position.set(0, 1.61, 0.12);
  const opponentUpperTorsoPunchTarget = new Group();
  opponentUpperTorsoPunchTarget.name = "OpponentUpperTorsoPunchTarget";
  opponentUpperTorsoPunchTarget.position.set(0, 1.12, 0.16);

  const attackTelegraph = new Mesh(
    new TorusGeometry(0.24, 0.025, 8, 24),
    new MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }),
  );
  attackTelegraph.position.z = 0.015;
  attackTelegraph.visible = false;
  rightGlove.add(attackTelegraph);
  reactionRoot.add(
    torso,
    leftPectoral,
    rightPectoral,
    ...abdominals,
    waist,
    belt,
    trunks,
    neck,
    head,
    leftEar,
    rightEar,
    nose,
    leftEye,
    rightEye,
    mouth,
    hair,
    beard,
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
  group.add(
    arenaBoundary,
    fighterLight,
    opponentLeftKickTarget,
    opponentRightKickTarget,
    opponentGroinKickTarget,
    opponentHeadPunchTarget,
    opponentUpperTorsoPunchTarget,
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
  group.userData.opponentLeftKickTarget = opponentLeftKickTarget;
  group.userData.opponentRightKickTarget = opponentRightKickTarget;
  group.userData.opponentGroinKickTarget = opponentGroinKickTarget;
  group.userData.opponentHeadPunchTarget = opponentHeadPunchTarget;
  group.userData.opponentUpperTorsoPunchTarget = opponentUpperTorsoPunchTarget;
  group.userData.leftGlove = leftGlove;
  group.userData.rightGlove = rightGlove;
  group.userData.attackTelegraph = attackTelegraph;
  group.userData.visualStyle = "project-owned-procedural-boxer-v1";
  group.userData.baseScale = boss ? 1.22 : 1;
  if (boss) group.scale.setScalar(group.userData.baseScale);
  return group;
}
