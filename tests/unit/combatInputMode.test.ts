import { describe, expect, it } from "vitest";

import { combatInputMode } from "../../src/combat/combatInputMode.js";

describe("combat input mode", () => {
  it("uses controllers while they are primary", () => {
    expect(combatInputMode({})).toBe("controller");
  });

  it("switches to hands when a tracked hand becomes primary", () => {
    expect(combatInputMode({ hand: {} })).toBe("hand");
  });

  it("reports no combat input when the side is untracked", () => {
    expect(combatInputMode(undefined)).toBe("none");
  });
});
