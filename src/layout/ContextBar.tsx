import { useEffect, useState, useMemo } from "react";
import { isWindows } from "../lib/platform";
import { useT } from "../i18n/i18n";
import { listen } from "../core/api";

interface StatuslineData {
  model?: string;
  context_pct?: number;
  cost?: number;
  git_branch?: string;
}

export default function ContextBar() {
  const t = useT();
  const [data, setData] = useState<StatuslineData | null>(null);

  useEffect(() => {
    // Statusline is Unix-only — skip on Windows
    if (isWindows) return;

    let unlisten: (() => void) | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    const handleUpdate = (raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.context_pct === "number" && parsed.context_pct >= 0 && parsed.context_pct <= 100) {
          setData(parsed);
        }
      } catch (err) { import("../lib/logger").then(({ logger }) => logger.warn("contextbar", `statusline parse error: ${err}`)); }
    };

    // Primary: event-driven via Rust file watcher
    listen<string>("statusline-updated", handleUpdate)
      .then((fn) => { unlisten = fn; })
      .catch(() => {
        // Fallback: poll if Tauri events unavailable
        let failures = 0;
        const poll = async () => {
          if (!document.hasFocus()) return;
          try {
            const fs = await import("@tauri-apps/plugin-fs");
            const raw = await fs.readTextFile(".orbit/statusline-latest.json", {
              baseDir: fs.BaseDirectory.Home,
            });
            handleUpdate(raw);
            failures = 0;
          } catch {
            failures++;
            if (failures >= 10 && fallbackInterval) {
              clearInterval(fallbackInterval);
            }
          }
        };
        poll();
        fallbackInterval = setInterval(poll, 5000);
      });

    return () => {
      unlisten?.();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, []);

  const pct = data?.context_pct;
  const color = pct !== undefined && pct >= 80 ? "var(--danger)" : pct !== undefined && pct >= 50 ? "var(--yellow)" : "var(--green)";
  const fillStyle = useMemo(() => ({ width: `${pct}%`, background: color }), [pct, color]);
  const pctStyle = useMemo(() => ({ color }), [color]);

  if (!data || pct === undefined) return null;

  return (
    <div className="context-bar">
      <span className="context-bar__label">{t("contextbar.label")}</span>
      <div className="context-bar__track">
        <div className="context-bar__fill" style={fillStyle} />
      </div>
      <span className="context-bar__pct" style={pctStyle}>{pct}%</span>
      {data.model && <span className="context-bar__model">{data.model}</span>}
    </div>
  );
}
