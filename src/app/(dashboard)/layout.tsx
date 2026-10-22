import type { Metadata } from "next";
import Link from "next/link";
import { DataProvider } from "@/components/DataProvider";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "CCS member usage",
  description: "How College Club Seattle members use the club: door entries, boat reservations, and who has gone quiet.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="frame">
          <Link href="/" className="wordmark">
            College Club Seattle
          </Link>
          <Nav />
        </div>
      </header>
      <main className="frame">
        <DataProvider>{children}</DataProvider>
      </main>
    </>
  );
}
