import type { ActionResult } from "@/club/web-actions";

/** What a staff button said: a green line when it worked, a red one (in the engine's own words) when it was refused. */
export function ActionMessage({ state }: { state: ActionResult }) {
  if (state.kind === "ok") {
    return (
      <p className="club-success" role="status" data-testid="action-ok">
        {state.message}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="club-alert" role="alert" data-testid="action-error">
        {state.message}
      </p>
    );
  }
  return null;
}
