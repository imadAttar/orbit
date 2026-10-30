import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
vi.mock("../../hooks/useAppInit", () => ({ useAppInit: vi.fn() }));
vi.mock("../../hooks/useThemeSync", () => ({ useThemeSync: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../features/terminal/Terminal", async () => {
  const { useEffect } = await import("react");
  return { default: ({ sessionId, active }: { sessionId: string; active: boolean }) => {
    useEffect(() => { lifecycle.mount(sessionId); return () => { lifecycle.unmount(sessionId); }; }, [sessionId]);
    return <div data-testid={`terminal-${sessionId}`} data-active={active} />;
  } };
});
vi.mock("../../layout/ContextBar", () => ({ default: () => null }));
vi.mock("../../layout/StatusBar", () => ({ default: () => null }));
vi.mock("../../features/UpdateBanner", () => ({ default: () => null }));
import App from "../../App";
import { useStore } from "../../core/store";
import { I18nProvider } from "../../i18n/i18n";

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ loaded: true, activePid: "p1", activeSid: "a", sessionStates: {}, sessionCosts: {}, projectSessions: {}, projects: [
    { id: "p1", name: "Orbit", dir: "/tmp/orbit", sessions: [{ id: "a", name: "Navigation", type: "terminal" }] },
    { id: "p2", name: "Onyx", dir: "/tmp/onyx", sessions: [{ id: "b", name: "Reprise de lecture", type: "terminal" }] },
  ] });
});
afterEach(cleanup);

it("transfers focus from a session menu into inline rename instead of restoring the menu opener", async () => {
  render(<I18nProvider language="fr"><App /></I18nProvider>);
  await screen.findByTestId("terminal-a");
  const opener = screen.getByRole("button", { name: "Actions de la session Reprise de lecture" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Renommer" }));
  const input = screen.getByTestId("inline-rename-input");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "Reprise Onyx TV" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useStore.getState().projects[1].sessions[0].name).toBe("Reprise Onyx TV");
  expect(useStore.getState().activePid).toBe("p1");
  expect(screen.queryByTestId("inline-rename-input")).toBeNull();
});

it("restores the session menu opener on an ordinary Escape close", async () => {
  render(<I18nProvider language="fr"><App /></I18nProvider>);
  await screen.findByTestId("terminal-a");
  const opener = screen.getByRole("button", { name: "Actions de la session Reprise de lecture" });
  opener.focus(); fireEvent.click(opener);
  fireEvent.keyDown(screen.getByRole("button", { name: "Renommer" }), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("keeps visited terminals mounted across global navigation, project collapse, search and attention views", async () => {
  const { pty } = await import("../../core/api");
  const { container } = render(<I18nProvider language="fr"><App /></I18nProvider>);
  expect(await screen.findByTestId("terminal-a")).toBeTruthy();
  expect(container.querySelector(".tab-bar")).toBeNull();
  expect(screen.queryByTestId("terminal-b")).toBeNull();
  fireEvent.click(screen.getByText("Reprise de lecture"));
  expect(await screen.findByTestId("terminal-b")).toBeTruthy();
  expect(screen.getByTestId("terminal-a").getAttribute("data-active")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Replier Onyx" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "absent-fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "À votre attention" }));
  expect(screen.getByTestId("terminal-b")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Projets" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(screen.getByText("Navigation", { selector: ".session-item__name" }));
  expect(screen.getByTestId("terminal-a").getAttribute("data-active")).toBe("true");
  expect(screen.getByTestId("terminal-b")).toBeTruthy();
  expect(lifecycle.mount.mock.calls).toEqual([["a"], ["b"]]);
  expect(lifecycle.unmount).not.toHaveBeenCalled();
  expect(pty.killSilent).not.toHaveBeenCalled();
});

it("confirms deletion of a background session using its name without changing the active project", async () => {
  const { pty } = await import("../../core/api");
  render(<I18nProvider language="fr"><App /></I18nProvider>);
  await screen.findByTestId("terminal-a");
  fireEvent.click(screen.getByRole("button", { name: "Actions de la session Reprise de lecture" }));
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  expect(screen.getByRole("dialog").textContent).toContain("Reprise de lecture");
  expect(pty.killSilent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
  expect(pty.killSilent).toHaveBeenCalledWith("b");
  expect(useStore.getState().activePid).toBe("p1");
  expect(useStore.getState().activeSid).toBe("a");
});
