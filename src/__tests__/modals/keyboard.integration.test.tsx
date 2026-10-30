import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";

const state = vi.hoisted(() => ({
  settings: { theme: "orbit", fontSize: 14, analytics: false, autoUpdate: false, autoNotifications: false, language: "en", defaultMode: "normal" },
  updateSettings: vi.fn(), addProject: vi.fn(),
}));
vi.mock("../../core/store", () => ({ useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn(), setAnalyticsEnabled: vi.fn() }));
vi.mock("../../core/api", () => ({ claude: { install: vi.fn() } }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key }));

import NewProjectModal from "../../modals/NewProjectModal";
import PreferencesModal from "../../modals/PreferencesModal";
import * as AppModals from "../../modals/AppModals";
import { DeleteSessionModal, InstallClaudeModal } from "../../modals/AppModals";

it("exposes no custom Claude statusline installer dialog", () => {
  expect(AppModals).not.toHaveProperty("StatuslineModal");
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const cases: [string, (close: () => void) => ReactNode][] = [
  ["new project", (close) => <NewProjectModal onClose={close} />],
  ["preferences", (close) => <PreferencesModal onClose={close} />],
  ["delete session", (close) => <DeleteSessionModal sessionId="missing" sessions={[]} onConfirm={vi.fn()} onCancel={close} />],
  ["install prompt", (close) => <InstallClaudeModal onClose={close} />],
];

function Harness({ modal, close }: { modal: (close: () => void) => ReactNode; close: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open modal</button>{open && modal(() => { close(); setOpen(false); })}</>;
}

describe.each(cases)("%s keyboard integration (real controls and trap)", (_, modal) => {
  it("wraps Tab and Shift+Tab from the dialog's boundary controls", () => {
    const view = render(<Harness modal={modal} close={vi.fn()} />);
    fireEvent.click(view.getByText("Open modal"));
    const dialog = view.getByRole("dialog");
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])"));
    const first = controls[0];
    const last = controls[controls.length - 1];
    expect(dialog.contains(document.activeElement)).toBe(true);
    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("closes with Escape from a real field/control and restores the opener", () => {
    const close = vi.fn();
    const view = render(<Harness modal={modal} close={close} />);
    const opener = view.getByText("Open modal");
    opener.focus();
    fireEvent.click(opener);
    const dialog = view.getByRole("dialog");
    const control = dialog.querySelector<HTMLElement>("input, select, button")!;
    control.focus();
    fireEvent.keyDown(control, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("does not leak application shortcuts to the window listener", () => {
    const globalKey = vi.fn();
    window.addEventListener("keydown", globalKey);
    try {
      const view = render(<Harness modal={modal} close={vi.fn()} />);
      fireEvent.click(view.getByText("Open modal"));
      const control = view.getByRole("dialog").querySelector<HTMLElement>("input, select, button")!;
      control.focus();
      for (const key of ["n", "t", "w", "f", ",", "+", "-", "1", "Tab"]) {
        fireEvent.keyDown(control, { key, ctrlKey: true });
        fireEvent.keyDown(control, { key, metaKey: true });
      }
      expect(globalKey).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", globalKey); }
  });
});
