import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { sessionsSnapshot: vi.fn(), enableSessionHooks: vi.fn(), removeSessionHooks: vi.fn() }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { claude } from "../../core/api";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useStore.setState({ hookSetup: {}, sessionStates: {}, sessionRuntimeStartedAt: {}, projects: [{ id: "p", name: "P", dir: "/p", sessions: [{ id: "s", name: "Main", claudeSessionId: "c", runtimeStatus: "running" }] }], settings: { ...useStore.getState().settings, autoNotifications: false } });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });
it("makes native snapshot failure visible and retries without hook configuration writes", async () => {
  vi.mocked(claude.sessionsSnapshot).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ available: true, sessions: [{ sessionId: "c", kind: "interactive", status: "busy" }] });
  stop = useStore.getState().startClaudeObservation();
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().hookSetup.p).toBe("failed");
  await useStore.getState().enableProjectHooks("p");
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().hookSetup.p).toBe("ready");
  expect(useStore.getState().sessionStates.c).toBe("working");
  expect(claude.sessionsSnapshot).toHaveBeenCalledTimes(2);
  expect(Reflect.get(claude, "enableSessionHooks")).not.toHaveBeenCalled();
  expect(Reflect.get(claude, "removeSessionHooks")).not.toHaveBeenCalled();
  expect(useStore.getState().settings.autoNotifications).toBe(false);
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(claude.sessionsSnapshot).toHaveBeenCalledTimes(2);
});
