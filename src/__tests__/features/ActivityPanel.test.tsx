import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
import { I18nProvider } from "../../i18n/i18n";
import { useStore } from "../../core/store";
import ActivityPanel from "../../features/activity/ActivityPanel";

beforeEach(() => {
  cleanup();
  useStore.setState({ activePid: "a", activeSid: "a1", projectSessions: {}, sessionStates: { c: "working" }, projects: [
    { id: "a", name: "Alpha", dir: "/a", sessions: [{ id: "a1", name: "Main" }] },
    { id: "b", name: "Beta", dir: "/b", sessions: [
      { id: "b1", name: "Result", unread: true },
      { id: "b2", name: "Busy", claudeSessionId: "c" },
      { id: "b3", name: "Saved", archivedAt: 10, claudeSessionId: "saved" },
      { id: "b4", name: "Broken", runtimeStatus: "failed", failureReason: "resume" },
    ] },
  ] });
});
const panel = (archives = false) => render(<I18nProvider language="fr"><ActivityPanel archives={archives} /></I18nProvider>);

describe("ActivityPanel", () => {
  it("requires explicit confirmation, supports cancellation and refuses working or waiting sessions", () => {
    useStore.setState({ sessionStates: { c: "working", saved: "waiting" } });
    panel();
    expect((screen.getByRole("button", { name: "Archiver Busy" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Archiver Result" }));
    expect(useStore.getState().projects[1].sessions[0].archivedAt).toBeUndefined();
    expect(screen.getByText(/Le processus sera arrêté/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("button", { name: "Confirmer l’archivage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archiver Result" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l’archivage" }));
    expect(useStore.getState().projects[1].sessions[0].archivedAt).toBeTypeOf("number");
    expect(screen.queryByText("Result")).toBeNull();
    cleanup();
    useStore.setState({ sessionStates: { c: "waiting" } });
    panel();
    expect((screen.getByRole("button", { name: "Archiver Busy" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores and opens an archived session in its original project", () => {
    panel(true);
    expect(screen.queryByRole("button", { name: /Archiver/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restaurer et ouvrir Saved" }));
    expect(useStore.getState().activePid).toBe("b");
    expect(useStore.getState().activeSid).toBe("b3");
    expect(useStore.getState().projects[1].sessions[2].archivedAt).toBeUndefined();
    expect(screen.getByText("Aucune session archivée")).toBeTruthy();
  });
  it("filters locally by project or session and exposes counts without changing heading names", () => {
    panel();
    const heading = screen.getByRole("heading", { name: "En cours" });
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
    expect(screen.getByLabelText("1 session(s) : En cours")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " bEtA " } });
    expect(screen.queryByText("Main")).toBeNull();
    expect(screen.getByText("Busy")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Result" } });
    expect(screen.queryByText("Busy")).toBeNull();
    expect(screen.getByText("Result")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent" } });
    expect(screen.getByText("Aucune session correspondante")).toBeTruthy();
  });

  it("ignores invalid and future dates and identifies agent and terminal sessions", () => {
    useStore.setState({ projects: [{ id: "a", name: "Alpha", dir: "/a", sessions: [
      { id: "a1", name: "Invalid", lastActivityAt: NaN },
      { id: "a2", name: "Overflow", lastActivityAt: Infinity },
      { id: "a3", name: "Future", lastActivityAt: Date.now() + 86400000 },
      { id: "a4", name: "Shell", type: "terminal", lastActivityAt: 1000 },
    ] }] });
    const { container } = panel();
    expect(container.querySelectorAll("time").length).toBe(1);
    expect(screen.getAllByText("Agent").length).toBe(3);
    expect(screen.getByText("Terminal")).toBeTruthy();
  });
  it("shows all-project activity and opens the exact session with its project", () => {
    panel();
    expect(screen.getByRole("heading", { name: "En cours" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Résultats non consultés" })).toBeTruthy();
    expect(screen.getByText("Reprise échouée")).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Beta.*Result/ }));
    expect(useStore.getState().activePid).toBe("b");
    expect(useStore.getState().activeSid).toBe("b1");
    expect(useStore.getState().projects[1].sessions[0].unread).toBe(false);
  });
});
