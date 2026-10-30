"use server";

import { notFound } from "next/navigation";
import { getMailer } from "@/club/auth/mail";
import { clubNow } from "@/club/clock";
import { notifyAboutTourRequest, submitTourRequest, tourNotifyAddress } from "@/club/engine/tours";
import { TOUR_RULES } from "@/club/settings/tour-rules";
import { getTourStore } from "@/club/store/tours-instance";
import { siteEnabled } from "@/site/enabled";
import type { TourFormState } from "./state";

const field = (form: FormData, name: string, max: number): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
};

/**
 * The public Request a tour form. Saves the request, then (best effort) tells the membership office by email. Where the public
 * site is switched off this answers "page not found" before it reads anything, like every other page of the site.
 */
export async function requestTour(_previous: TourFormState, form: FormData): Promise<TourFormState> {
  if (!siteEnabled()) notFound();
  const input = { name: field(form, "name", 400), email: field(form, "email", 400), phone: field(form, "phone", 200), note: field(form, "note", 5000), website: field(form, "website", 200) };
  const now = clubNow();
  const result = await submitTourRequest(getTourStore(), TOUR_RULES, input, now);
  if (!result.ok) {
    if ("busy" in result) return { kind: "busy" };
    return { kind: "error", errors: result.errors, values: { name: input.name, email: input.email, phone: input.phone, note: input.note } };
  }
  if (result.request) await notifyAboutTourRequest(getMailer(), result.request, tourNotifyAddress(), now);
  return { kind: "sent", firstName: result.firstName };
}
