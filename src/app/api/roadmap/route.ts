import { json, withStore } from "@/lib/roadmap-api";

/** Private: the whole roadmap in one go. Needs the same sign-in cookie as the Members page. */
export async function GET(request: Request) {
  return withStore(request, async (store) => json(await store.list()));
}
