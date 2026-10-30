import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
let analytics: typeof import("../../lib/analytics");
const events = () => mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body)[0]);

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  analytics = await import("../../lib/analytics");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("analytics consent", () => {
  it("defaults to disabled before consent initialization", () => {
    analytics.trackEvent("app_launched");
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("sends only after opt-in and revokes immediately", () => {
    analytics.initAnalytics(true);
    mockFetch.mockClear();
    analytics.trackEvent("window_focused");
    analytics.setAnalyticsEnabled(false);
    analytics.trackEvent("window_focused");
    expect(events().map(e => e.eventName)).toEqual(["window_focused"]);
  });
  it("does not emit or persist activity in development", () => {
    vi.stubEnv("DEV", true);
    analytics.initAnalytics(true);
    analytics.trackEvent("app_launched");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
  it("initializes idempotently", () => {
    analytics.initAnalytics(true);
    analytics.initAnalytics(true);
    expect(events().filter(e => e.eventName === "app_init")).toHaveLength(1);
  });
  it("retains session across internal reload but expires after 30 idle minutes", async () => {
    vi.useFakeTimers();
    analytics.initAnalytics(true);
    const first = events()[0].sessionId;
    vi.resetModules();
    analytics = await import("../../lib/analytics");
    analytics.initAnalytics(true);
    expect(events()[events().length - 1].sessionId).toBe(first);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    analytics.trackEvent("window_focused");
    expect(events()[events().length - 1].sessionId).not.toBe(first);
  });
  it("drops unknown events and all unapproved data including raw errors", () => {
    analytics.initAnalytics(true);
    mockFetch.mockClear();
    analytics.trackEvent("/Users/secret/project", { message: "private prompt" });
    analytics.trackEvent("pty_error", { error: "/Users/secret", errorCode: "spawn_failed", sessionType: "agent", project: "secret" });
    expect(events()).toHaveLength(1);
    expect(events()[0].props).toEqual({ errorCode: "spawn_failed", sessionType: "agent" });
    expect(JSON.stringify(events())).not.toContain("secret");
  });
  it("ignores nonfinite metrics and non-enumerated string values", () => {
    analytics.initAnalytics(true);
    mockFetch.mockClear();
    analytics.trackEvent("app_launched", { theme: "/secret", projects: NaN, sessions: 3 });
    expect(events()[0].props).toEqual({ sessions: 3 });
  });
  it("never throws when transport fails", () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    expect(() => analytics.initAnalytics(true)).not.toThrow();
  });
});
