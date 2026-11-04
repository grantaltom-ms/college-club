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
2. Member / staff UI: reuse patterns in `src/app/club/club.css` and nearby pages.
3. Public marketing / handoff UI: reuse `src/components/ds/` (`ds-` classes only).
4. Do **not** restyle the usage dashboard (`src/app/(dashboard)/`, `src/components/Nav.tsx`) unless Grant asked for that.

## Visual language

- **Paper and ink:** warm off-white paper, dark ink text. Lake-club greys (Waterloo, Debonair, Oyster, hairline). Light mode only.
- **Sun (`--sun`):** the bright accent. On the public site it is the primary CTA fill (ink text on Sun). Do not use Sun as body text on paper.
- **Type:** Cinzel (`--display`) for headings; EB Garamond (`--body`) for reading; Figtree (`--ui`) for buttons, labels, forms, kickers.
- **Shape:** soft cards (`--radius-card` / `--radius-card-lg`), light shadows (`--shadow-xs` / `--shadow-md`), pill primary actions on public (`--radius-pill`).
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
| Member & staff | `/club` | Club menu, kickers, cyberspace primary buttons, functional density OK if still clear |

Public pages never show the bar, Happy Hour, drinks, access codes, or staff phone numbers. Only the main club line (206) 622-0624.

## Words on screen

- Household / lease / front desk / rent ledger metaphors are fine in explanations to Grant; on screen prefer everyday club words (booking, class, place, waiting list, bill).
- Invented names only in sample data.
- Placeholder rules stay visibly marked as placeholders until staff confirm real numbers.

## Anti-patterns

- Purple gradients, glassmorphism, emoji as UI, dark mode for club/site.
- New hex or font stacks outside `globals.css`.
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