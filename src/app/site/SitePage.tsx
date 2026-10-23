import Link from "next/link";
import type { Page } from "@/site/content";

/** One page of the public site, drawn from its content. The words live in src/site/content/site.json, not here. */
export function SitePage({ page, children }: { page: Page; children?: React.ReactNode }) {
  return (
    <article>
      <section className="site-hero">
        <h1>{page.heading}</h1>
        {page.intro.map((line) => (
          <p key={line} className="site-lede">
            {line}
          </p>
        ))}
        {page.cta && (
          <p>
            <Link href={page.cta.href} className="site-button" data-testid="site-cta">
              {page.cta.label}
            </Link>
          </p>
        )}
      </section>
      {page.previewNote && (
        <aside className="site-preview-note" data-testid="site-preview-note" aria-label="Preview note">
          <strong>Preview note, not part of the page.</strong> {page.previewNote}
        </aside>
      )}
      {page.sections.map((section, i) => (
        <section key={section.heading ?? i} className="site-section" aria-label={section.heading}>
          {section.heading && <h2>{section.heading}</h2>}
          {section.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.bullets.length > 0 && (
            <ul>
              {section.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {section.cards.length > 0 && (
            <ul className="site-cards">
              {section.cards.map((card) => (
                <li key={card.title} className="site-card" data-testid="site-card">
                  <h3>{card.title}</h3>
                  {card.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {children}
    </article>
  );
}
