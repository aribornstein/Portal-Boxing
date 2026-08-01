export type DestructionState = "intact" | "cracked" | "fractured" | "destroyed";

export interface DestructionPolicy {
  readonly permitted: boolean;
  readonly safetyCategory: "safe" | "review-required" | "restricted";
  readonly maximumFragments: number;
}

export class DestructibleProxy {
  private health: number;
  private currentState: DestructionState = "intact";

  constructor(
    readonly semanticObjectId: string,
    readonly maximumHealth: number,
    readonly policy: DestructionPolicy,
  ) {
    if (maximumHealth <= 0)
      throw new RangeError("Proxy health must be positive");
    this.health = maximumHealth;
  }

  get state() {
    return this.currentState;
  }
  get healthRatio() {
    return this.health / this.maximumHealth;
  }

  damage(amount: number) {
    if (
      !this.policy.permitted ||
      this.policy.safetyCategory !== "safe" ||
      amount <= 0
    )
      return this.currentState;
    this.health = Math.max(0, this.health - amount);
    const ratio = this.healthRatio;
    this.currentState =
      ratio === 0
        ? "destroyed"
        : ratio <= 0.33
          ? "fractured"
          : ratio <= 0.7
            ? "cracked"
            : "intact";
    return this.currentState;
  }

  requestedFragments() {
    if (this.currentState !== "destroyed") return 0;
    return Math.max(0, Math.min(12, this.policy.maximumFragments));
  }

  reset() {
    this.health = this.maximumHealth;
    this.currentState = "intact";
  }
}
