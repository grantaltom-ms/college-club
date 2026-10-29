import Image from "next/image";
import type { ReactNode } from "react";
import { LOGO_FILES, LOGOS_AVAILABLE } from "@/site/brand-assets";

/** A small label above a heading, in capitals. "sun" is for dark bands, "waterloo" for light pages. */
export function Eyebrow({ tone = "waterloo", children }: { tone?: "waterloo" | "sun"; children: ReactNode }) {
  return <p className={tone === "sun" ? "ds-eyebrow ds-eyebrow-sun" : "ds-eyebrow"}>{children}</p>;
}

/** The regatta lane rope: a thin line with Sun floats. Decorative, so hidden from screen readers. */
export function LaneLine({ contained = true }: { contained?: boolean }) {
  // `contained` lines it up with the page's content width; a screen that already has its own column passes false.
  if (!contained) return <div className="ds-lane" aria-hidden="true" />;
  return (
    <div className="ds-container ds-divider" aria-hidden="true">
      <div className="ds-lane" />
    </div>
  );
}

/** The long swell: a gentle wave, used as the way into the footer. Decorative, so hidden from screen readers. */
export function WaveSwell() {
  return (
    <div className="ds-container ds-divider ds-divider-wave" aria-hidden="true">
      <div className="ds-wave" />
    </div>
  );
}

/**
 * The club's mark: the logo picture once its file is in the project (`black` on light backgrounds, `white` on dark ones), and
 * until then the club's name in the heading font. See src/site/brand-assets.ts.
 */
export function Logo({ tone, size }: { tone: "black" | "white"; size: number }) {
  if (LOGOS_AVAILABLE) return <Image src={LOGO_FILES[tone]} alt="College Club Seattle logo" width={size} height={size} priority />;
  return <span className={tone === "white" ? "ds-wordmark ds-wordmark-white" : "ds-wordmark"}>College Club Seattle</span>;
}
