"use server";

import { redirect } from "next/navigation";
import { isRealDay } from "@/club/engine/households";
import { PracticeRefused, addPracticeBoat, cancelPractice, clearSeat, createPractice, removePracticeBoat, seatMember } from "@/club/engine/practices";
import { PRACTICE_RULES } from "@/club/settings/practice-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { clockToMinutes, pacificWall } from "@/club/time";
import { SEAT_SIDES, type SeatSide } from "@/club/types";
import { error, ok, refusal, startSignedInAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * The buttons on the practice screens. Each starts by checking the member area is on and somebody is signed in; anyone else, and the
 * live site, gets "page not found". Whether that person is staff, or the coach who runs the practice, is then decided by the engine,
 * not here, and a refusal comes back in the engine's own words (every reason, when there are several).
 */

function practiceRefusal(e: unknown): ActionResult {
  if (e instanceof PracticeRefused) return error(e.reasons.join(" "));
  return refusal(e);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function clashWords(n: number): string {
  return n === 0 ? "" : ` ${plural(n, "booking")} already made on the practice's boats ${n === 1 ? "overlaps" : "overlap"} it; nothing was cancelled, and the practice page lists who to talk to.`;
}

/** Sets up a practice, and on success goes straight to its page. */
export async function setUpPractice(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const day = textOf(formData, "day", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRealDay(day)) return error("Choose the date of the practice.");
  const start = textOf(formData, "start", 5);
  const end = textOf(formData, "end", 5);
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = pacificWall(day, clockToMinutes(start));
    endsAt = pacificWall(day, clockToMinutes(end));
  } catch {
    return error("Choose a start time and an end time.");
  }
  const boats = formData.getAll("boat").filter((b): b is string => typeof b === "string" && b.length > 0 && b.length <= 60);
  let practiceId: string;
  try {
    const made = await createPractice(store, RULE_BOOK, PRACTICE_RULES, ctx, {
      name: textOf(formData, "name", 500),
      notes: textOf(formData, "notes", 5000),
      startsAt,
      endsAt,
      coachId: textOf(formData, "coach", 60) || null,
      itemIds: boats,
    });
    practiceId = made.practice.id;
  } catch (e) {
    return practiceRefusal(e);
  }
  redirect(`/club/practices/${practiceId}?made=1`);
}

export async function addBoatToPractice(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const practice = textOf(formData, "practice", 60);
  const boat = textOf(formData, "boat", 60);
  if (!practice) return error("Choose the practice.");
  if (!boat) return error("Choose a boat to add.");
  try {
    const done = await addPracticeBoat(store, RULE_BOOK, PRACTICE_RULES, ctx, practice, boat);
    return ok(`The boat is on the practice.${clashWords(done.clashes.length)}`);
  } catch (e) {
    return practiceRefusal(e);
  }
}

export async function takeBoatOffPractice(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const practice = textOf(formData, "practice", 60);
  const boat = textOf(formData, "boat", 60);
  if (!practice || !boat) return error("Choose the practice and the boat.");
  try {
    const done = await removePracticeBoat(store, ctx, practice, boat);
    return ok(done.unseated === 0 ? "The boat is off the practice." : `The boat is off the practice, and ${done.unseated === 1 ? "1 person was" : `${done.unseated} people were`} taken out of their seat.`);
  } catch (e) {
    return practiceRefusal(e);
  }
}

export async function seatPerson(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const practice = textOf(formData, "practice", 60);
  const member = textOf(formData, "member", 60);
  const place = textOf(formData, "place", 80);
  const cut = place.lastIndexOf(":");
  const seat = Number(place.slice(cut + 1));
  if (!practice || !member) return error("Choose the practice and the person.");
  if (cut < 1 || !/^\d{1,2}$/.test(place.slice(cut + 1))) return error("Choose a seat.");
  const sideText = textOf(formData, "side", 12);
  if (sideText !== "" && !(SEAT_SIDES as readonly string[]).includes(sideText)) return error("Choose port, starboard or no side.");
  try {
    await seatMember(store, RULE_BOOK, ctx, { practiceId: practice, itemId: place.slice(0, cut), seat, side: sideText === "" ? null : (sideText as SeatSide), memberId: member });
    return ok("They are in the seat.");
  } catch (e) {
    return practiceRefusal(e);
  }
}

export async function takeOutOfSeat(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const practice = textOf(formData, "practice", 60);
  const boat = textOf(formData, "boat", 60);
  const seat = textOf(formData, "seat", 3);
  if (!practice || !boat || !/^\d{1,2}$/.test(seat)) return error("Choose the practice and the seat.");
  try {
    await clearSeat(store, PRACTICE_RULES, ctx, { practiceId: practice, itemId: boat, seat: Number(seat), reason: textOf(formData, "reason", 500) });
    return ok("The seat is empty.");
  } catch (e) {
    return practiceRefusal(e);
  }
}

export async function cancelThePractice(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const practice = textOf(formData, "practice", 60);
  if (!practice) return error("Choose the practice.");
  try {
    await cancelPractice(store, PRACTICE_RULES, ctx, practice, textOf(formData, "reason", 500));
    return ok("The practice is cancelled. Its boats can be booked again.");
  } catch (e) {
    return practiceRefusal(e);
  }
}
