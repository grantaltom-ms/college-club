import { DataProvider } from "@/components/DataProvider";

/**
 * The executive page's own frame (Nov 11): a plain header with the club's name and no dashboard menu, like the committee pages.
 * It reads the same data as the dashboard, so the DataProvider is here too.
 */
export default function ExecutiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="frame">
          <span className="wordmark">College Club Seattle</span>
        </div>
      </header>
      <main className="frame">
        <DataProvider>{children}</DataProvider>
      </main>
    </>
  );
}
