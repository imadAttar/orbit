import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../core/types";
vi.mock("../../core/api", () => ({ orbit: { readFile: vi.fn(), writeFile: vi.fn().mockResolvedValue(undefined) }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(), BaseDirectory: { Home: 1 } }));
import { orbit } from "../../core/api";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { loadData } from "../../core/persistence";
import { useStore } from "../../core/store";
const initial = useStore.getInitialState();
const projects = (): Project[] => [
  { id: "a", name: "A", dir: "/a", sessions: [{ id: "archived", name: "Archive", archivedAt: 0, runtimeStatus: "running" }, { id: "live", name: "Live", runtimeStatus: "running", claudeSessionId: "c" }] },
  { id: "b", name: "B", dir: "/b", sessions: [{ id: "old", name: "Old", archivedAt: 1 }] },
];
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initial, true);
  vi.mocked(readTextFile).mockRejectedValue(new Error("missing"));
  vi.mocked(orbit.readFile).mockRejectedValue(new Error("missing"));
});
describe("safe restoration", () => {
  it("defaults analytics off for new users", async () => {
    await useStore.getState().init();
    expect(useStore.getState().settings.analytics).toBe(false);
  });
  it.each([true, false])("restores preferences without projects, including analytics %s", async (analytics) => {
    vi.mocked(orbit.readFile).mockResolvedValue(JSON.stringify({ projects: [], activePid: "", activeSid: "", settings: { analytics, fontSize: 17 } }));
    await useStore.getState().init();
    expect(useStore.getState().projects).toEqual([]);
    expect(useStore.getState().settings).toMatchObject({ analytics, fontSize: 17 });
  });
  it.each(["archived", "missing"])("repairs a legacy %s active session, forgets stale runtime and repairs all-archive projects", async (activeSid) => {
    vi.mocked(orbit.readFile).mockResolvedValue(JSON.stringify({ projects: projects(), activePid: "a", activeSid, settings: { analytics: true }, projectSessions: { a: "archived", b: "old", ghost: "x" } }));
    useStore.setState({ sessionStates: { c: "working" }, sessionTools: { c: "Read" } });
    await useStore.getState().init();
    const state = useStore.getState();
    expect(state.activeSid).toBe("live");
    expect(state.projects.flatMap((p) => p.sessions).some((s) => s.runtimeStatus === "running")).toBe(false);
    expect(state.sessionStates).toEqual({});
    expect(state.sessionTools).toEqual({});
    expect(state.projectSessions.ghost).toBeUndefined();
    expect(state.projectSessions.a).toBe("live");
    const fallback = state.projects[1].sessions.find((s) => s.archivedAt === undefined);
    expect(fallback).toBeDefined();
    expect(state.projectSessions.b).toBe(fallback?.id);
    expect(state.projects[1].sessions.find((s) => s.id === "old")?.archivedAt).toBe(1);
    expect(state.settings.analytics).toBe(true);
  });
  it("repairs an invalid project and missing legacy session maps", async () => {
    vi.mocked(orbit.readFile).mockResolvedValue(JSON.stringify({ projects: projects(), activePid: "gone", activeSid: "gone", settings: {} }));
    await useStore.getState().init();
    expect(useStore.getState()).toMatchObject({ activePid: "a", activeSid: "live", projectSessions: { a: "live" } });
  });
  it("accepts legacy project data without active identifiers", async () => {
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      if (String(path).startsWith(".claude-ide/")) return JSON.stringify({ projects: projects(), settings: { fontSize: 15 } });
      throw new Error("missing");
    });
    expect(await loadData()).toMatchObject({ projects: expect.any(Array), settings: { fontSize: 15 } });
    expect(orbit.writeFile).toHaveBeenCalled();
  });
  it("falls back after invalid project data instead of crashing", async () => {
    vi.mocked(orbit.readFile).mockResolvedValue(JSON.stringify({ projects: { length: 1 }, activePid: "a" }));
    expect(await loadData()).toBeNull();
  });
});
