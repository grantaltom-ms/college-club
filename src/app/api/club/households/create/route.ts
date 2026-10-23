import type { NextRequest } from "next/server";
import { createHousehold } from "@/club/engine/households";
import { ClubError } from "@/club/errors";
import { HOUSEHOLD_FORM_FIELDS, parseHouseholdForm } from "@/club/web-households";
import { field, see, startPost } from "@/club/web-post";

/** Staff add a household and its adults. On any mistake the form comes back with what was typed, and the page says what is wrong. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const back = new URLSearchParams();
  for (const name of HOUSEHOLD_FORM_FIELDS) back.set(name, field(form, name, 200));
  try {
    const { household } = await createHousehold(store, ctx, parseHouseholdForm(form));
    return see(request, `/club/household/${household.id}?changed=created`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `/club/admin/households/new?${back.toString()}&notice=${e.code === "forbidden" ? "forbidden" : "invalid"}`);
  }
}
