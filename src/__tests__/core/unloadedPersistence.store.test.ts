import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: io.save }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, terminal: {}, listen: vi.fn() }));
vi.mock("../../i18n/i18n", () => ({ detectSystemLanguage: () => "fr" }));
import { useStore } from "../../core/store";
beforeEach(() => { vi.clearAllMocks(); useStore.setState({ loaded: false, projects: [], activePid: "", activeSid: "" }); });

describe("authoritative workspace saves", () => {
  it("never overwrites saved projects with an uninitialized empty store", () => {
    useStore.getState().setFontSize(15);
    useStore.getState().updateSettings({ theme: "orbit" });
    expect(io.save).not.toHaveBeenCalled();
  });
});
