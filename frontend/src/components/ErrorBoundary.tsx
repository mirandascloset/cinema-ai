import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Catch render crashes so the iframe is not a blank white page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Image Studio UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="pane" style={{ padding: 24 }}>
        <p className="err">Something broke in the UI.</p>
        <p className="hint">{this.state.error.message || "Unknown error"}</p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            // Always land on the shell root — a stale deep link 404s as JSON without SPA fallback.
            location.replace("/");
          }}
        >
          Reload
        </button>
      </section>
    );
  }
}
