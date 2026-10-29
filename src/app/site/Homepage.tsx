import Image from "next/image";
import { ButtonLink } from "@/components/ds/ButtonLink";
import { Eyebrow, LaneLine, WaveSwell } from "@/components/ds/Pieces";
import type { Homepage as HomepageContent } from "@/site/content";
import type { HeroPhoto } from "@/site/hero-photo";

/**
 * The public homepage, built to move a visitor to "Request a tour" (and, second, to "How to join"). The words are in
 * src/site/content/site.json under `homepage`; the footer and header are in the shared layout. The one H1 on the page is the
 * headline in the hero.
 */
export function Homepage({ content, tourHref, photo }: { content: HomepageContent; tourHref: string; photo: HeroPhoto | null }) {
  const { hero, features, join } = content;
  return (
    <>
      <section className="ds-hero ds-dark ds-ui" data-testid="hero">
        {photo ? (
          <>
            <Image className="ds-hero-image" src={photo.src} alt={photo.alt} fill priority sizes="100vw" />
            <div className="ds-hero-fade" aria-hidden="true" />
          </>
        ) : (
          <p className="ds-hero-placeholder" role="img" aria-label="Photo placeholder: members on the deck at sunset, Lake Union" data-testid="hero-photo-placeholder">
            Photo: members on the deck at sunset
          </p>
        )}
        <div className="ds-container ds-hero-content">
          <div className="ds-hero-column">
            <Eyebrow tone="sun">{hero.eyebrow}</Eyebrow>
            <h1>{hero.heading}</h1>
            <p className="ds-hero-lead">{hero.lead}</p>
            <div className="ds-hero-actions">
              <ButtonLink href={tourHref} size="large" data-ds-hero-cta="true" data-track="request-a-tour-hero" data-testid="hero-tour">
                {hero.tourLabel}
              </ButtonLink>
              <a href="#how-to-join" className="ds-hero-join" data-track="how-to-join" data-testid="hero-join">
                {hero.joinLabel} <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="ds-container ds-features ds-ui" aria-label={features.eyebrow}>
        <Eyebrow>{features.eyebrow}</Eyebrow>
        <ul className="ds-features-list" role="list">
          {features.items.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <LaneLine />

      <section id="how-to-join" className="ds-container ds-join ds-ui" aria-label={join.eyebrow}>
        <Eyebrow>{join.eyebrow}</Eyebrow>
        <h2>{join.heading}</h2>
        {/* TODO(club): steps 1 and 2 are the designer's placeholder wording. Confirm the club's real membership process, then
            edit homepage.join in src/site/content/site.json and remove its previewNote. */}
        <ol className="ds-steps" role="list">
          {join.steps.map((step, i) => (
            <li key={step.lead} className="ds-step">
              <span className="ds-step-number" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <strong>{step.lead}</strong> {step.text}
              </span>
            </li>
          ))}
        </ol>
        <aside className="site-preview-note" data-testid="site-preview-note" aria-label="Preview note">
          <strong>Preview note, not part of the page.</strong> {join.previewNote}
        </aside>
      </section>

      <WaveSwell />
    </>
  );
}
