import { parseItemPatch } from "@/lib/roadmap";
import { json, readBody, withStore } from "@/lib/roadmap-api";

type Context = { params: Promise<{ id: string }> };

/** Change any of title, group, status, due date and owner. */
export async function PATCH(request: Request, { params }: Context) {
  return withStore(request, async (store) => {
    const { id } = await params;
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const patch = parseItemPatch(read.body);
    if (!patch.ok) return json({ error: patch.error }, 400);
    return json({ item: await store.updateItem(id, patch.value) });
  });
}

/** Deletes the item together with its subitems and notes. */
export async function DELETE(request: Request, { params }: Context) {
  return withStore(request, async (store) => {
    const { id } = await params;
    await store.deleteItem(id);
    return json({ ok: true });
  });
}
