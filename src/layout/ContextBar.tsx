import { useEffect, useState, useMemo } from "react";
import { isWindows } from "../lib/platform";
import { useT } from "../i18n/i18n";
import { listen } from "../core/api";

interface StatuslineData {
  session_id: string;
  model?: string;
  context_pct: number;
}

/** Optional observations only: unscoped legacy metrics must never label another session. */
export default function ContextBar({ conversationId }: { conversationId?: string }) {
  const t = useT();
  const [data, setData] = useState<StatuslineData | null>(null);

  useEffect(() => {
    if (isWindows || !conversationId) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    const handleUpdate = (raw: string) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.session_id === conversationId &&
            typeof parsed.context_pct === "number" && Number.isFinite(parsed.context_pct) &&
            parsed.context_pct >= 0 && parsed.context_pct <= 100 &&
            (parsed.model === undefined || typeof parsed.model === "string")) {
          setData({ session_id: parsed.session_id, context_pct: parsed.context_pct, model: parsed.model });
        }
      } catch { /* Optional observation; never log raw payloads or interrupt Claude. */ }
    };

    listen<string>("statusline-updated", handleUpdate)
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch(() => {
        if (cancelled) return;
        let failures = 0;
        const poll = async () => {
          if (cancelled || !document.hasFocus()) return;
          try {
            const fs = await import("@tauri-apps/plugin-fs");
            if (cancelled) return;
            const raw = await fs.readTextFile(".orbit/statusline-latest.json", { baseDir: fs.BaseDirectory.Home });
            handleUpdate(raw);
            failures = 0;
          } catch {
            if (++failures >= 10 && fallbackInterval) clearInterval(fallbackInterval);
          }
        };
        fallbackInterval = setInterval(() => { void poll(); }, 5000);
        void poll();
      });

    return () => {
      cancelled = true;
      unlisten?.();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [conversationId]);

  const scoped = data?.session_id === conversationId ? data : null;
  const pct = scoped?.context_pct;
  const color = pct !== undefined && pct >= 80 ? "var(--danger)" : pct !== undefined && pct >= 50 ? "var(--yellow)" : "var(--green)";
  const fillStyle = useMemo(() => ({ width: `${pct}%`, background: color }), [pct, color]);
  const pctStyle = useMemo(() => ({ color }), [color]);

  if (!scoped || pct === undefined) return null;

  return (
    <div className="context-bar">
      <span className="context-bar__label">{t("contextbar.label")}</span>
      <div className="context-bar__track"><div className="context-bar__fill" style={fillStyle} /></div>
      <span className="context-bar__pct" style={pctStyle}>{pct}%</span>
      {scoped.model && <span className="context-bar__model">{scoped.model}</span>}
    </div>
  );
}
