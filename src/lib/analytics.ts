// Single privacy boundary for telemetry: opt-in, production only, no free text.
const APTABASE_KEY = "A-EU-6072691155";
const APTABASE_URL = "https://eu.aptabase.com/api/v0/events";
const SESSION_KEY = "orbit_analytics_session";
// A session survives webview reloads via sessionStorage, not app restarts.
// It rotates after 30 minutes without an accepted telemetry event (not a user ID).
const IDLE_MS = 30 * 60 * 1000;
let enabled = false;
let initialized = false;
let session: { id: string; lastActive: number } | undefined;
const requests = new Set<AbortController>();

const events = new Set((`app_init daily_active app_launched window_focused window_blurred app_closed
project_created project_switched project_renamed project_deleted session_created terminal_session_created
session_switched session_reordered session_renamed session_closed session_deleted session_reset
notification_clicked shortcut_used onboarding_shown claude_installed
error_boundary crash_report_sent theme_changed font_size_changed language_changed default_mode_changed
auto_notifications_changed preferences_saved session_fresh_start mode_normal mode_yolo prompt_nav mode_toggle
file_opened_from_terminal pty_spawn_attempted pty_spawned pty_error session_resume_attempted
session_resume_launched session_resume_succeeded session_resume_failed pty_lifetime agent_activity_started agent_activity_ended`).split(/\s+/));
const themes = ["orbit", "orbit-light", "catppuccin-macchiato", "dracula", "one-dark", "nord", "tokyo-night", "gruvbox-dark", "rose-pine"];
const enums: Record<string, readonly string[]> = {
  theme: themes, language: ["en", "fr"], defaultMode: ["normal", "yolo"], mode: ["normal", "yolo"],
  sessionType: ["agent", "terminal"], direction: ["prev", "next"],
  errorCode: ["spawn_failed", "listener_failed", "render_failed", "write_failed", "process_exited"],
  key: ["new_project", "close_session", "search", "preferences"],
  signal: ["session_hook"], outcome: ["idle", "waiting", "interrupted"],
};
const metrics = new Set(["fontSize", "projects", "sessions", "agentSessions", "terminalSessions", "autoUpdate", "enabled", "restore", "activeMs", "sessionDurationMs", "durationMs", "streak", "daysSinceLast"]);
function sanitize(event: string, props?: Record<string, string | number>) {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (metrics.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
    if (enums[key]?.includes(String(value)) && typeof value === "string") safe[key] = value;
    if (key === "from" || key === "to") {
      const allowed = event === "theme_changed" ? themes : event === "language_changed" ? enums.language : event === "default_mode_changed" ? enums.defaultMode : [];
      if (typeof value === "string" && allowed.includes(value)) safe[key] = value;
      if (event === "font_size_changed" && typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
    }
  }
  return safe;
}

export function initAnalytics(optIn: boolean) {
  setAnalyticsEnabled(optIn);
  if (!enabled || import.meta.env.DEV || initialized) return;
  initialized = true;
  trackEvent("app_init");
  trackRetention();
}

function trackRetention() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lastDay = localStorage.getItem("orbit_last_active_day");
    if (lastDay === today) return;
    const diff = lastDay ? (Date.parse(today) - Date.parse(lastDay)) / 86400000 : 0;
    const previous = Number(localStorage.getItem("orbit_streak")) || 0;
    const streak = diff === 1 ? previous + 1 : 1;
    localStorage.setItem("orbit_last_active_day", today);
    localStorage.setItem("orbit_streak", String(streak));
    trackEvent("daily_active", { streak, daysSinceLast: Math.max(0, diff) });
  } catch { /* storage unavailable */ }
}

export function setAnalyticsEnabled(on: boolean) {
  enabled = on === true;
  if (!enabled) {
    for (const request of requests) request.abort();
    requests.clear();
    session = undefined;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* unavailable */ }
  }
}

function getSessionId() {
  const now = Date.now();
  if (!session) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (saved && /^[\da-f-]{36}$/i.test(saved.id) && Number.isFinite(saved.lastActive)) session = saved;
    } catch { /* unavailable or invalid */ }
  }
  if (!session || now - session.lastActive >= IDLE_MS || now < session.lastActive) session = { id: crypto.randomUUID(), lastActive: now };
  session.lastActive = now;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* memory fallback */ }
  return session.id;
}

export function trackEvent(event: string, props?: Record<string, string | number>) {
  if (!enabled || import.meta.env.DEV || !events.has(event)) return;
  const controller = new AbortController();
  try {
    requests.add(controller);
    void fetch(APTABASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Key": APTABASE_KEY },
      body: JSON.stringify([{
        timestamp: new Date().toISOString(), sessionId: getSessionId(), eventName: event,
        systemProps: {
          osName: navigator.userAgent.includes("Mac") ? "macOS" : navigator.userAgent.includes("Win") ? "Windows" : "Linux",
          appVersion: __APP_VERSION__, sdkVersion: `orbit@${__APP_VERSION__}`,
        },
        props: sanitize(event, props),
      }]),
      keepalive: true, signal: controller.signal,
    }).catch(() => {}).finally(() => requests.delete(controller));
  } catch { requests.delete(controller); }
}
