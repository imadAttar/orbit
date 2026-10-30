import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Settings } from "../../core/types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
// Exercise real persistence/API code, with no access to native disk or user HOME.
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-fs", () => ({}));

const runtime = globalThis as typeof globalThis & { __orbitPersistence?: unknown };
const settings: Settings = {
  terminal: "default", editor: "vscode", theme: "orbit", fontSize: 12, sidebarWidth: 220,
  analytics: false, statuslineAsked: true, autoUpdate: false, defaultMode: "normal",
  language: "fr", autoNotifications: false,
};
const snapshot = (id: string) => ({ projects: [], activePid: id, activeSid: "", settings });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  native.invoke.mockReset();
  delete runtime.__orbitPersistence;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete runtime.__orbitPersistence;
});

it("keeps a refreshed module's save behind an old in-flight write", async () => {
  let finishOld!: () => void;
  const oldWrite = new Promise<void>((resolve) => { finishOld = resolve; });
  const published: string[] = [];
  let disk = "";
  native.invoke.mockImplementation(async (command, args) => {
    expect(command).toBe("write_orbit_file");
    expect(args.name).toBe("data.json");
    const id = JSON.parse(args.data).activePid;
    if (id === "old") await oldWrite;
    disk = id;
    published.push(id);
  });
  const before = await import("../../core/persistence");
  before.debouncedSave(snapshot("old"));
  await vi.advanceTimersByTimeAsync(300);
  expect(native.invoke).toHaveBeenCalledOnce();

  vi.resetModules();
  const after = await import("../../core/persistence");
  try {
    after.debouncedSave(snapshot("new"));
    await vi.advanceTimersByTimeAsync(300);
  } finally {
    finishOld();
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(published).toEqual(["old", "new"]);
  expect(disk).toBe("new");
});

it("cancels an old module's pending debounce when the refreshed module saves", async () => {
  const published: string[] = [];
  native.invoke.mockImplementation(async (command, args) => {
    expect(command).toBe("write_orbit_file");
    published.push(JSON.parse(args.data).activePid);
  });
  const before = await import("../../core/persistence");
  before.debouncedSave(snapshot("old"));
  await vi.advanceTimersByTimeAsync(200);
  vi.resetModules();
  const after = await import("../../core/persistence");
  after.debouncedSave(snapshot("new"));

  await vi.advanceTimersByTimeAsync(100);
  expect(published).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  expect(published).toEqual(["new"]);
});

it("keeps production scheduling module-local without using or replacing dev state", async () => {
  vi.stubEnv("DEV", false);
  const devState = { queue: Promise.resolve(), timeout: null };
  runtime.__orbitPersistence = devState;
  const published: string[] = [];
  native.invoke.mockImplementation(async (_command, args) => {
    published.push(JSON.parse(args.data).activePid);
  });
  const before = await import("../../core/persistence");
  before.debouncedSave(snapshot("first"));
  vi.resetModules();
  const after = await import("../../core/persistence");
  after.debouncedSave(snapshot("second"));
  await vi.advanceTimersByTimeAsync(300);

  expect(published).toEqual(["first", "second"]);
  expect(runtime.__orbitPersistence).toBe(devState);
  expect(devState.timeout).toBeNull();
});
