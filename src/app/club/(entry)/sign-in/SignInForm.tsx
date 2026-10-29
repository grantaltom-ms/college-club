"use client";

import { useEffect, useState } from "react";

/**
 * The sign-in email box and button. The form still posts the plain way (so it works even before the page's scripts load); this
 * only turns the button to "Sending…" and off while the post is under way, so a second press cannot ask for a second link.
 */
export function SignInForm() {
  const [sending, setSending] = useState(false);
  useEffect(() => {
    // Coming back to this page with the Back button must not leave the button stuck.
    const reset = () => setSending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <form method="post" action="/api/club/sign-in/request" className="ds-form" data-testid="sign-in-form" onSubmit={() => setSending(true)}>
      <div className="ds-field">
        <label className="ds-label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="ds-input" maxLength={254} autoComplete="email" inputMode="email" placeholder="you@example.com" required />
      </div>
      <button type="submit" className="ds-button ds-button-large" disabled={sending}>
        {sending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
