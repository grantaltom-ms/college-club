"use client";

import { useActionState } from "react";
import { requestTour } from "./actions";
import { IDLE } from "./state";

/**
 * The Request a tour form: name and email, a phone number and a note if the person likes. Typed words stay in the boxes when
 * something is wrong, every problem is named next to its box, and a hidden extra box catches robots.
 */
export function TourForm({ phone }: { phone: string }) {
  const [state, submit, pending] = useActionState(requestTour, IDLE);

  if (state.kind === "sent") {
    return (
      <p className="ds-status" role="status" data-testid="tour-sent">
        Thanks{state.firstName ? `, ${state.firstName}` : ""}. We have your request, and the membership team will be in touch to arrange a visit.
      </p>
    );
  }

  const errors = state.kind === "error" ? state.errors : {};
  const values = state.kind === "error" ? state.values : { name: "", email: "", phone: "", note: "" };
  const describe = (id: string, hasError: boolean) => (hasError ? { "aria-invalid": true, "aria-describedby": id } : {});
  return (
    <form action={submit} className="ds-form ds-ui" data-testid="tour-form" noValidate>
      {state.kind === "busy" && (
        <p className="ds-error" role="alert" data-testid="tour-busy">
          We are getting a lot of requests right now. Please call us on {phone} instead, or try again later.
        </p>
      )}
      <div className="ds-field">
        <label className="ds-label" htmlFor="tour-name">
          Your name
        </label>
        <input id="tour-name" name="name" type="text" className="ds-input" autoComplete="name" maxLength={400} required defaultValue={values.name} {...describe("tour-name-error", !!errors.name)} />
        {errors.name && (
          <p id="tour-name-error" className="ds-error" role="alert">
            {errors.name}
          </p>
        )}
      </div>
      <div className="ds-field">
        <label className="ds-label" htmlFor="tour-email">
          Email
        </label>
        <input id="tour-email" name="email" type="email" className="ds-input" autoComplete="email" maxLength={400} required defaultValue={values.email} {...describe("tour-email-error", !!errors.email)} />
        {errors.email && (
          <p id="tour-email-error" className="ds-error" role="alert">
            {errors.email}
          </p>
        )}
      </div>
      <div className="ds-field">
        <label className="ds-label" htmlFor="tour-phone">
          Phone <span className="ds-optional">(optional)</span>
        </label>
        <input id="tour-phone" name="phone" type="tel" className="ds-input" autoComplete="tel" inputMode="tel" maxLength={200} defaultValue={values.phone} {...describe("tour-phone-error", !!errors.phone)} />
        {errors.phone && (
          <p id="tour-phone-error" className="ds-error" role="alert">
            {errors.phone}
          </p>
        )}
      </div>
      <div className="ds-field">
        <label className="ds-label" htmlFor="tour-note">
          Anything we should know? <span className="ds-optional">(optional)</span>
        </label>
        <textarea id="tour-note" name="note" className="ds-textarea" maxLength={5000} defaultValue={values.note} {...describe("tour-note-error", !!errors.note)} />
        {errors.note && (
          <p id="tour-note-error" className="ds-error" role="alert">
            {errors.note}
          </p>
        )}
      </div>
      <div className="ds-trap" aria-hidden="true">
        <label htmlFor="tour-website">Leave this box empty</label>
        <input id="tour-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" className="ds-button" disabled={pending} data-testid="tour-submit">
        {pending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
