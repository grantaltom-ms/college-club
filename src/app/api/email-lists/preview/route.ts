import type { NextRequest } from "next/server";
import { json, loadPool, readBody, resultBody, withLists } from "@/lib/email-lists-api";
import { parseRule, ruleIsEmpty } from "@/lib/email-lists";

/** Shows who matches filters set by hand on the page (no Claude). */
export async function POST(request: NextRequest) {
  return withLists(request, true, async () => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const parsed = parseRule(read.body.rule);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    if (ruleIsEmpty(parsed.rule)) return json({ error: "Pick at least one filter. With none, the list would be the whole club." }, 400);
    const now = new Date();
    return json(resultBody(await loadPool(now), parsed.rule, now));
  });
}
