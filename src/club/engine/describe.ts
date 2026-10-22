import { classRulesFor } from "../settings/class-rules";
import { rulesFor } from "../settings/rulebook";
import { clockToMinutes, formatClock, formatMinutes, pacificWall } from "../time";
import type { ClassRules, ClassTemplate, ClubState, Item, RuleBook } from "../types";

/** The rules that apply to one item, in plain words, for the booking form. Every number comes from the settings file. */
export function describeRules(state: ClubState, book: RuleBook, item: Item): { heading: string; lines: string[]; placeholder: boolean } {
  const { cls, rules, requiredQualification } = rulesFor(book, item);
  const type = cls.type.toLowerCase();
  const clock = (c: string) => formatClock(pacificWall("2026-01-15", clockToMinutes(c) === 1440 ? 1439 : clockToMinutes(c))).replace("11:59 pm", "midnight");
  const opens = rules.opensAt === "00:00" ? "midnight" : formatClock(pacificWall("2026-01-15", clockToMinutes(rules.opensAt)));
  const need = requiredQualification ? state.qualifications.find((q) => q.code === requiredQualification)?.name : null;
  const lines = [
    `Book up to ${rules.windowDays} day${rules.windowDays === 1 ? "" : "s"} ahead. A new day opens at ${opens} Pacific time.`,
    `Bookings run from ${clock(rules.dayStart)} to ${clock(rules.dayEnd)}, in ${rules.slotMinutes}-minute steps.`,
    `The shortest booking is ${formatMinutes(rules.minMinutes)} and the longest is ${formatMinutes(rules.maxMinutes)}.`,
    `You can hold ${rules.maxFuturePerType} upcoming ${type} booking${rules.maxFuturePerType === 1 ? "" : "s"} at once, and have ${rules.maxPerDayPerType} a day.`,
    `Cancel at least ${formatMinutes(rules.cancelCutoffMinutes)} before the start, or it counts as a late cancellation.`,
    need ? `You need ${need}.` : "No qualification is needed.",
  ];
  if (rules.gapMinutes > 0) lines.splice(3, 0, `Leave ${formatMinutes(rules.gapMinutes)} free between bookings of the same ${cls.name.toLowerCase()}.`);
  if (cls.seats > 1) lines.push(`${item.name} has ${cls.seats} seats. You can add up to ${cls.seats - 1} other member${cls.seats - 1 === 1 ? "" : "s"} as crew; each needs the same qualification. Crew do not count toward their own limits, but nobody can be in two boats at once.`);
  return { heading: `Rules for ${item.name} (${cls.name.toLowerCase()})`, lines, placeholder: book.placeholder };
}

/** The rules that apply to one class, in plain words, for the class page. Every number comes from the settings file. */
export function describeClassRules(classRules: ClassRules, template: ClassTemplate): { heading: string; lines: string[]; placeholder: boolean } {
  const r = classRulesFor(classRules, template);
  const days = `${r.signUpDaysAhead} day${r.signUpDaysAhead === 1 ? "" : "s"}`;
  const opens = r.opensAt === "00:00" ? "midnight" : formatClock(pacificWall("2026-01-15", clockToMinutes(r.opensAt)));
  const lines = [
    `Sign up to ${days} ahead. A new day opens at ${opens} Pacific time.`,
    `Sign-up closes ${formatMinutes(r.closeMinutesBefore)} before the start.`,
    r.waitlistMax > 0
      ? `When a class is full you can join the waiting list (up to ${r.waitlistMax} ${r.waitlistMax === 1 ? "person" : "people"}). Whoever is first in line gets a chair the moment one frees up, until ${formatMinutes(r.promoteUntilMinutesBefore)} before the start. After that, a free chair goes to whoever asks first.`
      : "When a class is full there is no waiting list.",
    `You can hold ${r.maxUpcomingPerMember} upcoming class place${r.maxUpcomingPerMember === 1 ? "" : "s"} at once (a waiting-list spot counts), and sign up for ${r.maxPerDayPerMember} class${r.maxPerDayPerMember === 1 ? "" : "es"} a day.`,
    `Leave at least ${formatMinutes(r.cancelCutoffMinutes)} before the start, or it counts as a late cancellation. Leaving a waiting list is never late.`,
    "Nobody can be in two places at once: a class cannot overlap another class (or a waiting-list place), or a boat you have booked.",
  ];
  return { heading: `Rules for ${template.name}`, lines, placeholder: classRules.placeholder };
}
