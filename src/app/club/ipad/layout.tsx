import { requireClub } from "@/club/guard";

/**
 * The front-desk iPad: a plain screen with no menu bar, no test-member picker and no links into the rest of the member area.
 * It sits beside (member) on purpose, so a shared screen never shows anyone's menu or the "acting as" line.
 */
export default async function IpadLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  return (
    <div className="ipad">
      <header className="ipad-header">
        <span className="club-wordmark">College Club Seattle</span>
        <span className="ipad-title">Check in</span>
      </header>
      <main className="ipad-main">{children}</main>
    </div>
  );
}
