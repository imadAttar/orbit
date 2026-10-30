import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn().mockResolvedValue(null), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { sessionsSnapshot: vi.fn(), removeSessionHooks: vi.fn().mockResolvedValue(false), enableSessionHooks: vi.fn() }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, terminal: { notifyDone: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { claude } from "../../core/api";
import { loadData } from "../../core/persistence";
beforeEach(() => { vi.clearAllMocks(); useStore.setState({ projects: [], sessionStates: {}, hookSetup: {} }); });
afterEach(() => vi.useRealTimers());
it("never writes Claude configuration at init/add, independent of notifications", async () => {
  const settings = { ...useStore.getState().settings, autoNotifications: false };
  vi.mocked(loadData).mockResolvedValue({ projects: [{ id: "p", name: "P", dir: "/init", sessions: [{ id: "s", name: "Main" }] }], activePid: "p", activeSid: "s", settings });
  await useStore.getState().init();
  useStore.getState().addProject("New", "/added");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(Reflect.get(claude, "removeSessionHooks")).not.toHaveBeenCalled();
  expect(Reflect.get(claude, "enableSessionHooks")).not.toHaveBeenCalled();
  expect(useStore.getState().settings.autoNotifications).toBe(false);
});
it("observation lifecycle polls active runtimes with notifications off and stops on unmount", async () => {
  vi.useFakeTimers();
  vi.mocked(claude.sessionsSnapshot).mockResolvedValue({ available: true, sessions: [{ sessionId: "c", kind: "interactive", status: "waiting", waitingFor: "dialog open" }] });
  useStore.setState({ projects: [{ id: "p", name: "P", dir: "/p", sessions: [{ id: "s", name: "Main", claudeSessionId: "c", runtimeStatus: "running" }] }], settings: { ...useStore.getState().settings, autoNotifications: false } });
  const stop = useStore.getState().startClaudeObservation();
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().sessionStates.c).toBe("waiting");
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(claude.sessionsSnapshot).toHaveBeenCalledOnce();
});
