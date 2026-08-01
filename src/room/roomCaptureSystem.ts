import { createSystem, Vector3, XRMesh, XRPlane } from "@iwsdk/core";

import {
  mergeDuplicateSurfaces,
  type RoomObservation,
  type Vec3,
} from "./roomUnderstanding.js";
import {
  createMeshObservation,
  createPlaneObservation,
} from "./roomObservationAdapter.js";

export interface LiveRoomCapture {
  readonly observations: readonly RoomObservation[];
  readonly playerPosition: Vec3;
}

export class RoomCaptureSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  capture(roomHeight = 2.5): LiveRoomCapture {
    const observationTime = performance.now() * 0.001;
    const observations: RoomObservation[] = [];
    for (const entity of this.queries.planes.entities) {
      if (!entity.object3D) continue;
      const observation = createPlaneObservation(
        `xr-plane-${entity.index}`,
        entity.object3D,
        roomHeight,
        observationTime,
      );
      if (observation) observations.push(observation);
    }
    for (const entity of this.queries.meshes.entities) {
      if (!entity.object3D || !entity.getValue(XRMesh, "isBounded3D")) continue;
      const observation = createMeshObservation(
        `xr-mesh-${entity.index}`,
        entity.object3D,
        entity.getValue(XRMesh, "semanticLabel") ?? "",
        observationTime,
      );
      if (observation) observations.push(observation);
    }
    const viewer = this.camera.getWorldPosition(new Vector3());
    return {
      observations: mergeDuplicateSurfaces(observations),
      playerPosition: [viewer.x, viewer.y, viewer.z],
    };
  }
}
