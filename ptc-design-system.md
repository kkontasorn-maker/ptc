# NIS PTC — Design System

Companion to `ptc-schema-api-spec.md`. Captures the visual rules
established across the mockup review process, so Codex/Cursor apply them
consistently on every remaining screen instead of re-deriving them each
time.

## Core principle

**Red is reserved for the one thing on a screen that's actionable or
needs attention. Everything else is neutral.** Don't spread red across
multiple elements doing the same job — if three things are red, none of
them stand out, and the screen starts reading as one continuous alert
instead of a calm interface. Default to white/neutral/gray; add red
deliberately, one place at a time.

## Colors

| Token | Hex | Use |
|---|---|---|
| `primary` | `#8C0E06` | Primary buttons, active nav accents, the ONE status pill that needs attention, icon accents on the single actionable stat card |
| `primary-tint-bg` | `#FCEBEB` | Background for the one red-tinted pill/badge (e.g. "Upcoming" status, "Cancelled" status) — never the whole card |
| `primary-tint-text` | `#791F1F` | Text color paired with `primary-tint-bg` |
| `success-bg` | `#EAF3DE` | Background for confirmation/success icon badges |
| `success-text` | `#3B6D11` | Icon/text color paired with `success-bg` — used for "booking confirmed," never for red's job |
| `surface-page` | light neutral gray | Page background |
| `surface-card` | `#FFFFFF` | Card/panel background |
| `border` | thin neutral gray (~0.5px) | Default card/row borders and hairline dividers |
| `border-strong` | slightly darker neutral gray | Input borders, outline-button borders |
| `text-primary` | dark gray/near-black | Headings, primary data values — never colored |
| `text-secondary` | `#64676A` (Pantone Cool Gray 10C) | Labels, body copy |
| `text-muted` | lighter neutral gray | Placeholder/disabled text, helper captions |
| `blue` (tertiary) | `#225085` | Reserved, sparingly, for informational states only — not used in any mockup so far; don't reach for it by default |

Bright Red (`#E62125`, Pantone Bright Red) and Cool Gray 4C (`#BCBCBC`)
are in the official NIS palette but haven't been needed in any screen so
far — the tinted-red pair above covers "needs attention" without a second,
more saturated red competing with the primary brand red. Don't introduce
Bright Red unless a genuinely more urgent state shows up (e.g. a
destructive confirmation) that dark red doesn't adequately distinguish.

## Component rules

- **Primary button**: solid `primary` fill, white text. One per screen,
  reserved for the main action (Create, Continue, Verify, Save).
- **Secondary button**: transparent fill, `border-strong` outline,
  `text-primary` text. Everything that isn't the main action.
- **Cards**: `surface-card` background, thin `border`, consistent
  rounded corners across the whole app. Every card-like element (stat
  cards, list rows, form panels) gets the same border treatment so
  nothing floats borderless against the page background.
- **Data rows** (label/value pairs): `text-secondary` label,
  `text-primary` value, normal weight — never bold, never colored, even
  when the data is "important." Separated by thin hairline dividers, not
  boxes.
- **Status pills**: `surface-page` background + `text-secondary` text by
  default (Past, Draft, Confirmed). Only the one status that needs
  attention gets `primary-tint-bg`/`primary-tint-text` (Upcoming,
  Cancelled). Never more than one pill style per screen carries color.
- **Icon badges** (stat cards, list items): neutral gray badge by
  default; `primary-tint-bg` badge only for the single actionable item
  in a group of similar items (e.g. "Upcoming" among Upcoming/Draft/Past).
- **Success states**: green (`success-bg`/`success-text`), not red — red
  already carries "action needed" meaning elsewhere in the system, so
  reusing it for "this succeeded" creates a contradiction.
- **Disabled/unavailable items** (booked slots, locked bookings): muted
  gray text, strikethrough where applicable, non-interactive — no color,
  just reduced visual weight.
- **Calendar "break" blocks**: diagonal hatch pattern + dashed border,
  no fill color — distinct from both bookings and open slots without
  needing a third color.
- **Locked/cutoff-passed state**: a quiet row with a lock icon + muted
  gray text explaining why (e.g. "Changes closed 14 Oct 2026 at 17:00"),
  not a red alert banner. It's informational, not an error.
- **Active navigation item**: light `primary-tint-bg` background, 3px
  `primary` left border, `primary` icon + text. Inactive items stay
  plain gray, no background.

## What NOT to do

- Don't fill borders, backgrounds, or body text in red "for emphasis" —
  emphasis comes from being the *only* colored thing on the screen, not
  from saturation.
- Don't repeat the same red treatment on more than one element in a
  list/group (e.g. every date badge, every status pill) — pick the one
  that matters.
- Don't use red for a success/confirmation state — that's green's job.
- Don't introduce a new color for a new state before checking whether an
  existing neutral treatment (strikethrough, hatch pattern, muted text)
  already solves it without adding color.
