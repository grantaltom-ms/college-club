import type { NextRequest } from "next/server";
import { claudeConfigured } from "@/lib/email-lists-claude";
import { getListStore, json } from "@/lib/email-lists-api";
import { EMAIL_LISTS_COOKIE, emailListsPassword, emailListsUnlocked } from "@/lib/email-lists-lock";
import { listsMailchimp } from "@/lib/email-lists-mailchimp";
import { ListStoreError } from "@/lib/email-lists-data";

/** Whether this browser may use the list builder, what is connected, and the saved lists (names of lists only, no members). */
export async function GET(request: NextRequest) {
  const unlocked = emailListsUnlocked(request.cookies.get(EMAIL_LISTS_COOKIE)?.value);
  if (!unlocked) return json({ unlocked: false, passwordSet: emailListsPassword() !== null });
  const connected = { claude: claudeConfigured(), mailchimp: listsMailchimp() !== null };
  const store = getListStore();
  if (!store) return json({ unlocked: true, connected, lists: [], listsError: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });
  try {
    return json({ unlocked: true, connected, lists: await store.list() });
  } catch (error) {
    const message = error instanceof ListStoreError ? error.message : "The saved lists could not be loaded.";
    return json({ unlocked: true, connected, lists: [], listsError: message });
  }
}
