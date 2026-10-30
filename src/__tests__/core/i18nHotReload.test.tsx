import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.doUnmock("react");
  delete (globalThis as typeof globalThis & { __orbitI18nContext?: unknown }).__orbitI18nContext;
});

it("keeps an existing provider connected to refreshed translation consumers and their chosen language", async () => {
  // Reload application modules, not React itself: this models a hot update.
  vi.doMock("react", () => React);
  vi.resetModules();
  const before = await import("../../i18n/i18n");
  vi.resetModules();
  const after = await import("../../i18n/i18n");
  function RefreshedConsumer() {
    const t = after.useT();
    return <span data-testid="translation">{t("sidebar.sessions")}</span>;
  }
  const { rerender } = render(<before.I18nProvider language="fr"><RefreshedConsumer /></before.I18nProvider>);
  expect(screen.getByTestId("translation").textContent).toBe("Projets");
  rerender(<before.I18nProvider language="en"><RefreshedConsumer /></before.I18nProvider>);
  expect(screen.getByTestId("translation").textContent).toBe("Projects");
});
