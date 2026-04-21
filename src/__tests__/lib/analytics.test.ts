import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", mockFetch);

// Must import after mock
import { trackEvent, setAnalyticsEnabled, initAnalytics } from "../../lib/analytics";

describe("analytics", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    localStorage.clear();
    // Pretend we've already tracked today's activity so trackRetention is a
    // no-op, letting assertions count events fired by initAnalytics itself.
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("orbit_last_active_day", today);
    setAnalyticsEnabled(true);
  });

  it("trackEvent does nothing when disabled", () => {
    setAnalyticsEnabled(false);
    trackEvent("test_event");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("trackEvent sends to Aptabase when enabled", () => {
    trackEvent("test_event", { key: "value" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("aptabase.com"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "App-Key": expect.any(String) }),
      })
    );
  });

  it("setAnalyticsEnabled(false) prevents subsequent events", () => {
    setAnalyticsEnabled(false);
    trackEvent("should_not_fire");
    trackEvent("also_should_not_fire");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("initAnalytics(false) does not track app_init", () => {
    initAnalytics(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("initAnalytics(true) tracks app_init", () => {
    initAnalytics(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("trackEvent does not throw when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    expect(() => trackEvent("resilience_test")).not.toThrow();
  });
});
