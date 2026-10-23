import type { NextRequest } from "next/server";
import { addMember, memberFieldsProblem } from "@/club/engine/households";
import { idParam } from "@/club/web";
import { parseAdultForm } from "@/club/web-households";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff add an adult to a household. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  if (!householdId) return see(request, "/club?notice=invalid");
  const person = parseAdultForm(form);
  // A mistake sends the form back with what was typed; the page works out and words the problem itself.
  if (memberFieldsProblem(person)) {
    const back = new URLSearchParams({ firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone ?? "" });
    return see(request, `/club/household/${householdId}?${back.toString()}&notice=invalid#add-adult`);
  }
  try {
    await addMember(store, ctx, householdId, person);
    return see(request, `/club/household/${householdId}?changed=added`);
  } catch (e) {
    return see(request, `/club/household/${householdId}?notice=${noticeCode(e)}`);
  }
}
