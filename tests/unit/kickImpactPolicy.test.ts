import { describe, expect, it } from "vitest";

import { resolveKickImpactPolicy } from "../../src/combat/kickImpactPolicy.js";
import type { KickRecognitionDecision } from "../../src/combat/kickRecognition.js";

const accepted: KickRecognitionDecision = {
  decision: "kick",
  targetId: "opponent-left-target",
  speedMps: 2,
  confidence: 0.8,
  provenance: "depth-hand-fallback",
};

describe("kick impact policy", () => {
  it("authorizes an accepted kick independently of debug state", () => {
    expect(resolveKickImpactPolicy(accepted)).toEqual({
      kind: "accepted-impact",
    });
  });

  it("never promotes a rejection to an impact", () => {
    expect(
      resolveKickImpactPolicy({
        ...accepted,
        decision: "reject",
        rejectReason: "insufficient-motion",
      }),
    ).toEqual({ kind: "rejection-diagnostic" });
  });
});
