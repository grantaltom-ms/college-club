import { requireClub } from "@/club/guard";

/**
 * The honor snack bar iPad: a plain screen with no menu bar, no test-member picker and no links into the rest of the member
 * area, like the front-desk iPad. It sits beside (member) on purpose, so a shared screen never shows anyone's menu.
 */
export default async function SnackLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  return (
    <div className="ipad">
      <header className="ipad-header">
        <span className="club-wordmark">College Club Seattle</span>
        <span className="ipad-title">Snack bar</span>
      </header>
      <main className="ipad-main">{children}</main>
    </div>
  );
}
