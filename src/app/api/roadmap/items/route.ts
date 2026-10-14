import { parseNewItem } from "@/lib/roadmap";
import { json, readBody, withStore } from "@/lib/roadmap-api";

/** Add an item, or a subitem when `parentId` is given. */
export async function POST(request: Request) {
  return withStore(request, async (store) => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const input = parseNewItem(read.body);
    if (!input.ok) return json({ error: input.error }, 400);
    return json({ item: await store.createItem(input.value) }, 201);
  });
}
