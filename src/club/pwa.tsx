import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactElement } from "react";
import { clubEnabled } from "./enabled";
import { LOGO_FILES, LOGOS_AVAILABLE } from "../site/brand-assets";

/**
 * The member app as something a phone can keep on its home screen (the design handoff's step 6). The building comparison: the
 * key fob on the tenant's own ring, instead of a trip to the front desk each time.
 *
 * It is only the member area, never the public site or the front-desk iPad, and it is "page not found" on the live site like
 * everything under /club. This version of Next.js lets a site have one manifest file at its very top, which would apply to
 * every page, so the manifest is a route under /club and only the member pages point at it.
 */

export const MEMBER_APP_NAME = "College Club Seattle";
export const MEMBER_APP_SHORT_NAME = "CCS Members";
export const THEME_COLOR = "#44484D"; // Cyberspace
export const BACKGROUND_COLOR = "#FBFAF6"; // Paper

/** The icon sizes served: the two the manifest lists, and the one iPhones use for "Add to Home Screen". */
export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export const MANIFEST_PATH = "/club/manifest.webmanifest";
export const iconPath = (size: IconSize) => `/club/pwa-icon/${size}`;

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }[];
}

export function memberAppManifest(): WebManifest {
  return {
    name: MEMBER_APP_NAME,
    short_name: MEMBER_APP_SHORT_NAME,
    description: "Your calendar, classes, account and the Weekly Watercooler.",
    start_url: "/club",
    scope: "/club",
    display: "standalone",
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: [
      { src: iconPath(192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconPath(512), sizes: "512x512", type: "image/png", purpose: "any" },
      // The same picture, drawn with room around it so a phone can crop it to a circle or a rounded square.
      { src: iconPath(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Whatever size is asked for in an address, if it is one we make. */
export function parseIconSize(raw: string): IconSize | null {
  return ICON_SIZES.find((s) => String(s) === raw) ?? null;
}

/**
 * What the icon looks like: the white club logo on a Cyberspace square, or until the logo files are in the project, the
 * letters CCS in white. The logo, when there is one, takes up about half the width, so every phone's cropping leaves it whole.
 */
export function iconElement(size: IconSize, logoDataUri: string | null): ReactElement {
  const inner = Math.round(size * 0.56);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: THEME_COLOR, color: "#FFFFFF" }}>
      {logoDataUri ? (
        // eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain image elements, not Next's Image component
        <img src={logoDataUri} alt="" width={inner} height={inner} />
      ) : (
        <div style={{ display: "flex", fontSize: Math.round(size * 0.3), fontWeight: 700, letterSpacing: Math.round(size * 0.02) }}>CCS</div>
      )}
    </div>
  );
}

/** The white logo as a data address for the icon, fetched from this site's own public folder, or null until the logo file exists. */
export async function whiteLogoDataUri(origin: string): Promise<string | null> {
  if (!LOGOS_AVAILABLE) return null;
  const res = await fetch(new URL(LOGO_FILES.white, origin));
  if (!res.ok) return null;
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/**
 * The page-head extras for every page of the member area that people sign in to: the manifest, the iPhone home-screen icon
 * and name. Nothing at all where the member area is switched off, so a hidden page gives nothing away.
 */
export async function memberAppMetadata(): Promise<Metadata> {
  await connection();
  if (!clubEnabled()) return {};
  return {
    manifest: MANIFEST_PATH,
    icons: { apple: [{ url: iconPath(180), sizes: "180x180", type: "image/png" }] },
    appleWebApp: { capable: true, title: MEMBER_APP_SHORT_NAME },
  };
}

/** The colour of the phone's own top bar while the member area is open. Nothing where the area is off. */
export async function memberAppViewport(): Promise<Viewport> {
  await connection();
  return clubEnabled() ? { themeColor: THEME_COLOR } : {};
}
