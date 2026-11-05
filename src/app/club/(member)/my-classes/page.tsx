import { redirect } from "next/navigation";
import { requireClub } from "@/club/guard";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

/**
 * My classes is part of My bookings now (Grant, Nov 5, 2026): a member's class sign-ups sit in the same list as their boat and space
 * bookings. This old address forwards there, carrying only the notices the old page understood (left, checkedin, notice), so a saved
 * link or an old email still lands somewhere useful. The member area check comes first, so on the live site it is "page not found".
 */
export default async function MyClasses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const params = await searchParams;
  const keep = new URLSearchParams();
  for (const key of ["left", "checkedin", "notice"]) {
    const value = one(params[key]);
    if (value) keep.set(key, value);
  }
  const query = keep.toString();
  redirect(`/club/my-bookings${query ? `?${query}` : ""}`);
}
