import { expect, it } from "vitest";
import { observationState } from "../../core/claudeObservation";

it("rejects malformed, duplicate, unsupported and failed observations without fabricating idle", () => {
  for (const entry of [null, {}, { kind: "interactive", status: "unknown" }, { kind: "interactive", status: "busy", state: "failed" }, { kind: "interactive", status: "busy", pid: -1 }, { kind: "background", state: "stopped", status: "idle" }]) {
    expect(observationState({ available: true, sessions: [entry && { sessionId: "exact", ...entry }] }, "exact")).toBeUndefined();
  }
  const entry = { sessionId: "exact", kind: "interactive", status: "busy" };
  for (const snapshot of [null, {}, { available: true, sessions: [entry, entry] }, { available: false, sessions: [entry] }, { available: true, error: "timeout", sessions: [entry] }, { available: true, sessions: [] }]) expect(observationState(snapshot, "exact")).toBeUndefined();
});

it("uses only exact official identity and background working takes precedence over idle", () => {
  expect(observationState({ available: true, sessions: [{ sessionId: "exact", kind: "background", state: "working", status: "idle" }] }, "exact")).toBe("working");
  expect(observationState({ available: true, sessions: [{ sessionId: "other", kind: "interactive", status: "busy" }] }, "exact")).toBeUndefined();
});
