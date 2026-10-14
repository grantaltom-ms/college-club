import { json, withStore } from "@/lib/roadmap-api";

/** The whole roadmap in one go. Open to anyone with the link. */
export async function GET() {
  return withStore(async (store) => json(await store.list()));
}
