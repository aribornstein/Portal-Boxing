import {
  classifySurface,
  createObservation,
  type Bounds3,
  type QuaternionTuple,
  type RoomObservation,
  type Vec3,
} from "./roomUnderstanding.js";

export interface PlaneObservationSnapshot {
  readonly id: string;
  readonly center: Vec3;
  readonly orientation: QuaternionTuple;
  readonly normal: Vec3;
  readonly localDimensions: Vec3;
  readonly worldBounds: Bounds3;
  readonly xAxis: Vec3;
  readonly zAxis: Vec3;
  readonly roomHeight: number;
  readonly observationTime: number;
}

export function createPlaneObservationFromSnapshot(
  snapshot: PlaneObservationSnapshot,
): RoomObservation {
  const label = classifySurface(
    snapshot.normal,
    snapshot.center[1],
    snapshot.roomHeight,
  );
  const dimensions = canonicalPlaneDimensions(
    snapshot.localDimensions,
    snapshot.xAxis,
    snapshot.zAxis,
    label === "wall",
  );
  const observation = createObservation(
    snapshot.id,
    label,
    snapshot.center,
    dimensions,
    snapshot.normal,
    "plane",
    1,
  );
  return {
    ...observation,
    pose: {
      position: snapshot.center,
      orientation: snapshot.orientation,
    },
    bounds: snapshot.worldBounds,
    orientedBounds: {
      center: snapshot.center,
      halfExtents: [
        snapshot.localDimensions[0] / 2,
        snapshot.localDimensions[1] / 2,
        snapshot.localDimensions[2] / 2,
      ],
      orientation: snapshot.orientation,
    },
    lastObservationTime: snapshot.observationTime,
  };
}

export function canonicalPlaneDimensions(
  localDimensions: Vec3,
  xAxis: Vec3,
  zAxis: Vec3,
  vertical: boolean,
): Vec3 {
  if (!vertical) return localDimensions;
  const xIsVertical = Math.abs(xAxis[1]) > Math.abs(zAxis[1]);
  return xIsVertical
    ? [localDimensions[2], localDimensions[0], localDimensions[1]]
    : [localDimensions[0], localDimensions[2], localDimensions[1]];
}
