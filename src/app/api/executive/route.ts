import type { NextRequest } from "next/server";
import { json, withPriorities } from "@/lib/executive-api";
import { canEditExecutive, EXECUTIVE_COOKIE, executivePassword } from "@/lib/executive-lock";

/** The executive page's priorities, in order. Anyone with the link can read them. */
export async function GET(request: NextRequest) {
  return withPriorities(request, false, async (store) =>
    json({
      source: store.source,
      items: await store.list(),
      canEdit: canEditExecutive(request.cookies.get(EXECUTIVE_COOKIE)?.value),
      editingSetUp: executivePassword() !== null,
    }),
  );
}
