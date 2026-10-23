import type { NextRequest } from "next/server";
import { getAuthStore } from "@/club/auth/instance";
import { editMemberDetails } from "@/club/auth/edit-details";
import { memberFieldsProblem } from "@/club/engine/households";
import { idParam } from "@/club/web";
import { parseAdultForm } from "@/club/web-households";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/**
 * Staff correct an adult's name, email or phone. A change of email also signs the person out of every device. A mistake
 * sends the form back with what was typed; the page words the problem itself, in the engine's own words.
 */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  const memberId = idParam(field(form, "member"));
  if (!householdId || !memberId) return see(request, "/club?notice=invalid");
  const editPage = `/club/admin/households/${householdId}/members/${memberId}/edit`;
  const person = parseAdultForm(form);
  if (memberFieldsProblem(person)) {
    const back = new URLSearchParams({ firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone ?? "" });
    return see(request, `${editPage}?${back.toString()}&notice=invalid`);
  }
  try {
    const result = await editMemberDetails(store, getAuthStore(), ctx, memberId, person);
    return see(request, `/club/household/${householdId}?changed=${result.signInChanged ? "updated_email" : "updated"}`);
  } catch (e) {
    return see(request, `${editPage}?notice=${noticeCode(e)}`);
  }
}
