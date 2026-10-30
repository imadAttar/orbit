import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({ available: false, sessions: [], error: "unavailable" }) }));
import { invoke } from "@tauri-apps/api/core";
import * as api from "../../core/api";
import { claude } from "../../core/api";
it("exposes no statusline or hook-install API", () => {
  expect(api).not.toHaveProperty("statusline");
  expect(claude).not.toHaveProperty("enableSessionHooks");
  expect(claude).not.toHaveProperty("checkSessionHooks");
  expect(claude).not.toHaveProperty("removeSessionHooks");
});
it("uses only the official read-only native snapshot command", async () => {
  await claude.sessionsSnapshot();
  expect(invoke).toHaveBeenLastCalledWith("claude_sessions_snapshot", undefined);
});
