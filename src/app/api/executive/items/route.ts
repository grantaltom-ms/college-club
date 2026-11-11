import type { NextRequest } from "next/server";
import { json, readBody, withPriorities } from "@/lib/executive-api";
import { parsePriority } from "@/lib/executive-items";

/** Adds a priority at the bottom of the page. */
export async function POST(request: NextRequest) {
  return withPriorities(request, true, async (store) => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const input = parsePriority(read.body);
    if (!input.ok) return json({ error: input.error }, 400);
    return json({ item: await store.create(input.value) }, 201);
  });
}
