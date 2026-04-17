// --- Analytics wrapper ---
// Single point of contact for all telemetry.
// Backend: Aptabase HTTP API (plugin Rust incompatible Tauri v2)
// Dashboard: https://aptabase.com
// To remove: delete this file + remove trackEvent() calls across the app.

const APTABASE_KEY = "A-EU-6072691155";
const APTABASE_URL = "https://eu.aptabase.com/api/v0/events";

let enabled = true;
const sessionId = crypto.randomUUID();

export async function initAnalytics(optIn: boolean) {
  enabled = optIn;
  if (optIn) {
    trackEvent("app_init");
    trackRetention();
  }
}

/** Track daily retention via localStorage streak */
function trackRetention() {
  try {
    const key = "orbit_last_active_day";
    const streakKey = "orbit_streak";
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const lastDay = localStorage.getItem(key);
    let streak = parseInt(localStorage.getItem(streakKey) || "0", 10);

    if (lastDay === today) return; // Already tracked today

    if (lastDay) {
      const diff = (Date.parse(today) - Date.parse(lastDay)) / 86400000;
      streak = diff === 1 ? streak + 1 : 1;
    } else {
      streak = 1;
    }

    localStorage.setItem(key, today);
    localStorage.setItem(streakKey, String(streak));
    trackEvent("daily_active", { streak, daysSinceLast: lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / 86400000) : 0 });
  } catch {
    // localStorage unavailable — skip
  }
}

export function setAnalyticsEnabled(on: boolean) {
  enabled = on;
}

export function trackEvent(event: string, props?: Record<string, string | number>) {
  if (!enabled) return;
  sendEvent(event, props);
}

// --- Backend: Aptabase HTTP API (array format + sdkVersion required) ---

function sendEvent(event: string, props?: Record<string, string | number>) {
  try {
    fetch(APTABASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "App-Key": APTABASE_KEY,
      },
      body: JSON.stringify([{
        timestamp: new Date().toISOString(),
        sessionId,
        eventName: event,
        systemProps: {
          osName: navigator.userAgent.includes("Mac") ? "macOS"
            : navigator.userAgent.includes("Win") ? "Windows"
            : "Linux",
          appVersion: __APP_VERSION__,
          sdkVersion: `orbit@${__APP_VERSION__}`,
        },
        props: props ?? {},
      }]),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Silently fail — analytics should never break the app
  }
}
