"use server";

import { ItemEditRefused, restoreItem, retireItem, updateItem, type ItemEdit } from "@/club/engine/equipment-edit";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * The staff buttons on one item: fix its details, retire it, bring it back. Each starts by checking the member area is on and the
 * person is staff; anyone else, and the live site, gets "page not found". The engine writes the item's file line in the same
 * all-or-nothing change.
 */

/** What a refusal says: every problem together, in the engine's own words. */
function refused(e: unknown): ActionResult {
  if (e instanceof ItemEditRefused) return error(e.problems.join(" "));
  return refusal(e);
}

/** Reads the boxes on the edit form. A box that is not on the form (a kind of item with one size, say) is left alone. */
function editFrom(form: FormData): ItemEdit | string {
  const edit: ItemEdit = {};
  if (form.has("name")) edit.name = textOf(form, "name", 200);
  const seats = textOf(form, "seats", 4);
  if (seats !== "") {
    if (!/^\d{1,3}$/.test(seats)) return "Seats must be a whole number.";
    edit.seats = Number(seats);
  }
  const skill = textOf(form, "skill", 60);
  if (skill !== "") edit.skill = skill === "class" ? { mode: "class" } : skill === "none" ? { mode: "none" } : { mode: "code", code: skill };
  const places = textOf(form, "places", 6);
  if (places !== "") {
    if (!/^\d{1,5}$/.test(places)) return "Places must be a whole number.";
    edit.places = Number(places);
  }
  if (form.has("maxWeightLbs")) {
    const weight = textOf(form, "maxWeightLbs", 6).trim();
    if (weight === "") edit.maxWeightLbs = null;
    else if (!/^\d{2,3}$/.test(weight)) return "Max weight must be a whole number of pounds, or left blank.";
    else edit.maxWeightLbs = Number(weight);
  }
  return edit;
}

export async function changeItem(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const item = textOf(formData, "item", 60);
  if (!item) return error("Choose the item.");
  const edit = editFrom(formData);
  if (typeof edit === "string") return error(edit);
  try {
    const done = await updateItem(store, RULE_BOOK, ctx, item, edit);
    const said = done.changes.map((c) => `${c.label.toLowerCase()} from ${c.from} to ${c.to}`).join("; ");
    return ok(`Saved: ${said}.${done.notices.length > 0 ? ` ${done.notices.join(" ")}` : ""}`);
  } catch (e) {
    return refused(e);
  }
}

export async function retireTheItem(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const item = textOf(formData, "item", 60);
  if (!item) return error("Choose the item.");
  try {
    const done = await retireItem(store, ctx, item, { reason: textOf(formData, "reason", 400) });
    const left = done.effects.bookings.length + done.effects.sessions.length + done.effects.practices.length;
    return ok(
      `${done.item.name} is retired.${left === 0 ? " Nothing was booked on it." : ` ${left} ${left === 1 ? "booking, class or practice stays" : "bookings, classes or practices stay"} in place: the list below says who to contact.`}`,
    );
  } catch (e) {
    return refusal(e);
  }
}

export async function bringItemBack(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const item = textOf(formData, "item", 60);
  if (!item) return error("Choose the item.");
  try {
    const back = await restoreItem(store, ctx, item);
    return ok(`${back.name} is back. It can be booked again.`);
  } catch (e) {
    return refusal(e);
  }
}
