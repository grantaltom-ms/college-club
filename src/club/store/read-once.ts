import { cache } from "react";
import type { ClubState } from "../types";
import { getClubStore } from "./instance";

/**
 * The club's records, read once per request. The menu bar and the page under it both want them (the menu to know whether to
 * show "My boats"); this way they share one read instead of asking the database twice. A page that does not use this still
 * works: it simply reads for itself.
 */
export const readClubOnce = cache(async (): Promise<ClubState> => (await getClubStore()).read());
