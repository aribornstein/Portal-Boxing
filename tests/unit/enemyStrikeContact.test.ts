import { describe, expect, it } from "vitest";

import { enemyStrikeConnects } from "../../src/combat/enemyStrikeContact.js";

describe("enemy strike contact", () => {
  it("connects only when the extended glove overlaps the player", () => {
    const player = { x: 0, y: 1.6, z: 0 };
    expect(enemyStrikeConnects({ x: 0.25, y: 1.35, z: 0.2 }, player, 0.6)).toBe(
      true,
    );
    expect(enemyStrikeConnects({ x: 0.25, y: 1.35, z: 0.8 }, player, 0.6)).toBe(
      false,
    );
  });

  it("rejects invalid contact radii", () => {
    const position = { x: 0, y: 0, z: 0 };
    expect(enemyStrikeConnects(position, position, 0)).toBe(false);
    expect(enemyStrikeConnects(position, position, Number.NaN)).toBe(false);
  });
});
