import { DataProvider } from "@/components/DataProvider";
import { CommitteeHeader } from "@/components/CommitteeHeader";

/**
 * The committee pages' own frame: a plain header with no dashboard menu, so they stand apart from the dashboard (Grant, Nov 9).
 * They still read the same data as the dashboard, so the DataProvider is here too.
 */
export default function CommitteesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommitteeHeader />
      <main className="frame">
        <DataProvider>{children}</DataProvider>
      </main>
    </>
  );
}
