"use client";

import { useState } from "react";

/**
 * "How many snacks?" with a big minus and plus, and the total in the button, so a member knows exactly what they are about
 * to put on their account before they press it. The button turns itself off once pressed, so a double tap is one press (the
 * server also records each screen's token once). Without JavaScript the buttons do nothing but the form still sends 1.
 */
export function SnackForm({ code, memberId, token, max, priceCents, action }: { code: string; memberId: string; token: string; max: number; priceCents: number; action: string }) {
  const [items, setItems] = useState(1);
  const [sending, setSending] = useState(false);
  const step = (by: number) => setItems((n) => Math.min(Math.max(n + by, 1), max));
  const total = (items * priceCents) / 100;
  const money = `$${total.toFixed(2)}`;
  return (
    <form method="post" action={action} onSubmit={() => setSending(true)} data-testid="snack-form">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="member" value={memberId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="items" value={items} />
      <p id="snack-label" className="snack-label">
        How many snacks did you take?
      </p>
      <div className="snack-stepper" role="group" aria-labelledby="snack-label">
        <button type="button" className="snack-step" aria-label="One fewer snack" onClick={() => step(-1)} disabled={items <= 1 || sending}>
          &minus;
        </button>
        <output className="snack-count" data-testid="snack-count" aria-live="polite">
          {items}
        </output>
        <button type="button" className="snack-step" aria-label="One more snack" onClick={() => step(1)} disabled={items >= max || sending}>
          +
        </button>
      </div>
      <p className="snack-total" data-testid="snack-total">
        {items} {items === 1 ? "snack" : "snacks"} = {money}
      </p>
      <button type="submit" className="club-button ipad-go" disabled={sending} data-testid="snack-submit">
        {sending ? "Adding..." : `Add ${items === 1 ? "1 snack" : `${items} snacks`}, ${money}, to my account`}
      </button>
    </form>
  );
}
