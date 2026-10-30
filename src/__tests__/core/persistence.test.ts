import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Settings } from "../../core/types";

const mocks = vi.hoisted(() => ({
  write: vi.fn(), rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(), error: vi.fn(),
  open: vi.fn(), fileWrite: vi.fn(), close: vi.fn(),
}));
vi.mock("../../core/api", () => ({ orbit: { writeFile: mocks.write } }));
vi.mock("../../lib/logger", () => ({ logger: { error: mocks.error } }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  rename: mocks.rename, remove: mocks.remove,
  mkdir: mocks.mkdir, BaseDirectory: { Home: 1 },
  open: mocks.open,
}));
import { debouncedSave } from "../../core/persistence";

const settings: Settings = {
  terminal: "default", editor: "vscode", theme: "orbit", fontSize: 12, sidebarWidth: 220,
  analytics: false, statuslineAsked: true, autoUpdate: false, defaultMode: "normal",
  language: "fr", autoNotifications: false,
};
const snapshot = (id: string) => ({ projects: [], activePid: id, activeSid: "", settings });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.write.mockResolvedValue(undefined);

  mocks.rename.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.fileWrite.mockImplementation(async (bytes: Uint8Array) => bytes.length);
  mocks.close.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue({ write: mocks.fileWrite, close: mocks.close });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("publishes fallback saves by renaming a unique temporary file, never by truncating data.json", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));
  debouncedSave(snapshot("latest"));
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.open).toHaveBeenCalledOnce();
  const [temporary, options] = mocks.open.mock.calls[0];
  const json = new TextDecoder().decode(mocks.fileWrite.mock.calls[0][0]);
  expect(temporary).toMatch(/^\.orbit\/\.data-[\w-]+\.tmp$/);
  expect(JSON.parse(json).activePid).toBe("latest");
  expect(options).toMatchObject({ baseDir: 1, createNew: true });
  expect(mocks.rename).toHaveBeenCalledWith(temporary, ".orbit/data.json", { oldPathBaseDir: 1, newPathBaseDir: 1 });
  expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.rename.mock.invocationCallOrder[0]);
});

it("cleans up a failed fallback publication and reports the failure without an unhandled rejection", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));
  mocks.rename.mockRejectedValue(new Error("disk failure"));
  debouncedSave(snapshot("latest"));
  await vi.advanceTimersByTimeAsync(300);
  const [temporary] = mocks.open.mock.calls[0];
  expect(mocks.remove).toHaveBeenCalledWith(temporary, { baseDir: 1 });
  expect(mocks.error).toHaveBeenCalledWith("persistence", "Impossible de sauvegarder les donnees Orbit");
});

it("removes an owned partial temporary when writing fails", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));

  mocks.fileWrite.mockRejectedValue(new Error("partial write"));
  debouncedSave(snapshot("latest"));
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.rename).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
});

it("does not delete a preexisting file when exclusive creation fails", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));
  mocks.open.mockRejectedValue(new Error("already exists"));
  debouncedSave(snapshot("latest"));
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.fileWrite).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rename).not.toHaveBeenCalled();
});

it("handles short writes without truncating UTF-8 JSON", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));
  const chunks: number[] = [];
  mocks.fileWrite.mockImplementation(async (bytes: Uint8Array) => {
    const part = bytes.subarray(0, 7);
    chunks.push(...part);
    return part.length;
  });
  debouncedSave(snapshot("été ☃"));
  await vi.advanceTimersByTimeAsync(300);
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(chunks))).activePid).toBe("été ☃");
  expect(mocks.rename).toHaveBeenCalledOnce();
});

it("closes and cleans up if writing makes no progress", async () => {
  mocks.write.mockRejectedValue(new Error("native unavailable"));
  mocks.fileWrite.mockResolvedValue(0);
  debouncedSave(snapshot("latest"));
  await vi.advanceTimersByTimeAsync(300);
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.rename).not.toHaveBeenCalled();
});

it("serializes overlapping saves so an older snapshot cannot finish after the latest one", async () => {
  let finish!: () => void;
  mocks.write.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  debouncedSave(snapshot("old"));
  await vi.advanceTimersByTimeAsync(300);
  try {
    debouncedSave(snapshot("new"));
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  } finally {
    finish();
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.write.mock.calls[1][1]).activePid).toBe("new");
});
