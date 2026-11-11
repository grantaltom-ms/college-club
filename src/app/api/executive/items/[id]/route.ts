import type { NextRequest } from "next/server";
import { json, readBody, withPriorities } from "@/lib/executive-api";
import { parsePriority } from "@/lib/executive-items";

type Context = { params: Promise<{ id: string }> };

/** Saves a priority's whole text. */
export async function PUT(request: NextRequest, { params }: Context) {
  return withPriorities(request, true, async (store) => {
    const { id } = await params;
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const input = parsePriority(read.body);
    if (!input.ok) return json({ error: input.error }, 400);
    return json({ item: await store.update(id, input.value) });
  });
}

/** Removes a priority from the page. */
export async function DELETE(request: NextRequest, { params }: Context) {
  return withPriorities(request, true, async (store) => {
    const { id } = await params;
    await store.remove(id);
    return json({ ok: true });
  });
}
