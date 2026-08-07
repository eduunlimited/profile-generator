import { isBrowserUiMode } from "../lib/env";

export function DevModeBanner() {
  if (!isBrowserUiMode()) return null;

  return (
    <div className="dev-mode-banner">
      <strong>Fast UI mode</strong>
      <span>
        Running in the browser with instant hot reload. Profiles, cards, and accounts save to the{" "}
        <code>data/</code> folder in this project (with backups in <code>data/backups/</code>).
        Use <code>npm run dev:app</code> only when you need the desktop shell.
      </span>
    </div>
  );
}
