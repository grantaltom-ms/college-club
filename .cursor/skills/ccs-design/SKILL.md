---
name: ccs-design
description: >
  College Club Seattle visual and UX design for /club and /site screens. Use when
  building or restyling member app pages, staff office screens, public homepage
  pieces, forms, buttons, or navigation — not for the usage dashboard pages.
paths:
  - "src/app/club/**"
  - "src/app/site/**"
  - "src/components/ds/**"
  - "src/app/club/club.css"
  - "src/components/ds/ds.css"
  - "src/app/globals.css"
---

# CCS design (club + public site)

One brand, two surfaces. Tokens are the source of truth — do not invent new colors or fonts.

## Before you draw

1. Read tokens in `src/app/globals.css` (`:root`).
2. Member / staff UI (pages inside `src/app/club/(member)/`): the look is `src/app/club/club-app.css` (everything under `.club-app`) plus the older shared rules in `club.css`. Start every screen with `<PageBand>` (the Waterloo title band with the screen's one H1). Reuse patterns on neighbouring pages.
3. Public marketing / handoff UI: reuse `src/components/ds/` (`ds-` classes only).
4. Do **not** restyle the usage dashboard (`src/app/(dashboard)/`, `src/components/Nav.tsx`) unless Grant asked for that.

## Visual language

Two looks (Grant, Nov 4). Light mode only in both.

**Members and staff (`/club` pages with the menu bar): the package "Waterloo Blocks".**
- White page. Solid Oyster top bar (the only Oyster). A Waterloo title band on every screen with white text. White cards on cool 1px lines. No beige or cream fills, no alternating section colours.
- Only these colours: white, Waterloo `#536872` (hover `#435661`), Cyberspace `#44484d`, Ink `#33363a`, Oyster `#e2ddd0` (top bar), Oyster 25 `#f5f3ec` (zebra rows), Slate `#6c7176`, selected tint `#e6ebed`, cool line `#c3cbce`, warm line `#d3ccbc` (under the top bar only), focus `#7f96a0`, and the one error red (`--error`). **Never Debonair as text, never Sun, never green, amber, purple or teal.** Meaning comes from words ("Yours", "Class", "Out of service"), not colour.
- Type: Cinzel for the title, buttons, labels, chips and the menu (uppercase and spaced for buttons, labels and menu); EB Garamond for reading. Not Figtree.
- Shape: buttons 2px, form boxes 4px (Waterloo edge), cards 6px. Chips are square. All text on Waterloo is white.
- Buttons: `club-button` is the main one (Waterloo), `club-button-quiet` is the outline, `club-button-danger` is the error red; inside the band they draw themselves white and white-outline; inside `club-card-highlight` (one per screen, solid Waterloo) the button is white.
- A test (`club-app-look.spec.ts`) reads every colour the browser draws on each converted screen and fails on any outside this list. Add a new screen to its list when you convert it.

**Public site and sign-in: the Oct 29 refresh.**
- **Paper and ink:** warm off-white paper, dark ink text. Lake-club greys (Waterloo, Debonair, Oyster, hairline).
- **Sun (`--sun`):** the bright accent. It is the primary CTA fill (ink text on Sun). Do not use Sun as body text on paper.
- **Type:** Cinzel (`--display`) for headings; EB Garamond (`--body`) for reading; Figtree (`--ui`) for buttons, labels, forms, kickers.
- **Shape:** soft cards (`--radius-card` / `--radius-card-lg`), light shadows (`--shadow-xs` / `--shadow-md`), pill primary actions (`--radius-pill`).
- **Phone first:** min tap ~44px (public primary often 48–52px); stack on narrow screens; no sideways scroll at 375px.

## UX habits (front desk, not SaaS)

- **One job per screen.** One clear primary action. Secondary links stay quiet (`club-quiet-links`, ghost/quiet buttons).
- **Plain English.** Refusals and confirmations are full sentences (“You can book up to 7 days ahead…”), never bare error codes.
- **Say what happened.** Success and cancel notes in words members understand.
- **Cards sparingly.** Use a card when it groups a choice or a record. Do not wrap every paragraph in a card for decoration.
- **Staff boards:** today’s pulse and real decisions first (damage, waitlists, out of service). Do not make missed boat check-ins a front-desk chase list — that lives under Reservation attendance.
- **Risky staff changes:** preview → confirm (import, resignations, end membership).
- **iPad / big taps:** one obvious button; auto-return to start after idle where that pattern already exists.

## Public vs member

| Surface | Path | Chrome |
|--------|------|--------|
| Public / marketing | `/site`, homepage refresh | `ds-*` header, footer, Sun CTA, hero budget (brand + one headline + one short line + CTA + dominant image) |
| Member & staff | `/club` (inside `(member)`) | Oyster top bar (`MemberNav`), Waterloo title band (`PageBand`), Waterloo buttons, white cards, functional density OK if still clear |
| Sign-in, iPads, test landing page | `/club/sign-in`, `/club/ipad`, `/club/snacks`, `/club/start` | Their own layouts and looks; not inside `.club-app` |

Public pages never show the bar, Happy Hour, drinks, access codes, or staff phone numbers. Only the main club line (206) 622-0624.

## Words on screen

- Household / lease / front desk / rent ledger metaphors are fine in explanations to Grant; on screen prefer everyday club words (booking, class, place, waiting list, bill).
- Invented names only in sample data.
- Placeholder rules stay visibly marked as placeholders until staff confirm real numbers.

## Anti-patterns

- Purple gradients, glassmorphism, emoji as UI, dark mode for club/site.
- New hex or font stacks outside `globals.css` (public site) or the package palette in `club-app.css` (members and staff).
- Figtree, Sun, pills or soft 16px corners on a members' or staff screen.
- Dashboard-style KPI walls on member home or staff office without Grant asking.
- Copying iCrew chrome or Wix leftover clutter into new screens.
- Changing shared tokens in a way that breaks the dashboard without an explicit ask.

## Done check

- Matches existing neighbouring pages more than a generic AI template.
- Works at phone width; primary control is easy to tap.
- Copy reads like a person at the front desk wrote it.
---

# Optional: how Grant talks about design

When proposing layout options, prefer short multiple choice with a recommended first option. Prefer sketches (canvas) for “what could the board look like,” then implement only after Grant picks.