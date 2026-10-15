import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ scrollback: { load: vi.fn().mockResolvedValue(null), clear: vi.fn() }, listen: vi.fn(), pty: { killSilent: vi.fn() } }));
const { hook } = vi.hoisted(() => ({ hook: vi.fn() }));
vi.mock("../../features/terminal/hooks/usePTY", () => ({ usePTY: hook }));
import { useStore } from "../../core/store";
import TerminalView from "../../features/terminal/Terminal";
import { I18nProvider } from "../../i18n/i18n";
beforeEach(() => {
 hook.mockReset().mockReturnValue({ termRef: { current: null }, spawnedRef: { current: false }, searchRef: { current: null } });
 useStore.setState({ activePid: "p", activeSid: "s", sessionStates: {}, projects: [{ id: "p", name: "P", dir: "/tmp/p", sessions: [{ id: "s", name: "Failed", claudeSessionId: "old", hasConversation: true, runtimeStatus: "failed", failureReason: "resume" }] }] });
});
afterEach(cleanup);
it.each(["normal", "yolo"] as const)("retries the existing conversation with resolved %s mode", async (defaultMode) => {
 useStore.setState({ settings: { ...useStore.getState().settings, defaultMode } });
 render(<I18nProvider language="fr"><TerminalView sessionId="s" projectDir="/tmp/p" active searchOpen={false} onSearchClose={() => {}} /></I18nProvider>);
 expect(await screen.findByText("Reprise échouée")).toBeTruthy();
 fireEvent.click(screen.getByRole("button", { name: "Reessayer" }));
 await vi.waitFor(() => expect(hook.mock.lastCall?.[0]).toMatchObject({ restoreChoice: "continue", generation: 1, modeChoice: defaultMode }));
 expect(useStore.getState().projects[0].sessions[0].claudeSessionId).toBe("old");
 expect(screen.getByRole("button", { name: "Nouvelle session" })).toBeTruthy();
});
