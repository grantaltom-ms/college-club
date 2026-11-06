import { notFound } from "next/navigation";
import { archiveFacts, switchOnReport, type CheckGroup, type CheckRow, type CheckStatus } from "@/club/engine/switch-on";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { SAMPLE_ITEMS } from "@/club/sample/equipment";
import { SAMPLE_HISTORY_FILE } from "@/club/sample/icrew";
import { placeholderRulesFiles } from "@/club/settings/placeholders";
import { getHistoryStore } from "@/club/store/history-instance";
import { getClubStore } from "@/club/store/instance";
import { describeTarget } from "@/club/store/migrate";
import { SignedOut } from "../../SignedOut";
import { PageBand } from "../../PageBand";

const STATUS_WORDS: Record<CheckStatus, string> = { ready: "Ready", not_ready: "Not ready", person: "Needs a person" };

const GROUPS: { group: CheckGroup; title: string; intro: string }[] = [
  { group: "settings", title: "The building's settings", intro: "What this server has been told, in its private settings. Nothing secret is ever shown here: a secret is only ever “set” or “not set”." },
  { group: "records", title: "The records", intro: "What is loaded, counted from the club's own records." },
  { group: "people", title: "Only people can confirm", intro: "A computer cannot see these, so they are listed, never ticked. Each says who does it." },
];

function Row({ row }: { row: CheckRow }) {
  return (
    <li className="club-card" data-testid={`check-${row.id}`} data-status={row.status}>
      <p className="club-row-kind" data-testid="check-status">
        {STATUS_WORDS[row.status]}
      </p>
      <h3>{row.title}</h3>
      <p data-testid="check-detail">{row.detail}</p>
      {row.fix !== "" && (
        <p className="club-meta" data-testid="check-fix">
          <strong>{row.status === "person" ? "Who:" : "To do:"}</strong> {row.fix}
        </p>
      )}
    </li>
  );
}

/**
 * Staff only: the walk-through before opening day (Grant, Nov 6, 2026). It reads this server's private settings and a few counts from
 * the club's records, and says in plain words what is ready, what is not and what only a person can confirm. It changes nothing.
 * It can only speak for the server in front of it: on a test version it describes the test version.
 */
export default async function SwitchOn() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const [state, history] = await Promise.all([getClubStore().then((s) => s.read()), getHistoryStore().then((h) => h.summary())]);
  const databaseUrl = process.env.CLUB_DATABASE_URL?.trim();
  const report = switchOnReport({
    env: process.env,
    state,
    archive: archiveFacts(history),
    sample: { itemNames: SAMPLE_ITEMS.map((i) => i.name), archiveFile: SAMPLE_HISTORY_FILE },
    placeholderRules: placeholderRulesFiles(),
    databaseTarget: databaseUrl ? describeTarget(databaseUrl) : null,
  });

  return (
    <section>
      <PageBand eyebrow="Switch-on" title="Ready to switch on?" />
      <p>
        Like the walk-through before opening day: every door, light and lock is checked and written down, with who has to fix what is not right. Looking at this list changes nothing, and nothing here switches anything on.
      </p>
      <p className="club-placeholder" role="note" data-testid="switch-on-scope">
        {report.lookingAt === "test_build"
          ? "You are looking at a test version. This list reads the settings and records of the server it is shown on, so here it describes this test version and not the real site. Several lines read “not ready” on a test version on purpose: invented data is allowed and no real email is sent. The same screen on the real server is the go or no-go."
          : "This list reads the settings and records of the server it is shown on."}
      </p>
      <p className={report.counts.notReady > 0 ? "club-alert" : "club-success"} role="status" data-testid="switch-on-verdict">
        {report.verdict}
      </p>
      <p className="club-meta" data-testid="switch-on-counts">
        {report.counts.ready} ready, {report.counts.notReady} not ready, {report.counts.person} for a person.
      </p>
      {GROUPS.map(({ group, title, intro }) => {
        const rows = report.rows.filter((r) => r.group === group);
        return (
          <div key={group} data-testid={`group-${group}`}>
            <h2>{title}</h2>
            <p>{intro}</p>
            <ul className="club-list">
              {rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
