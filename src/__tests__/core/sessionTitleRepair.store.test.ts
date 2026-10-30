import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../core/persistence", () => ({ loadData: mocks.load, debouncedSave: mocks.save }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
import { useStore } from "../../core/store";

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ projects: [], loaded: false, activePid: "", activeSid: "" });
});

describe("stored mouse-protocol title repair", () => {
  it("replaces only a protocol-only damaged title without changing session identity or writing on load", async () => {
    const damaged = "35;189;7M<35;181;10M<35;177;11M<35;173;13M<35;170;14M<35;167;15M<35;165;15M<35;1";
    const sessions = [
      { id: "damaged", name: damaged, claudeSessionId: "conversation-1", hasConversation: true },
      { id: "custom", name: "Analyse 35;189;7M<35;181;10M", hasConversation: true },
      { id: "valid", name: "Postlik — connexion", hasConversation: false },
      { id: "terminal", name: damaged, type: "terminal", hasConversation: false },
    ];
    const data = { projects: [{ id: "p1", name: "Postlik", dir: "/test/project", sessions }], activePid: "p1", activeSid: "damaged", settings: {} };
    mocks.load.mockResolvedValue(data);
    await useStore.getState().init();
    const state = useStore.getState();
    expect(state.projects[0].sessions[0]).toEqual({ ...sessions[0], name: "session-1" });
    expect(state.projects[0].sessions.slice(1)).toEqual(sessions.slice(1));
    expect(state.activeSid).toBe("damaged");
    expect(sessions[0].name).toBe(damaged);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
