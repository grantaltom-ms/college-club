import { createHash } from "node:crypto";
import { normalizeEmail } from "../auth/email";
import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { pacificDate } from "../time";
import type { ClubState, MembershipType } from "../types";
import { addHouseholdRecords, type Ctx } from "./households";
import { readRoster, type RosterHousehold } from "./roster";

/**
 * Move-in day: loading the club's roster from a file staff prepared. Two steps, like ending a membership: `planImport` says
 * exactly what a file would do and changes nothing; `runImport` does it, all or nothing. It only ever adds: a household that
 * is already here (matched by QuickBooks ID) is left alone, and nothing is ever ended, removed or overwritten.
 */

export interface PlannedHousehold {
  quickbooksId: string;
  displayName: string;
  membershipType: MembershipType;
  joinedOn: string;
  adults: { name: string; email: string; role: "primary" | "additional" }[];
}

export interface ImportPlan {
  /** Everything wrong with the file. Anything here means nothing can be added until the file is fixed. */
  problems: string[];
  /** Things worth a look that do not stop the import. */
  notices: string[];
  ignoredColumns: string[];
  rowCount: number;
  /** The households the file would add. */
  toAdd: PlannedHousehold[];
  adultsToAdd: number;
  /** Households in the file whose QuickBooks ID is already in the club: skipped, never changed. */
  alreadyHere: { quickbooksId: string; fileName: string; existingName: string; ended: boolean; adults: number }[];
  /** A fingerprint of the exact file, so the confirm step can tell it is the file that was checked. */
  fingerprint: string;
}

export const fingerprintOf = (text: string) => createHash("sha256").update(text).digest("hex");

function compute(state: ClubState, text: string, today: string): { plan: ImportPlan; add: RosterHousehold[] } {
  const reading = readRoster(text, today);
  const plan: ImportPlan = {
    problems: reading.problems,
    notices: [],
    ignoredColumns: reading.ignoredColumns,
    rowCount: reading.rowCount,
    toAdd: [],
    adultsToAdd: 0,
    alreadyHere: [],
    fingerprint: fingerprintOf(text),
  };
  const add: RosterHousehold[] = [];
  const byQuickbooks = new Map(state.households.filter((h) => h.quickbooksId !== null).map((h) => [h.quickbooksId!, h]));
  for (const h of reading.households) {
    const here = byQuickbooks.get(h.quickbooksId);
    if (here) {
      plan.alreadyHere.push({ quickbooksId: h.quickbooksId, fileName: h.displayName, existingName: here.displayName, ended: here.status === "ended", adults: h.adults.length });
      continue;
    }
    add.push(h);
    plan.toAdd.push({
      quickbooksId: h.quickbooksId,
      displayName: h.displayName,
      membershipType: h.membershipType,
      joinedOn: h.joinedOn,
      adults: h.adults.map((a) => ({ name: `${a.firstName} ${a.lastName}`, email: a.email, role: a.role })),
    });
    plan.adultsToAdd += h.adults.length;
  }

  if (reading.ignoredColumns.length > 0) plan.notices.push(`The file has columns this import does not use, and they are ignored: ${reading.ignoredColumns.map((c) => `"${c}"`).join(", ")}.`);

  // A household with the same name already here, under a different (or no) QuickBooks ID, would be added a second time.
  const namesHere = new Map(state.households.map((h) => [h.displayName.trim().toLowerCase(), h]));
  for (const h of add) {
    const same = namesHere.get(h.displayName.trim().toLowerCase());
    if (same) plan.notices.push(`A household called "${same.displayName}" is already here (QuickBooks ID: ${same.quickbooksId ?? "none"}). The file's "${h.displayName}" (QuickBooks ID ${h.quickbooksId}) will be added as a separate household. If they are the same, stop here and fix the file.`);
  }

  // Partners share one address on purpose; the same address in different households, or already used by someone here, deserves a look.
  const inFile = new Map<string, Set<string>>();
  for (const h of add) for (const a of h.adults) {
    const email = normalizeEmail(a.email);
    if (email) inFile.set(email, (inFile.get(email) ?? new Set()).add(h.displayName));
  }
  for (const [email, households] of inFile) {
    if (households.size > 1) plan.notices.push(`The address ${email} is used in more than one household in the file (${[...households].join(", ")}). That is allowed: whoever signs in with it is asked "Which of you?".`);
  }
  const holders = new Map<string, { name: string; household: string }[]>();
  for (const m of state.members) {
    if (m.status !== "active") continue;
    const email = normalizeEmail(m.email);
    const household = state.households.find((h) => h.id === m.householdId);
    if (email && household) holders.set(email, [...(holders.get(email) ?? []), { name: `${m.firstName} ${m.lastName}`, household: household.displayName }]);
  }
  for (const h of add) for (const a of h.adults) {
    const email = normalizeEmail(a.email);
    const already = email ? holders.get(email) : undefined;
    if (already?.length) plan.notices.push(`${a.email} (${a.firstName} ${a.lastName}) is already used by ${already.map((x) => `${x.name} in ${x.household}`).join(" and ")}.`);
  }
  return { plan, add };
}

/** What a file would do, without doing it. */
export function planImport(state: ClubState, text: string, today: string): ImportPlan {
  return compute(state, text, today).plan;
}

export interface ImportResult {
  added: number;
  adults: number;
  alreadyHere: number;
}

/**
 * Adds every new household in the file in one all-or-nothing change. Staff only. The file is checked again inside the
 * change, so a file with a problem, or one that no longer matches what was previewed (`expect`), adds nothing.
 */
export async function runImport(store: ClubStore, ctx: Ctx, text: string, expect?: { fingerprint: string; households: number; adults: number }): Promise<ImportResult> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can import households.");
  return store.transaction(async (s, newId) => {
    const { plan, add } = compute(s, text, pacificDate(ctx.now));
    if (plan.problems.length > 0) throw new ClubError("invalid", `The file has ${plan.problems.length} problem${plan.problems.length === 1 ? "" : "s"}, so nothing was added. Fix the file and check it again.`);
    if (add.length === 0) {
      throw new ClubError("conflict", plan.alreadyHere.length > 0 ? "Every household in the file is already here, so there is nothing to add." : "The file has no households to add.");
    }
    if (expect && (expect.fingerprint !== plan.fingerprint || expect.households !== plan.toAdd.length || expect.adults !== plan.adultsToAdd)) {
      throw new ClubError("conflict", "The file, or the club's records, changed since you checked it, so nothing was added. Check the file again.");
    }
    for (const h of add) {
      const [primary, ...rest] = h.adults;
      const person = (a: typeof primary) => ({ firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phone });
      addHouseholdRecords(
        s,
        newId,
        ctx,
        { displayName: h.displayName, membershipType: h.membershipType, joinedOn: h.joinedOn, quickbooksId: h.quickbooksId, primary: person(primary), additional: rest.map(person) },
        { source: "a roster file" },
      );
    }
    return { added: add.length, adults: plan.adultsToAdd, alreadyHere: plan.alreadyHere.length };
  });
}
