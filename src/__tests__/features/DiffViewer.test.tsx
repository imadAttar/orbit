import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("no fs")),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { Home: 1 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../i18n/i18n", () => ({ useT: () => (key: string) => key, detectSystemLanguage: () => "fr" }));

const mockStoreState: Record<string, unknown> = {
  showDiffViewer: false,
  diffContent: "",
  diffFile: "",
  setShowDiffViewer: vi.fn(),
  setGitFiles: vi.fn(),
  setProposedCommitMessage: vi.fn(),
  setShowGitPanel: vi.fn(),
};

vi.mock("../../core/store", () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
    { getState: () => mockStoreState },
  ),
}));

import DiffViewer from "../../features/git/DiffViewer";

const SAMPLE_DIFF = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line one
-old line
+new line
 line three`;

describe("DiffViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.showDiffViewer = false;
    mockStoreState.diffContent = "";
    mockStoreState.diffFile = "";
  });

  it("returns null when showDiffViewer is false", () => {
    mockStoreState.showDiffViewer = false;
    const { container } = render(<DiffViewer />);
    expect(container.innerHTML).toBe("");
  });

  it("renders diff lines when content provided", () => {
    mockStoreState.showDiffViewer = true;
    mockStoreState.diffContent = SAMPLE_DIFF;
    mockStoreState.diffFile = "file.ts";
    const { container } = render(<DiffViewer />);
    const diffLines = container.querySelectorAll(".diff-line");
    expect(diffLines.length).toBeGreaterThan(0);
    const addLines = container.querySelectorAll(".diff-line--add");
    expect(addLines.length).toBeGreaterThan(0);
    const delLines = container.querySelectorAll(".diff-line--del");
    expect(delLines.length).toBeGreaterThan(0);
  });

  it("shows file name in header", () => {
    mockStoreState.showDiffViewer = true;
    mockStoreState.diffContent = SAMPLE_DIFF;
    mockStoreState.diffFile = "src/components/App.tsx";
    const { getByText } = render(<DiffViewer />);
    expect(getByText("src/components/App.tsx")).toBeTruthy();
  });
});
