import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { enableSessionHooks: vi.fn() }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
import { useStore } from "../../core/store";
import { claude } from "../../core/api";
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ projects: [{ id: "p", name: "P", dir: "/p", sessions: [{ id: "s", name: "Main" }] }], settings: { ...useStore.getState().settings, autoNotifications: false } });
});
it("makes hook installation errors visible and supports retry even with notifications off", async () => {
  vi.mocked(claude.enableSessionHooks).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(false);
  await useStore.getState().enableProjectHooks("p");
  expect(useStore.getState().hookSetup.p).toBe("failed");
  await useStore.getState().enableProjectHooks("p");
  expect(useStore.getState().hookSetup.p).toBe("ready");
  expect(claude.enableSessionHooks).toHaveBeenCalledTimes(2);
  expect(useStore.getState().settings.autoNotifications).toBe(false);
});
