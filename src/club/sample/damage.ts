import { assignDamageReport, dismissDamageReport, fileDamageReport, markDamageRepaired, startDamageRepair } from "../engine/damage";
import { fullName } from "../engine/queries";
import { DAMAGE_RULES } from "../settings/damage-rules";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate } from "../time";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented damage reports. One major report being fixed on the boat that is already out of service (Merganser), one minor report
 * still open (Pelican), one repaired and one dismissed. The boats and the people are the invented club's; nothing here is real.
 * They use boats and members the other sample bookings and the browser tests do not.
 */
export async function seedSampleDamage(store: ClubStore, now: Date): Promise<void> {
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m;
  };
  const item = (name: string) => {
    const i = state.items.find((x) => x.name === name);
    if (!i) throw new Error(`Sample item ${name} is missing.`);
    return i.id;
  };
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600000);
  const staffAt = (when: Date) => ({ actor: SAMPLE_STAFF, now: when });
  const memberAt = (name: string, when: Date) => {
    const m = member(name);
    return { actor: { kind: "member" as const, memberId: m.id, label: fullName(m) }, now: when };
  };

  // Major, and being fixed: Merganser has been out of service since the equipment was loaded.
  const rigger = await fileDamageReport(store, memberAt("Erik Lindqvist", hoursAgo(96)), DAMAGE_RULES, {
    itemId: item("Merganser"),
    description: "The bow side rigger is bent and the oarlock will not hold.",
    location: "Bow side rigger",
    howItHappened: "It caught the dock on the way in.",
    major: true,
  });
  await assignDamageReport(store, staffAt(hoursAgo(90)), DAMAGE_RULES, { reportId: rigger.id, assignedTo: "Boat shop volunteer" });
  await startDamageRepair(store, staffAt(hoursAgo(48)), { reportId: rigger.id });

  // Minor, still open.
  await fileDamageReport(store, memberAt("Maren Lindqvist", hoursAgo(40)), DAMAGE_RULES, {
    itemId: item("Pelican"),
    description: "The foot stretcher on the stroke side is loose.",
    location: "Stroke seat",
    major: false,
  });

  // Repaired: filed three weeks ago, fixed the next day, with the time and cost.
  const seat = await fileDamageReport(store, memberAt("Sasha Bellweather", hoursAgo(24 * 21)), DAMAGE_RULES, {
    itemId: item("Loon"),
    description: "The sliding seat sticks halfway down the track.",
    location: "Bow seat",
    howItHappened: "Grit in the track after the last regatta.",
    major: false,
  });
  const fixedOn = addDays(pacificDate(hoursAgo(24 * 21)), 1);
  await markDamageRepaired(store, staffAt(hoursAgo(24 * 20)), DAMAGE_RULES, {
    reportId: seat.id,
    repairedOn: fixedOn,
    repairedBy: "Boat shop volunteer",
    repairMinutes: 90,
    costCents: 1850,
    notes: "Cleaned and re-greased the track and replaced two seat wheels.",
  });

  // Dismissed: a second report of something already reported.
  const copy = await fileDamageReport(store, memberAt("Kenji Tanaka", hoursAgo(24 * 5)), DAMAGE_RULES, {
    itemId: item("Tern"),
    description: "A scratch along the hull.",
    major: false,
  });
  await dismissDamageReport(store, staffAt(hoursAgo(24 * 4)), DAMAGE_RULES, { reportId: copy.id, reason: "Already on the list from the spring inspection." });
}
