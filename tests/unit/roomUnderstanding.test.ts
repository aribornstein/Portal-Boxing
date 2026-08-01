import { describe, expect, it } from "vitest";

import { validatePortalSurface } from "../../src/portal/portalCandidateService.js";
import { createPlaneObservationFromSnapshot } from "../../src/room/planeObservation.js";
import {
  calculateSafeZone,
  classifySurface,
  createObservation,
  mergeDuplicateSurfaces,
  smoothBounds,
} from "../../src/room/roomUnderstanding.js";
import { fuseSemanticEvidence } from "../../src/semantics/semanticFusion.js";
import { normalizeSceneLabel } from "../../src/semantics/sceneLabel.js";

describe("room understanding", () => {
  it("converts rotated IWSDK plane meshes into canonical room surfaces", () => {
    const floor = createPlaneObservationFromSnapshot({
      id: "plane-floor",
      center: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      normal: [0, 1, 0],
      localDimensions: [4, 0.001, 3],
      worldBounds: { min: [-2, 0, -1.5], max: [2, 0.001, 1.5] },
      xAxis: [1, 0, 0],
      zAxis: [0, 0, 1],
      roomHeight: 2.5,
      observationTime: 12,
    });
    expect(floor.label).toBe("floor");
    expect(floor.dimensions).toEqual([4, 0.001, 3]);
    expect(floor.lastObservationTime).toBe(12);

    const wall = createPlaneObservationFromSnapshot({
      id: "plane-wall",
      center: [0, 1.25, -2],
      orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      normal: [0, 0, 1],
      localDimensions: [3.2, 0.001, 2.5],
      worldBounds: { min: [-1.6, 0, -2], max: [1.6, 2.5, -1.999] },
      xAxis: [1, 0, 0],
      zAxis: [0, -1, 0],
      roomHeight: 2.5,
      observationTime: 13,
    });
    expect(wall.label).toBe("wall");
    expect(wall.dimensions[0]).toBeCloseTo(3.2);
    expect(wall.dimensions[1]).toBeCloseTo(2.5);
    expect(wall.normal[2]).toBeCloseTo(1);
  });

  it("classifies structural orientations", () => {
    expect(classifySurface([0, 1, 0], 0, 2.5)).toBe("floor");
    expect(classifySurface([0, -1, 0], 2.5, 2.5)).toBe("ceiling");
    expect(classifySurface([0, 0, 1], 1.2, 2.5)).toBe("wall");
  });

  it("normalizes Quest scene labels without trusting unknown categories", () => {
    expect(normalizeSceneLabel("WALL_FACE")).toBe("wall");
    expect(normalizeSceneLabel("COUCH")).toBe("sofa");
    expect(normalizeSceneLabel("unrecognized-category")).toBe("unknown object");
  });

  it("merges duplicate surfaces while preserving provenance", () => {
    const left = createObservation(
      "plane-a",
      "wall",
      [0, 1.2, -2],
      [2, 2.4, 0.05],
      [0, 0, 1],
      "plane",
      0.8,
    );
    const right = createObservation(
      "mesh-b",
      "wall",
      [0.05, 1.2, -2],
      [2.2, 2.4, 0.05],
      [0, 0, 1],
      "mesh",
      0.9,
    );
    const merged = mergeDuplicateSurfaces([left, right]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.rawObservationIds).toEqual(["plane-a", "mesh-b"]);
    expect(merged[0]?.provenance).toEqual(["plane", "mesh"]);
  });

  it("smooths unstable bounds", () => {
    const result = smoothBounds(
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [1, 1, 1], max: [3, 3, 3] },
      0.25,
    );
    expect(result.min).toEqual([0.25, 0.25, 0.25]);
    expect(result.max).toEqual([1.5, 1.5, 1.5]);
  });

  it("disables kicks for inadequate clearance or restricted objects", () => {
    const floor = createObservation(
      "floor",
      "floor",
      [0, 0, 0],
      [4, 0.05, 4],
      [0, 1, 0],
      "plane",
      1,
    );
    const restricted = createObservation(
      "glass",
      "glass",
      [0.5, 0.5, 0],
      [0.5, 1, 0.1],
      [0, 0, 1],
      "user",
      1,
    );
    expect(calculateSafeZone(floor, []).kickEnabled).toBe(true);
    expect(calculateSafeZone(floor, [restricted]).kickEnabled).toBe(false);
  });

  it("requires review before uncertain semantics become interactive", () => {
    const uncertain = fuseSemanticEvidence({
      evidence: [{ label: "chair", score: 0.7, source: "siglip2" }],
      dimensions: [0.5, 1, 0.5],
    });
    expect(uncertain.interactionSafe).toBe(false);
    const confirmed = fuseSemanticEvidence({
      evidence: [{ label: "chair", score: 0.7, source: "siglip2" }],
      dimensions: [0.5, 1, 0.5],
      userLabel: "chair",
    });
    expect(confirmed.interactionSafe).toBe(true);
  });

  it("rejects unsafe portal placements and separates valid portals", () => {
    const wall = createObservation(
      "wall",
      "wall",
      [0, 1.2, -2.5],
      [3, 2.4, 0.05],
      [0, 0, 1],
      "plane",
      1,
    );
    const first = validatePortalSurface(wall, [0, 1.6, 0], [], []);
    expect(first.candidate?.facing[2]).toBeGreaterThan(0);
    const duplicate = validatePortalSurface(
      wall,
      [0, 1.6, 0],
      [],
      [first.candidate!],
    );
    expect(duplicate.reasons).toContain("Portal overlaps an existing portal");
  });
});
