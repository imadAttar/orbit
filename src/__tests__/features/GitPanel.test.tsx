import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Mock Tauri
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/analytics", () => ({
  trackEvent: vi.fn(),
  initAnalytics: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
}));
vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string) => key,
  detectSystemLanguage: () => "fr",
}));

import GitPanel from "../../features/git/GitPanel";
import { useStore } from "../../core/store";

describe("GitPanel", () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({
      showGitPanel: true,
      gitFiles: ["M  src/app.ts", "A  src/new.ts"],
      gitDiff: "diff --git a/src/app.ts\n+added line",
      proposedCommitMessage: "feat: add new feature",
      projects: [{ id: "p1", name: "Test", dir: "/tmp/test", sessions: [] }],
      activePid: "p1",
    });
  });

  it("renders file list", () => {
    const { container } = render(<GitPanel />);
    const files = container.querySelectorAll(".git-panel__file");
    expect(files.length).toBe(2);
    // Check file names (slice(3) of the gitFiles entries)
    expect(files[0]?.textContent).toContain("src/app.ts");
    expect(files[1]?.textContent).toContain("src/new.ts");
    // Check status badges
    expect(files[0]?.querySelector(".git-panel__file-status")?.textContent).toBe("M ");
    expect(files[1]?.querySelector(".git-panel__file-status")?.textContent).toBe("A ");
  });

  it("renders commit message input with proposed message", () => {
    const { container } = render(<GitPanel />);
    const textarea = container.querySelector(".git-panel__commit-input") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("feat: add new feature");
  });

  it("returns null when showGitPanel is false", () => {
    useStore.setState({ showGitPanel: false });
    const { container } = render(<GitPanel />);
    expect(container.querySelector(".git-panel")).toBeNull();
  });

  it("renders diff section", () => {
    const { container } = render(<GitPanel />);
    const details = container.querySelector(".git-panel__diff-toggle");
    expect(details).toBeTruthy();
    const pre = container.querySelector(".git-panel__diff");
    expect(pre?.textContent).toContain("+added line");
  });

  it("renders header with file count", () => {
    const { container } = render(<GitPanel />);
    const header = container.querySelector(".git-panel__title");
    expect(header).toBeTruthy();
  });

  it("allows editing the commit message", () => {
    const { container } = render(<GitPanel />);
    const textarea = container.querySelector(".git-panel__commit-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix: updated message" } });
    expect(textarea.value).toBe("fix: updated message");
  });

  it("close button calls setShowGitPanel(false)", () => {
    const setShowGitPanel = vi.fn();
    useStore.setState({ setShowGitPanel });
    const { container } = render(<GitPanel />);
    const closeBtn = container.querySelector(".search-bar__btn") as HTMLElement;
    fireEvent.click(closeBtn);
    expect(setShowGitPanel).toHaveBeenCalledWith(false);
  });
});
