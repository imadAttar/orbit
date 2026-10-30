import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useStore } from "../../core/store";
import { claude } from "../../core/api";
import { I18nProvider } from "../../i18n/i18n";
import SupervisionPanel from "../../features/supervision/SupervisionPanel";
import Sidebar from "../../layout/Sidebar";

vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { sessionsSnapshot: vi.fn().mockResolvedValue({ available: true, sessions: [{ sessionId: "c", kind: "interactive", status: "busy" }] }) }, pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
beforeEach(() => {
  useStore.setState({ hookSetup: {}, activePid: "p", activeSid: "s", projects: [{ id: "p", name: "Orbit", dir: "/orbit", sessions: [
    { id: "s", name: "Main", claudeSessionId: "c", runtimeStatus: "running", unread: true },
    { id: "x", name: "Broken", runtimeStatus: "failed", failureReason: "resume" },
  ] }], sessionStates: { c: "working" }, sessionTools: { c: "Read" }, sessionSubagents: {} });
});
afterEach(() => { cleanup(); useStore.getState().startClaudeObservation()(); });

it("reports failed native observation and retries the snapshot command", async () => {
  useStore.setState({ hookSetup: { p: "failed" } });
  render(<I18nProvider language="fr"><SupervisionPanel onOpen={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("alert").textContent).toContain("Orbit");
  const stop = useStore.getState().startClaudeObservation();
  fireEvent.click(screen.getByRole("button", { name: "Réessayer l’observation" }));
  await waitFor(() => expect(useStore.getState().hookSetup.p).toBe("ready"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(claude.sessionsSnapshot).toHaveBeenCalled();
  stop();
});
it("uses the same authoritative status in the sidebar and supervision despite an unread flag", () => {
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /><SupervisionPanel onOpen={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("button", { name: "Main — En cours" })).toBeTruthy();
  expect(within(screen.getByRole("button", { name: "Ouvrir Main — Orbit" })).getByText("En cours")).toBeTruthy();
});
it("filters attention, searches projects and opens the exact session without issuing terminal commands", () => {
  const open = vi.fn();
  render(<I18nProvider language="fr"><SupervisionPanel onOpen={open} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: /À traiter/ }));
  expect(screen.queryByRole("button", { name: "Ouvrir Main — Orbit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir Broken — Orbit" }));
  expect(open).toHaveBeenCalledExactlyOnceWith("x");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } });
  expect(screen.getByText("Aucune session correspondante")).toBeTruthy();
});
it("reports granular details unavailable instead of showing stale hook child activity", () => {
  useStore.setState({ sessionStates: { c: "idle" }, sessionSubagents: { c: [
    { id: "a", label: "Explore", status: "running", updatedAt: 100 },
    { id: "b", label: "Review", status: "stopped", updatedAt: 101 },
  ] } });
  render(<I18nProvider language="fr"><SupervisionPanel onOpen={vi.fn()} /></I18nProvider>);
  expect(screen.queryByText("Explore")).toBeNull();
  expect(screen.queryByText("Review")).toBeNull();
  expect(screen.getAllByText(/Détails des sous-agents indisponibles/)).toHaveLength(2);
  expect(screen.queryByText(/^(réussi|réussite|succès)$/i)).toBeNull();
});
