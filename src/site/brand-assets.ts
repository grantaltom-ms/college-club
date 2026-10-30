/**
 * The club's two logo files, and whether they are in the project yet.
 *
 * Grant's design handoff (Oct 29) names `ccs-logo-black.png` (for light backgrounds) and `ccs-logo-white.png` (for dark ones).
 * They arrived as pictures in the chat, not as files, so they are not here yet. Until they are, every logo spot shows the club's
 * name in the heading font as a stand-in. To switch the logos on: put both files in `public/`, then set `LOGOS_AVAILABLE` to
 * true. A test refuses a flag that disagrees with the files, so it cannot be set too early or forgotten.
 */
export const LOGO_FILES = { black: "/ccs-logo-black.png", white: "/ccs-logo-white.png" } as const;

export const LOGOS_AVAILABLE = false;
