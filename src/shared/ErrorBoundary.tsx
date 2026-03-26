import { Component, type ReactNode } from "react";
import { useT } from "../i18n/i18n";

interface Props {
  fallback?: ReactNode;
  children: ReactNode;
  labels?: { title: string; unknown: string; retry: string };
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    import("../lib/logger").then(({ logger }) => logger.error("error-boundary", `${error?.message ?? error}`));
    import("../lib/analytics").then(({ trackEvent }) => trackEvent("error_boundary", { error: (error?.message ?? "unknown").slice(0, 200) }));
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const labels = this.props.labels ?? { title: "Unexpected Error", unknown: "Unknown error", retry: "Retry" };
      return (
        <div className="error-boundary">
          <div className="error-boundary__title">{labels.title}</div>
          <pre className="error-boundary__message">
            {this.state.error?.message ?? labels.unknown}
          </pre>
          <button
            className="modal__btn--primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {labels.retry}
          </button>
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
      }}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
