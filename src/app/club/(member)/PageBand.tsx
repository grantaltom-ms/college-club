import type { ReactNode } from "react";

/**
 * The title band at the top of a members' or staff screen (design package "Waterloo Blocks", Nov 2026): a full-width blue-grey
 * strip with a small label above the screen's one heading, and up to two actions on the right. Every screen has exactly one
 * H1 and it lives here. Style rules are in club-app.css (`.club-band`).
 *
 * The actions are ordinary `club-button` links or buttons: inside the band the first is drawn white (the main action) and
 * a `club-button-quiet` one is drawn as a white outline.
 */
export function PageBand({
  eyebrow,
  title,
  titleTestId,
  titleTag,
  children,
}: {
  /** Context above the heading, for example the date or the section name. */
  eyebrow?: string;
  title: string;
  /** Some tests find the heading by this id. */
  titleTestId?: string;
  /** A small word (or several) shown inside the heading after the title, for example "Cancelled" or ["Retired", "Private"]. */
  titleTag?: string | string[];
  /** Up to two actions. */
  children?: ReactNode;
}) {
  const tags = (Array.isArray(titleTag) ? titleTag : titleTag ? [titleTag] : []).filter((t) => t !== "");
  return (
    <div className="club-band">
      <div className="club-band-inner">
        <div className="club-band-text">
          {eyebrow ? <p className="club-band-eyebrow">{eyebrow}</p> : null}
          <h1 data-testid={titleTestId}>
            {title}
            {tags.map((tag) => (
              <span key={tag} className="club-tag">
                {tag}
              </span>
            ))}
          </h1>
        </div>
        {children ? <div className="club-band-actions">{children}</div> : null}
      </div>
    </div>
  );
}
