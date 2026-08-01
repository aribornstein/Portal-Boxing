import { describe, expect, it, vi } from "vitest";

import {
  ApplicationState,
  applicationTransitions,
  EncounterState,
  encounterTransitions,
  IllegalTransitionError,
  StateMachine,
} from "../../src/state/stateMachine.js";

describe("StateMachine", () => {
  it("records and publishes a legal transition", () => {
    const machine = new StateMachine(
      ApplicationState.Boot,
      applicationTransitions,
    );
    const observer = vi.fn();
    const unsubscribe = machine.subscribe(observer);

    const transition = machine.transition(
      ApplicationState.LoadingRuntime,
      "bootstrap",
      12,
    );

    expect(machine.state).toBe(ApplicationState.LoadingRuntime);
    expect(transition).toEqual({
      from: ApplicationState.Boot,
      to: ApplicationState.LoadingRuntime,
      reason: "bootstrap",
      timestamp: 12,
    });
    expect(observer).toHaveBeenCalledWith(transition);
    unsubscribe();
  });

  it("rejects an illegal transition without mutating state", () => {
    const machine = new StateMachine(
      ApplicationState.Boot,
      applicationTransitions,
    );

    expect(() =>
      machine.transition(ApplicationState.Playing, "skip setup", 1),
    ).toThrow(IllegalTransitionError);
    expect(machine.state).toBe(ApplicationState.Boot);
    expect(machine.history).toHaveLength(0);
  });

  it("bounds transition history", () => {
    const machine = new StateMachine(
      EncounterState.Idle,
      encounterTransitions,
      2,
    );

    machine.transition(EncounterState.PortalCharging, "start", 1);
    machine.transition(EncounterState.PortalOpening, "charged", 2);
    machine.transition(EncounterState.WaveAnnouncement, "opened", 3);

    expect(machine.history).toHaveLength(2);
    expect(machine.history[0]?.from).toBe(EncounterState.PortalCharging);
  });

  it("requires a positive history bound", () => {
    expect(
      () => new StateMachine(ApplicationState.Boot, applicationTransitions, 0),
    ).toThrow(RangeError);
  });
});
