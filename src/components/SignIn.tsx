"use client";

import { useState } from "react";

interface Props {
  /** Ties the label to the field; must be unique on the page. */
  id: string;
  title: string;
  text: string;
  button: string;
  onSignedIn: () => void;
}

/** The password form shared by the Members and Goals pages. One password, one sign-in for both. */
export function SignIn({ id, title, text, button, onSignedIn }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        onSignedIn();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not sign in. Try again.");
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card signin" onSubmit={submit}>
      <h2 className="card-title">{title}</h2>
      <p className="card-sub">{text}</p>
      <label htmlFor={id}>Password</label>
      <input
        id={id}
        className="search"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="chip" disabled={busy}>
        {busy ? "Checking" : button}
      </button>
    </form>
  );
}
