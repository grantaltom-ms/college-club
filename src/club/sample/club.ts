import { bookingLedger } from "../engine/bookings";
import { createHousehold, endHousehold, grantQualification, type Ctx, type NewMember } from "../engine/households";
import { MemoryClubStore, sequentialIds, type ClubStore } from "../store/memory";
import { clubNow } from "../clock";
import { addDays, middayPacific, pacificDate } from "../time";
import type { Actor, MembershipType } from "../types";
import { seedSampleEquipment } from "./equipment";

/**
 * Invented households for development and tests. Every name, address and phone number is made up
 * (example.com addresses, 555-01xx phone numbers). Nothing here is, or may ever be, real member data.
 */

export const SAMPLE_STAFF: Actor = { kind: "staff", label: "Test staff" };

interface SampleAdult extends NewMember {
  /** Qualification codes, granted by test staff 30 days after joining. */
  quals?: string[];
}

interface SampleHousehold {
  name: string;
  type: MembershipType;
  /** A fixed date, "THIS_MONTH" (the 1st of the current month) or a number of days before today for the end date. */
  joined: string;
  endedDaysAgo?: number;
  adults: SampleAdult[];
}

const person = (firstName: string, lastName: string, quals: string[] = [], email?: string): SampleAdult => ({
  firstName,
  lastName,
  email: email ?? `${firstName}.${lastName}@example.com`.toLowerCase(),
  phone: `206-555-01${String(((firstName.charCodeAt(0) * 7 + lastName.charCodeAt(0)) % 90) + 10)}`,
  quals,
});

/** 14 households. The comment on each says which case it is there to cover. */
const HOUSEHOLDS: SampleHousehold[] = [
  // Couple, both rowers at different levels.
  { name: "Lindqvist", type: "Resident", joined: "2011-05-14", adults: [person("Erik", "Lindqvist", ["scull-3"]), person("Maren", "Lindqvist", ["scull-2"])] },
  // Single adult, newest rower.
  { name: "Vandermeer", type: "Resident", joined: "2017-09-02", adults: [person("Tomas", "Vandermeer", ["scull-1"])] },
  // Couple, nobody qualified to row.
  { name: "Castellanos", type: "Resident", joined: "2019-03-20", adults: [person("Ines", "Castellanos"), person("Rafael", "Castellanos")] },
  // Three adults, one rower.
  { name: "Whitcombe", type: "Resident", joined: "2014-06-01", adults: [person("Hollis", "Whitcombe", ["scull-2"]), person("Priya", "Rao"), person("Dev", "Rao")] },
  // Intermediate, single adult.
  { name: "Abernathy", type: "Intermediate", joined: "2023-04-10", adults: [person("Nora", "Abernathy", ["scull-1"])] },
  // Intermediate couple, both level 2: a ready-made crew for a double.
  { name: "Tanaka-Brooks", type: "Intermediate", joined: "2022-08-15", adults: [person("Kenji", "Tanaka", ["scull-2"]), person("Alex", "Brooks", ["scull-2"])] },
  // Non-Resident, single adult, no qualifications.
  { name: "Halloran", type: "Non-Resident", joined: "2016-02-27", adults: [person("Declan", "Halloran")] },
  // Non-Resident couple, one rower and one not.
  { name: "Eriksen", type: "Non-Resident", joined: "2012-07-09", adults: [person("Lars", "Eriksen", ["scull-3"]), person("Britta", "Eriksen")] },
  // Partners sharing one email address.
  { name: "Moreau", type: "Resident", joined: "2020-10-05", adults: [person("Camille", "Moreau", ["scull-1"], "moreau.family@example.com"), person("Julien", "Moreau", [], "moreau.family@example.com")] },
  // Membership ended three weeks ago.
  { name: "Fitzgerald", type: "Resident", joined: "2018-03-12", endedDaysAgo: 21, adults: [person("Colm", "Fitzgerald", ["scull-2"]), person("Aoife", "Fitzgerald")] },
  // Joined this month, no qualifications yet.
  { name: "Nakamura", type: "Intermediate", joined: "THIS_MONTH", adults: [person("Yuki", "Nakamura")] },
  // Couple, both top level: a strong crew for any boat.
  { name: "Bellweather", type: "Resident", joined: "2015-04-18", adults: [person("Sasha", "Bellweather", ["scull-3"]), person("Jordan", "Bellweather", ["scull-3"])] },
  // Intermediate couple, one qualified and one not.
  { name: "Okonkwo", type: "Intermediate", joined: "2024-06-22", adults: [person("Chidi", "Okonkwo", ["scull-1"]), person("Amara", "Okonkwo")] },
  // Single adult with every kind of qualification.
  { name: "Pemberton", type: "Resident", joined: "2009-01-30", adults: [person("Walter", "Pemberton", ["scull-3", "sweep"])] },
];

/**
 * Fills a store with the sample households, through the same engine real changes will use, so each
 * household's file reads the way a real one would. "Today" is a parameter so tests are exact.
 */
export async function seedSampleClub(store: ClubStore, today: string): Promise<void> {
  for (const h of HOUSEHOLDS) {
    const joinedOn = h.joined === "THIS_MONTH" ? `${today.slice(0, 7)}-01` : h.joined;
    const joinedAt = middayPacific(joinedOn);
    const [primary, ...additional] = h.adults;
    const { members } = await createHousehold(store, { actor: SAMPLE_STAFF, now: joinedAt }, {
      displayName: `The ${h.name} household`,
      membershipType: h.type,
      joinedOn,
      primary,
      additional,
    });
    // Qualifications are granted a month after joining, or on the day of joining for a brand new household.
    const grantDay = addDays(joinedOn, 30) <= today ? addDays(joinedOn, 30) : joinedOn;
    const grantCtx: Ctx = { actor: SAMPLE_STAFF, now: middayPacific(grantDay) };
    for (const [i, adult] of h.adults.entries()) {
      for (const code of adult.quals ?? []) await grantQualification(store, grantCtx, members[i].id, code);
    }
    if (h.endedDaysAgo !== undefined) {
      const ctx: Ctx = { actor: SAMPLE_STAFF, now: middayPacific(addDays(today, -h.endedDaysAgo)) };
      await endHousehold(store, bookingLedger, ctx, members[0].householdId);
    }
  }
}

/**
 * Fills any store with the sample club: households first, then the boats and a few bookings, all as of `now`
 * (midday on `today` unless given). Works on the in-memory store and on Postgres alike.
 */
export async function seedSample(store: ClubStore, today: string = pacificDate(clubNow()), now: Date = today === pacificDate(clubNow()) ? clubNow() : middayPacific(today)): Promise<void> {
  await seedSampleClub(store, today);
  await seedSampleEquipment(store, now);
}

/** A fresh in-memory store holding the sample club. IDs are fixed, so addresses and test links stay the same between runs. */
export async function buildSampleStore(today?: string, now?: Date): Promise<MemoryClubStore> {
  const store = new MemoryClubStore(sequentialIds());
  await seedSample(store, today, now);
  return store;
}
