import type { NextRequest } from "next/server";
import { json, readBody, withPriorities } from "@/lib/executive-api";
import { parseOrder } from "@/lib/executive-items";

/** Puts the priorities in a new order: { ids: [...] }, every id once. */
export async function POST(request: NextRequest) {
  return withPriorities(request, true, async (store) => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const current = (await store.list()).map((p) => p.id);
    const order = parseOrder(read.body, current);
    if (!order.ok) return json({ error: order.error }, 409);
    return json({ items: await store.reorder(order.value) });
  });
}
