import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { within } from "@testing-library/dom";

vi.mock("../../i18n/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, v),
        key,
      );
    }
    return key;
  },
}));

import ErrorBoundary from "../../shared/ErrorBoundary";

let shouldThrow = false;

function ThrowingComponent() {
  if (shouldThrow) {
    throw new Error("test boom");
  }
  return <div>recovered</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = false;
    cleanup();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(getByText("hello")).toBeDefined();
  });

  it("catches error and shows error message", () => {
    shouldThrow = true;
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    const scope = within(container);
    expect(scope.getByText("test boom")).toBeDefined();
    expect(scope.getByText("error.unexpected")).toBeDefined();
  });

  it("retry button clears error and re-renders children", () => {
    shouldThrow = true;
    const { container } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    const scope = within(container);
    // Stop throwing before retry click
    shouldThrow = false;
    fireEvent.click(scope.getByText("common.retry"));
    expect(scope.getByText("recovered")).toBeDefined();
  });
});
