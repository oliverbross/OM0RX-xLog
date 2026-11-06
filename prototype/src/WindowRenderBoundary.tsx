import { Component, type ReactNode } from "react";

/** A failed surface stays failed until its native window is closed normally.
 * Do not remount, reload, or bypass the existing draft/output close lifecycle. */
export class WindowRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="app live monitor-app">
      <main aria-label="Window display error">
        <div className="live-error" role="alert">
          <div>
            <h1>This window could not continue.</h1>
            <p>A display error interrupted the interface.</p>
            <p>Use the application menu to close the window normally. After reopening, review any unfinished QSO edits before continuing.</p>
            <p>Error code: UI_RENDER_FAILED</p>
          </div>
        </div>
      </main>
    </div>;
  }
}
