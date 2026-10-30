import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/i18n";
import { useStore } from "../../core/store";
import Sidebar from "../../layout/Sidebar";

vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ activePid: "p1", activeSid: "a", sessionStates: {}, sessionCosts: {}, projectSessions: {}, projects: [
    { id: "p1", name: "Orbit", dir: "/tmp/orbit", sessions: [{ id: "a", name: "Navigation" }] },
    { id: "p2", name: "Onyx", dir: "/tmp/onyx", sessions: [{ id: "b", name: "Reprise de lecture", type: "terminal" }] },
  ] });
});
afterEach(cleanup);

it("opens another project's session directly without changing the PTY lifecycle", async () => {
  const { pty } = await import("../../core/api");
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /></I18nProvider>);
  fireEvent.click(screen.getByText("Reprise de lecture"));
  expect(useStore.getState().activePid).toBe("p2");
  expect(useStore.getState().activeSid).toBe("b");
  expect(pty.killSilent).not.toHaveBeenCalled();
});

it("searches across collapsed projects and restores their collapsed state when cleared", () => {
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Replier Onyx" }));
  expect(screen.queryByText("Reprise de lecture")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lecture" } });
  expect(screen.getByText("Reprise de lecture")).toBeTruthy();
  expect(screen.queryByText("Navigation")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent-fixture" } });
  expect(screen.getByRole("status").textContent).toBe("Aucune session correspondante");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  expect(screen.queryByText("Reprise de lecture")).toBeNull();
  expect(screen.getByRole("button", { name: "Déplier Onyx" }).getAttribute("aria-expanded")).toBe("false");
});

it("pins a background session without activating it and keeps it reachable when its project is collapsed", () => {
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Épingler Reprise de lecture" }));
  expect(useStore.getState().activeSid).toBe("a");
  fireEvent.click(screen.getByRole("button", { name: "Replier Onyx" }));
  const pins = within(screen.getByRole("region", { name: "Épinglées" }));
  fireEvent.click(pins.getByText("Reprise de lecture"));
  expect(useStore.getState().activePid).toBe("p2");
  expect(useStore.getState().activeSid).toBe("b");
});

it("preserves keyboard activation and opens a session menu without switching projects", () => {
  const onContextMenu = vi.fn();
  render(<I18nProvider language="fr"><Sidebar onContextMenu={onContextMenu} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Actions de la session Reprise de lecture" }));
  expect(onContextMenu).toHaveBeenCalledWith("b", expect.any(Number), expect.any(Number));
  expect(useStore.getState().activeSid).toBe("a");
  const row = screen.getByText("Reprise de lecture").closest('[data-testid="session-item"]')!;
  fireEvent.keyDown(row, { key: "Enter" });
  expect(useStore.getState().activeSid).toBe("b");
});

it("exposes all older sessions without mounting or killing any process", async () => {
  const { pty } = await import("../../core/api");
  useStore.setState({ projects: [{ id: "p1", name: "Orbit", dir: "/tmp/orbit", sessions: [
    { id: "a", name: "Navigation" }, { id: "c", name: "Deuxième" }, { id: "d", name: "Troisième" },
    { id: "e", name: "Ancienne" }, { id: "f", name: "Archive", archivedAt: 1, pinned: true },
  ] }] });
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /></I18nProvider>);
  expect(screen.queryByText("Ancienne")).toBeNull();
  expect(screen.queryByText("Archive")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Afficher les 4 sessions" }));
  expect(screen.getByText("Ancienne")).toBeTruthy();
  expect(pty.killSilent).not.toHaveBeenCalled();
});

it("preserves access to project creation, preferences, project rename and terminal creation", () => {
  const onNewProject = vi.fn(); const onPreferences = vi.fn();
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} onNewProject={onNewProject} onPreferences={onPreferences} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Nouveau projet" }));
  fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
  expect(onNewProject).toHaveBeenCalledOnce(); expect(onPreferences).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Actions du projet Onyx" }));
  const actions = within(screen.getByRole("group", { name: "Actions du projet Onyx" }));
  fireEvent.click(actions.getByRole("button", { name: "Renommer" }));
  const input = screen.getByTestId("inline-rename-input");
  fireEvent.change(input, { target: { value: "Onyx TV" } }); fireEvent.keyDown(input, { key: "Enter" });
  expect(useStore.getState().projects[1].name).toBe("Onyx TV");
  fireEvent.click(screen.getByRole("button", { name: "Actions du projet Onyx TV" }));
  fireEvent.click(screen.getByRole("button", { name: "Nouveau terminal" }));
  expect(useStore.getState().activePid).toBe("p2");
  const sessions = useStore.getState().projects[1].sessions;
  expect(sessions[sessions.length - 1]?.type).toBe("terminal");
});

it("requires confirmation before removing a project", async () => {
  const { pty } = await import("../../core/api");
  render(<I18nProvider language="fr"><Sidebar onContextMenu={vi.fn()} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Actions du projet Onyx" }));
  fireEvent.click(screen.getByRole("button", { name: "Retirer le projet" }));
  expect(useStore.getState().projects).toHaveLength(2);
  expect(pty.killSilent).not.toHaveBeenCalled();
  const confirmation = within(screen.getByRole("group", { name: "Retirer le projet" }));
  fireEvent.click(confirmation.getByRole("button", { name: "Annuler" }));
  expect(useStore.getState().projects).toHaveLength(2);
});
