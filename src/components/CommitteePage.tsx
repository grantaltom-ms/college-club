"use client";

import type { ComponentType } from "react";
import { EmailSection } from "@/components/sections/EmailSection";
import { EventsSection } from "@/components/sections/EventsSection";
import { MembershipSection } from "@/components/sections/MembershipSection";
import { ReservationsSection } from "@/components/sections/ReservationsSection";
import { ShellsSection } from "@/components/sections/ShellsSection";
import { SummarySection } from "@/components/sections/SummarySection";
import { TimingSection } from "@/components/sections/TimingSection";
import { VisitsSection } from "@/components/sections/VisitsSection";
import { committeeBySlug, type Committee, type SectionKey } from "@/lib/committees";

const SECTIONS: Record<SectionKey, ComponentType> = {
  summary: SummarySection,
  shells: ShellsSection,
  reservations: ReservationsSection,
  timing: TimingSection,
  visits: VisitsSection,
  membership: MembershipSection,
  email: EmailSection,
  events: EventsSection,
};

/** One committee's page: its own sections first, then the shared ones, each the dashboard's own section in full. */
export function CommitteePage({ slug }: { slug: Committee["slug"] }) {
  const committee = committeeBySlug(slug);
  if (!committee) return null;
  return (
    <>
      <h1 className="page-title">{committee.name}.</h1>
      <p className="page-sub">
        {committee.covers} The figures below are the board dashboard&apos;s own, always current.
      </p>
      <nav className="committee-contents" aria-label="On this page">
        <ol>
          {committee.sections.map((s) => (
            <li key={s.key}>
              <a href={`#${s.key}`}>{s.heading}</a>
              {s.shared && <span className="committee-shared"> (shared)</span>}
            </li>
          ))}
        </ol>
      </nav>
      {committee.sections.map((s) => {
        const Section = SECTIONS[s.key];
        return (
          <section key={s.key} id={s.key} className="committee-section" aria-labelledby={`${s.key}-heading`} data-testid={`section-${s.key}`}>
            <div className="committee-section-head">
              <p className="committee-kicker">{s.shared ? "Shared with another committee" : "Yours"}</p>
              <h2 id={`${s.key}-heading`} className="committee-section-title">
                {s.heading}
              </h2>
              <p className="committee-why">
                <strong>Why this matters to you:</strong> {s.why}
              </p>
            </div>
            <Section />
          </section>
        );
      })}
    </>
  );
}
