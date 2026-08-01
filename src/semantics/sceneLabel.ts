import { roomLabels, type RoomLabel } from "./roomTaxonomy.js";

const aliases: Readonly<Record<string, RoomLabel>> = {
  couch: "sofa",
  door_frame: "door",
  global_mesh: "unknown structural surface",
  other: "unknown object",
  screen: "television",
  storage: "cabinet",
  wall_face: "wall",
  window_frame: "window",
};

export function normalizeSceneLabel(label: string): RoomLabel {
  const normalized = label.trim().toLowerCase().replace(/[ -]+/g, "_");
  const alias = aliases[normalized];
  if (alias) return alias;
  const spaced = normalized.replace(/_/g, " ") as RoomLabel;
  return roomLabels.includes(spaced) ? spaced : "unknown object";
}
