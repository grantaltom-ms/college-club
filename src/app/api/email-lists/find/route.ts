import type { NextRequest } from "next/server";
import { json, loadPool, readBody, resultBody, withLists } from "@/lib/email-lists-api";
import { readDescription } from "@/lib/email-lists-claude";
import { pacificToday, ruleIsEmpty } from "@/lib/email-lists";

/** Reads a plain-words description with Claude, then shows who matches. Claude sees the words, never a name or address. */
export async function POST(request: NextRequest) {
  return withLists(request, true, async () => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const description = typeof read.body.description === "string" ? read.body.description.trim() : "";
    if (description.length < 3) return json({ error: "Describe the members you want, for example: joined in the last three months and interested in rowing." }, 400);
    if (description.length > 1000) return json({ error: "That description is too long. Keep it under 1,000 characters." }, 400);
    const now = new Date();
    const pool = await loadPool(now);
    const reading = await readDescription(description, pacificToday(now), pool.info);
    if (ruleIsEmpty(reading.rule)) {
      return json({ reading, words: [], result: null, info: pool.info, error: "None of the filters fit that description, so no list was made." + (reading.notUnderstood.length ? ` Not understood: ${reading.notUnderstood.join("; ")}.` : "") }, 422);
    }
    return json({ reading, ...resultBody(pool, reading.rule, now) });
  });
}
