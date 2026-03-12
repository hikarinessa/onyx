import { Component, createRef, type ReactNode, type ErrorInfo } from "react";
import { saveSessionBeforeReload } from "../lib/session";

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  private buttonRef = createRef<HTMLButtonElement>();

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] Uncaught error:`, error, info.componentStack);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.state.hasError && !prevState.hasError) {
      this.buttonRef.current?.focus();
    }
  }

  private handleReload = () => {
    saveSessionBeforeReload();
    // Small delay to let the sync save complete
    setTimeout(() => window.location.reload(), 50);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <p>Something went wrong in the {this.props.label}.</p>
          <button ref={this.buttonRef} onClick={this.handleReload}>
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
