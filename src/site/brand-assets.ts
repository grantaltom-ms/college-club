/**
 * The club's two logo files, and whether they are in the project.
 *
 * Grant's design handoff (Oct 29) names `ccs-logo-black.png` (for light backgrounds) and `ccs-logo-white.png` (for dark ones).
 * The design package of Nov 4 supplied both as files, and Grant said (Nov 4) to switch them on for the public site's header, the
 * sign-in and demo screens and the phone home-screen icons. The two supplied files had different empty margins (the black one
 * 812 pixels square with about 12 percent of it empty, the white one 306 by 303 with about 8 percent), so they were trimmed to
 * the artwork, made square with the same 3 percent border and saved at 360 pixels, which makes both draw at the same size.
 * With the switch off, every logo spot shows the club's name in the heading font as a stand-in. A test refuses a flag that
 * disagrees with the files, so it cannot be set too early or forgotten.
 */
export const LOGO_FILES = { black: "/ccs-logo-black.png", white: "/ccs-logo-white.png" } as const;

export const LOGOS_AVAILABLE = true;
