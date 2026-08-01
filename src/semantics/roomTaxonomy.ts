export const roomLabels = [
  "floor",
  "wall",
  "ceiling",
  "door",
  "window",
  "opening",
  "stairs",
  "unknown structural surface",
  "sofa",
  "chair",
  "table",
  "coffee table",
  "desk",
  "shelf",
  "cabinet",
  "bed",
  "lamp",
  "television",
  "monitor",
  "plant",
  "box",
  "stool",
  "pillow",
  "book",
  "remote",
  "handheld object",
  "unknown furniture",
  "unknown object",
  "person",
  "pet",
  "fragile object",
  "glass",
  "sharp object",
  "heat source",
  "restricted area",
  "uncertain obstacle",
] as const;

export type RoomLabel = (typeof roomLabels)[number];
export type SafetyPolicy =
  "structural" | "safe-proxy" | "review-required" | "restricted";

const restrictedLabels = new Set<RoomLabel>([
  "person",
  "pet",
  "fragile object",
  "glass",
  "sharp object",
  "heat source",
  "restricted area",
  "uncertain obstacle",
]);
const reviewLabels = new Set<RoomLabel>([
  "unknown structural surface",
  "unknown furniture",
  "unknown object",
  "handheld object",
]);
const structuralLabels = new Set<RoomLabel>([
  "floor",
  "wall",
  "ceiling",
  "door",
  "window",
  "opening",
  "stairs",
  "unknown structural surface",
]);

export function safetyPolicyForLabel(label: RoomLabel): SafetyPolicy {
  if (restrictedLabels.has(label)) return "restricted";
  if (reviewLabels.has(label)) return "review-required";
  if (structuralLabels.has(label)) return "structural";
  return "safe-proxy";
}

export function isInteractionSafe(
  label: RoomLabel,
  confidence: number,
  userConfirmed: boolean,
) {
  const policy = safetyPolicyForLabel(label);
  return (
    policy === "safe-proxy" &&
    confidence >= 0.75 &&
    (confidence >= 0.9 || userConfirmed)
  );
}
