/**
 * The photo behind the homepage's headline: "members on the deck at sunset, Lake Union", cool and slightly desaturated.
 *
 * None has been supplied, so the homepage shows a plainly labelled placeholder. To switch it on, put the picture in `public/`
 * and replace `null` with `{ src: "/hero.jpg", alt: "..." }`, where the alt text describes what the photo shows. The dark
 * fade at the bottom (so the white headline stays readable) is added by the page.
 */
export interface HeroPhoto {
  src: string;
  alt: string;
}

export const HERO_PHOTO: HeroPhoto | null = null;
