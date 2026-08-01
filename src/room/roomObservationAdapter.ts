import { Box3, Mesh, Quaternion, Vector3, type Object3D } from "@iwsdk/core";

import {
  type QuaternionTuple,
  type RoomObservation,
  type Vec3,
  createObservation,
} from "./roomUnderstanding.js";
import { createPlaneObservationFromSnapshot } from "./planeObservation.js";
import { normalizeSceneLabel } from "../semantics/sceneLabel.js";

export function createPlaneObservation(
  id: string,
  object: Object3D,
  roomHeight: number,
  observationTime: number,
): RoomObservation | undefined {
  if (!(object instanceof Mesh)) return undefined;
  object.updateWorldMatrix(true, false);
  object.geometry.computeBoundingBox();
  const localBounds = object.geometry.boundingBox;
  if (!localBounds) return undefined;

  const orientation = object.getWorldQuaternion(new Quaternion());
  const centerVector = object.getWorldPosition(new Vector3());
  const normalVector = new Vector3(0, 1, 0)
    .applyQuaternion(orientation)
    .normalize();
  const localSize = localBounds.getSize(new Vector3());
  const center = toVec3(centerVector);
  const orientationTuple = toQuaternion(orientation);
  const worldBounds = new Box3().setFromObject(object);
  const xAxis = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const zAxis = new Vector3(0, 0, 1).applyQuaternion(orientation);
  return createPlaneObservationFromSnapshot({
    id,
    center,
    orientation: orientationTuple,
    normal: toVec3(normalVector),
    localDimensions: toVec3(localSize),
    worldBounds: {
      min: toVec3(worldBounds.min),
      max: toVec3(worldBounds.max),
    },
    xAxis: toVec3(xAxis),
    zAxis: toVec3(zAxis),
    roomHeight,
    observationTime,
  });
}

export function createMeshObservation(
  id: string,
  object: Object3D,
  semanticLabel: string,
  observationTime: number,
): RoomObservation | undefined {
  if (!(object instanceof Mesh)) return undefined;
  object.updateWorldMatrix(true, false);
  const worldBounds = new Box3().setFromObject(object);
  if (worldBounds.isEmpty()) return undefined;
  const centerVector = worldBounds.getCenter(new Vector3());
  const size = worldBounds.getSize(new Vector3());
  const orientation = object.getWorldQuaternion(new Quaternion());
  const label = normalizeSceneLabel(semanticLabel);
  const center = toVec3(centerVector);
  const normal: Vec3 =
    label === "wall"
      ? size.x <= size.z
        ? [1, 0, 0]
        : [0, 0, 1]
      : label === "ceiling"
        ? [0, -1, 0]
        : [0, 1, 0];
  const dimensions: Vec3 =
    label === "wall"
      ? [Math.max(size.x, size.z), size.y, Math.min(size.x, size.z)]
      : toVec3(size);
  const observation = createObservation(
    id,
    label,
    center,
    dimensions,
    normal,
    "mesh",
    semanticLabel ? 0.95 : 0.6,
  );
  return {
    ...observation,
    pose: { position: center, orientation: toQuaternion(orientation) },
    bounds: {
      min: toVec3(worldBounds.min),
      max: toVec3(worldBounds.max),
    },
    lastObservationTime: observationTime,
  };
}

function toVec3(vector: Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

function toQuaternion(quaternion: Quaternion): QuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}
