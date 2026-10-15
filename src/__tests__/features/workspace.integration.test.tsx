import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
vi.mock("../../core/persistence", () => ({ loadData: vi.fn(), debouncedSave: vi.fn() }));
vi.mock("../../core/api", () => ({ pty: { killSilent: vi.fn() }, scrollback: { clear: vi.fn() }, listen: vi.fn() }));
vi.mock("../../hooks/useAppInit", () => ({ useAppInit: vi.fn() }));
vi.mock("../../hooks/useThemeSync", () => ({ useThemeSync: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../features/terminal/Terminal", () => ({ default: ({ sessionId }: { sessionId: string }) => <div data-testid={`mounted-${sessionId}`} /> }));
vi.mock("../../layout/Sidebar", () => ({ default: () => null }));
vi.mock("../../layout/TabBar", () => ({ default: () => null }));
vi.mock("../../layout/ContextBar", () => ({ default: () => null }));
vi.mock("../../layout/StatusBar", () => ({ default: () => null }));
vi.mock("../../features/UpdateBanner", () => ({ default: () => null }));
vi.mock("../../modals/AppModals", () => ({ StatuslineModal: () => null, DeleteSessionModal: () => null, InstallClaudeModal: () => null }));
import App from "../../App";
import { useStore } from "../../core/store";
import { trackEvent } from "../../lib/analytics";
import { I18nProvider } from "../../i18n/i18n";
const app = () => <I18nProvider language="fr"><App /></I18nProvider>;
beforeEach(() => {
 vi.clearAllMocks();
 useStore.setState({ loaded: true, activePid: "p", activeSid: "a", projectSessions: {}, sessionStates: {}, projects: [{ id: "p", name: "Fixture", dir: "/tmp/fixture", sessions: [{ id: "a", name: "Main" }, { id: "b", name: "Saved", archivedAt: 1 }] }] });
});
afterEach(cleanup);
describe("workspace integration", () => {
 it("unmounts archived terminals and never mounts pre-existing archives", () => {
  render(app());
  expect(screen.getByTestId("mounted-a")).toBeTruthy();
  expect(screen.queryByTestId("mounted-b")).toBeNull();
  act(() => { useStore.getState().archiveSession("a", true); });
  expect(screen.queryByTestId("mounted-a")).toBeNull();
 });
 it("emits onboarding once after load, never from repeated renders", () => {
  useStore.setState({ loaded: false, projects: [], activePid: "", activeSid: "" });
  const { rerender } = render(app());
  expect(trackEvent).not.toHaveBeenCalled();
  act(() => useStore.setState({ loaded: true }));
  rerender(app()); rerender(app());
  expect(trackEvent).toHaveBeenCalledExactlyOnceWith("onboarding_shown");
 });
});
