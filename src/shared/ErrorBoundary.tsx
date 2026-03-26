import { Component, type ReactNode } from "react";
import { useT } from "../i18n/i18n";

interface Props {
  fallback?: ReactNode;
  children: ReactNode;
  labels?: { title: string; unknown: string; retry: string; sendReport: string; sending: string; sent: string };
}

interface State {
  hasError: boolean;
  error: Error | null;
  reportStatus: "idle" | "sending" | "sent" | "failed";
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, error: null, reportStatus: "idle" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    import("../lib/logger").then(({ logger }) => logger.error("error-boundary", `${error?.message ?? error}`));
    import("../lib/analytics").then(({ trackEvent }) => trackEvent("error_boundary", { error: (error?.message ?? "unknown").slice(0, 200) }));
  }

  handleSendReport = async () => {
    this.setState({ reportStatus: "sending" });
    try {
      const { orbit } = await import("../core/api");
      const errorMsg = this.state.error?.message ?? "Unknown error";
      const report = await orbit.collectCrashReport(errorMsg);
      const title = encodeURIComponent(`[crash] ${errorMsg.slice(0, 80)}`);
      const body = encodeURIComponent(report);
      const url = `https://github.com/imadAttar/orbit/issues/new?title=${title}&body=${body}&labels=bug`;
      window.open(url);
      this.setState({ reportStatus: "sent" });
      import("../lib/analytics").then(({ trackEvent }) => trackEvent("crash_report_sent"));
    } catch {
      // Fallback: open issue without logs
      const title = encodeURIComponent(`[crash] ${(this.state.error?.message ?? "Unknown").slice(0, 80)}`);
      const body = encodeURIComponent(`## Crash Report\n\n**Error:** ${this.state.error?.message ?? "Unknown"}\n\n(logs unavailable — Tauri API not reachable)`);
      window.open(`https://github.com/imadAttar/orbit/issues/new?title=${title}&body=${body}&labels=bug`);
      this.setState({ reportStatus: "sent" });
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const labels = this.props.labels ?? { title: "Unexpected Error", unknown: "Unknown error", retry: "Retry", sendReport: "Send report", sending: "Sending...", sent: "Report sent" };
      const { reportStatus } = this.state;
      return (
        <div className="error-boundary">
          <div className="error-boundary__title">{labels.title}</div>
          <pre className="error-boundary__message">
            {this.state.error?.message ?? labels.unknown}
          </pre>
          <div className="error-boundary__actions">
            <button
              className="modal__btn--primary"
              onClick={() => this.setState({ hasError: false, error: null, reportStatus: "idle" })}
            >
              {labels.retry}
            </button>
            <button
              className="modal__btn--secondary"
              onClick={this.handleSendReport}
              disabled={reportStatus !== "idle"}
            >
              {reportStatus === "idle" && labels.sendReport}
              {reportStatus === "sending" && labels.sending}
              {reportStatus === "sent" && labels.sent}
              {reportStatus === "failed" && labels.sendReport}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Functional wrapper that injects i18n labels into the class-based ErrorBoundary */
export default function ErrorBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const t = useT();
  return (
    <ErrorBoundaryInner
      fallback={fallback}
      labels={{
        title: t("error.unexpected"),
        unknown: t("error.unknown"),
        retry: t("common.retry"),
        sendReport: t("error.sendReport"),
        sending: t("error.sending"),
        sent: t("error.sent"),
      }}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
