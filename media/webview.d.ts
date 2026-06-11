/** The API VS Code injects into webview scripts. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

/** The view-model module, attached as a global by viewModel.js (UMD). */
declare const SqliteViewModel: unknown;
