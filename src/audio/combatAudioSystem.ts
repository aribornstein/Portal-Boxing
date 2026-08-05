import {
  AudioSource,
  AudioUtils,
  createSystem,
  Object3D,
  PlaybackMode,
} from "@iwsdk/core";
import type { Entity } from "@iwsdk/core";

import type {
  GameSimulation,
  SimulationSnapshot,
} from "../app/gameSimulation.js";
import {
  selectCombatAudioCuesInto,
  type CombatAudioCue,
} from "./combatAudioEvents.js";

const audioRoot = "./assets/audio";

export class CombatAudioSystem extends createSystem({}) {
  private previousSnapshot: SimulationSnapshot | undefined;
  private readonly pendingCues: CombatAudioCue[] = [];
  private cues: Record<CombatAudioCue, Entity> | undefined;

  init() {
    const simulation = this.globals.portalBoxingSimulation as
      GameSimulation | undefined;
    if (!simulation) return;
    this.cues = {
      portal: this.createCue("portal", true, 0.65),
      "target-lock": this.createCue(
        "target-lock",
        false,
        0.65,
        1,
        "/audio/chime.mp3",
      ),
      hit: this.createCue("hit", true, 0.7, 3),
      "kick-hit": this.createCue("kick-hit", true, 0.78, 2),
      "player-hit": this.createCue("player-hit", false, 0.7, 2),
      guard: this.createCue("guard", false, 0.6, 2),
      "wave-clear": this.createCue("wave-clear", false, 0.5),
      knockout: this.createCue("knockout", false, 0.7),
    };
    const cueEntities = Object.values(this.cues);
    this.cleanupFuncs.push(
      simulation.subscribe((snapshot) => this.handleSnapshot(snapshot)),
      () => {
        for (const entity of cueEntities) entity.dispose();
      },
    );
  }

  private handleSnapshot(snapshot: SimulationSnapshot) {
    this.syncSpatialPositions(snapshot);
    if (this.previousSnapshot && this.cues) {
      selectCombatAudioCuesInto(
        this.previousSnapshot,
        snapshot,
        this.pendingCues,
      );
      for (const cue of this.pendingCues) AudioUtils.play(this.cues[cue]);
    }
    this.previousSnapshot = snapshot;
  }

  private syncSpatialPositions(snapshot: SimulationSnapshot) {
    const cues = this.cues;
    const portal = snapshot.stage?.portalPlacements[snapshot.activePortalIndex];
    if (!cues || !portal) return;
    cues.portal.object3D?.position.set(...portal.center);
    cues.hit.object3D?.position.set(
      portal.center[0] + portal.facing[0] * 0.85,
      1.2,
      portal.center[2] + portal.facing[2] * 0.85,
    );
    cues["kick-hit"].object3D?.position.copy(cues.hit.object3D!.position);
  }

  private createCue(
    name: CombatAudioCue,
    positional: boolean,
    volume: number,
    maxInstances = 1,
    src = `${audioRoot}/${name}.wav`,
  ) {
    const object = new Object3D();
    object.name = `Audio-${name}`;
    const entity = this.world.createTransformEntity(object, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
    entity.addComponent(AudioSource, {
      src,
      positional,
      volume,
      refDistance: 0.8,
      maxDistance: 8,
      playbackMode:
        maxInstances > 1 ? PlaybackMode.Overlap : PlaybackMode.Restart,
      maxInstances,
    });
    return entity;
  }
}
