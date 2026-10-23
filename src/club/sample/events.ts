import { createEvent, rsvp } from "../engine/events";
import { fullName } from "../engine/queries";
import { EVENT_RULES } from "../settings/event-rules";
import type { EventRules } from "../types";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented club events: a ticketed social with a limit, a dinner that is full with a waiting list, and a free work
 * party with no limit. Locations, prices and descriptions are made up. Nothing here is a real event.
 */
/** The sample waitlist places never run out, so the demo dinner keeps its waitlist however long the server has been up. */
const SAMPLE_RULES: EventRules = { ...EVENT_RULES, defaults: { ...EVENT_RULES.defaults, waitlistHoldMinutes: 0 } };

export async function seedSampleEvents(store: ClubStore, now: Date): Promise<void> {
  const staff = { actor: SAMPLE_STAFF, now };
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m.id;
  };
  const today = pacificDate(now);
  const at = (daysAhead: number, hour: number, minute = 0) => pacificWall(addDays(today, daysAhead), hour * 60 + minute);

  const dinner = await createEvent(store, staff, {
    title: "Members' Dinner",
    description: "A seated dinner on the clubhouse deck. Vegetarian choice on request.",
    location: "The clubhouse deck",
    startsAt: at(2, 18),
    endsAt: at(2, 21),
    capacity: 12,
    priceCents: 4500,
  });
  const social = await createEvent(store, staff, {
    title: "Fall Regatta Social",
    description: "Drinks and snacks after the regatta. Bring a friend.",
    location: "The boathouse",
    startsAt: at(3, 18),
    endsAt: at(3, 21),
    capacity: 40,
    priceCents: 2500,
  });
  const workParty = await createEvent(store, staff, {
    title: "Boathouse Work Party",
    description: "Sanding, painting and tidying. Coffee and pastries provided.",
    location: "The boathouse",
    startsAt: at(6, 9),
    endsAt: at(6, 12),
    capacity: null,
    priceCents: 0,
  });

  const go = (eventId: string, name: string, guests = 0) => rsvp(store, SAMPLE_RULES, { actor: SAMPLE_STAFF, now }, { eventId, memberId: member(name), guests });
  // The dinner is full (12 places) with two groups waiting, in this order.
  for (const [name, guests] of [["Erik Lindqvist", 1], ["Maren Lindqvist", 0], ["Jordan Bellweather", 2], ["Sasha Bellweather", 0], ["Tomas Vandermeer", 1], ["Walter Pemberton", 2]] as const) await go(dinner.id, name, guests);
  await go(dinner.id, "Nora Abernathy", 1);
  await go(dinner.id, "Ines Castellanos", 0);
  // The social has plenty of room.
  for (const [name, guests] of [["Lars Eriksen", 1], ["Britta Eriksen", 0], ["Camille Moreau", 2], ["Kenji Tanaka", 0], ["Alex Brooks", 1]] as const) await go(social.id, name, guests);
  // A few for the work party.
  for (const name of ["Hollis Whitcombe", "Priya Rao", "Yuki Nakamura"]) await go(workParty.id, name);
}
