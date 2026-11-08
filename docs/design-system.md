# Deni AI design system ("Aizome")

The signed-in app (chat, Run, settings, auth) uses this system when the `ui`
preference is `next` (the default). `legacy` keeps the previous neutral tokens;
see [UI preference](#ui-preference-next--legacy). Tokens live in
`apps/web/src/styles/globals.css`; components in `packages/ui` read them.

## Subject and direction

Deni AI is a multi-model chat (GPT, Claude, Gemini and others), a model
comparison tool and an agent runner (Deni Run), used heavily in Japanese and
English, by students and developers who keep it open all day. The screen is a
reading and writing surface first: long answers, code, tables.

The name gives the direction. _Ai_ (藍) is indigo, the dye of aizome cloth.
The app is framed in a deep indigo band (the sidebar and the frame around the
page) holding a cool, paper-white sheet where the conversation happens. The
indigo frame is the one bold element; everything on the sheet stays quiet,
legible and dense enough for work. A turmeric yellow (_ukon_), the traditional
partner of indigo in Japanese textiles, marks the few things that are "on":
the current chat, the active mode, Max Mode.

What it deliberately is not: a neutral grey shadcn kit, a black canvas with one
neon accent, or a grid of identical soft-shadow cards.

## Colour roles

All values are OKLCH. Hue 272 (indigo) tints every neutral, so greys never read
as dead grey. Contrast targets: body text and muted text ≥ 4.5:1 on the
surfaces they sit on, UI boundaries that carry meaning (inputs, focus) ≥ 3:1.
`src/styles/design-tokens.test.ts` checks the pairs below in both modes.

| Role                     | Light                      | Dark                        | Use                                      |
| ------------------------ | -------------------------- | --------------------------- | ---------------------------------------- |
| `background` (paper)     | `0.975 0.006 272`          | `0.185 0.03 272`            | The sheet: page and conversation surface |
| `foreground` (sumi ink)  | `0.22 0.045 272`           | `0.94 0.012 272`            | Body text                                |
| `card`                   | `0.995 0.002 272`          | `0.215 0.034 272`           | Grouped content on the sheet             |
| `popover`                | `1 0 0`                    | `0.235 0.036 272`           | Menus, popovers, dialogs                 |
| `primary` (ai)           | `0.42 0.15 272`            | `0.78 0.1 272`              | Primary actions, links, selection        |
| `secondary` (kamenozoki) | `0.935 0.022 272`          | `0.27 0.045 272`            | Secondary buttons, user message bubble   |
| `muted` / `muted-fg`     | `0.95 0.012` / `0.47 0.04` | `0.245 0.034` / `0.73 0.03` | Quiet fills, secondary text              |
| `accent`                 | `0.93 0.026 272`           | `0.29 0.05 272`             | Hover and pressed fills                  |
| `highlight` (ukon)       | `0.8 0.15 78`              | `0.83 0.14 80`              | "On" markers; always with ink text       |
| `destructive`            | `0.53 0.2 25`              | `0.7 0.17 25`               | Destructive actions and errors           |
| `success`                | `0.5 0.12 160`             | `0.75 0.13 160`             | Confirmations, healthy status            |
| `border` / `input`       | `0.89 0.016` / `0.8 0.03`  | `0.31 0.04` / `0.42 0.05`   | Hairlines / field outlines               |
| `ring`                   | `0.5 0.17 272`             | `0.76 0.12 272`             | Focus outline                            |
| `sidebar` (kachi-iro)    | `0.27 0.09 272`            | `0.14 0.03 272`             | The indigo frame                         |
| `sidebar-foreground`     | `0.96 0.012 272`           | `0.9 0.015 272`             | Text on the frame                        |

The sidebar is an inverted island: inside `[data-slot="sidebar"]` the generic
roles (`foreground`, `muted-foreground`, `accent`, `border`, `primary`, …) are
remapped to on-indigo values, so components that use semantic classes (the Run
sidebar, menus rendered in place) stay readable without knowing they sit on
indigo. Portaled popovers use the normal roles.

Chart series (`chart-1..5`): indigo, ukon, a teal, a rose and a slate, ordered
for colour-vision separation. Code highlighting keeps its own palette.

## Typography

One family, used with intent: **Inter Variable with the optical-size axis**
(`@fontsource-variable/inter/opsz.css`, already a dependency). Large sizes get
Inter Display's tighter forms automatically, so headings feel drawn rather than
scaled-up UI text. Character variants `cv11` (single-storey a) and `ss01`
(open digits) give the text a rounder, more handwritten texture than default
Inter. **JetBrains Mono Variable** is for code only, never for labels.
Japanese falls back to Hiragino Sans / Noto Sans JP / Yu Gothic UI with a
looser line height (`:lang(ja)`).

Scale (Tailwind steps, 15px reading base, 14px UI base):

| Token         | Size / line height | Weight | Tracking | Use                                |
| ------------- | ------------------ | ------ | -------- | ---------------------------------- |
| `text-xs`     | 12 / 16            | 500    | 0        | Meta, counters, badges             |
| `text-sm`     | 14 / 20            | 400    | -0.006em | UI text, buttons, menus            |
| `text-[15px]` | 15 / 24            | 400    | -0.006em | Message prose (assistant and user) |
| `text-base`   | 16 / 26            | 400    | -0.011em | Long-form descriptions             |
| `text-lg`     | 18 / 28            | 600    | -0.018em | Section titles                     |
| `text-2xl`    | 24 / 32            | 600    | -0.025em | Page titles (`PageHeader`)         |
| `text-4xl`    | 36 / 40            | 600    | -0.035em | The chat home greeting only        |

Rules: sentence case everywhere; no all-caps eyebrows; weight, not colour,
separates heading levels; numbers in usage and billing use `tabular-nums`.
Line length for prose stays under ~80 characters (`max-w-[46rem]` at 15px).

## Spacing, layout and grid

4px base (`--spacing: 0.25rem`). Rhythm inside the sheet uses 4 / 8 / 12 / 16
/ 24 / 32 / 48.

```
┌─indigo frame──────────────────────────────────────────────────────┐
│ ┌sidebar─────┐ ┌sheet (paper, 18px top-left radius)───────────────┐ │
│ │ Deni AI    │ │ header bar: trigger · page title · actions       │ │
│ │ [Chat|Run] │ │                                                  │ │
│ │ + New chat │ │      reading column 46rem, left edge aligned     │ │
│ │ Search  ⌘K │ │      with the composer                           │ │
│ │ Compare    │ │                                                  │ │
│ │ Projects   │ │                                                  │ │
│ │ ── chats ──│ │      ┌composer (floating, 20px radius)────────┐  │ │
│ │ …          │ │      └────────────────────────────────────────┘  │ │
│ │ account    │ └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- Desktop (≥ 768px): shadcn `inset` sidebar. The frame (8px) and the sidebar
  share the indigo; the sheet floats inside it with an 18px radius.
- Mobile (< 768px): the sheet is full-bleed (no frame), the sidebar is a drawer
  of the same indigo, and the header bar is sticky with the trigger on the left.
- Reading column: `max-w-[46rem]`, centred in the sheet, text left-aligned.
- Settings: `SettingsLayout` gives a vertical section nav (left, 14rem) and the
  page (right, max 52rem). Each `PageSection` is a row: title and description in
  a narrow column, controls in the wide one; rows are separated by hairlines,
  not boxed in cards. Below 1024px the nav becomes a horizontal scroller.

## Radii

Radius follows nesting depth rather than one value everywhere:

| Token             | Next | Legacy (unchanged look) | Use                           |
| ----------------- | ---- | ----------------------- | ----------------------------- |
| `--radius-sheet`  | 18px | 16px                    | The app sheet                 |
| `--radius-card`   | 14px | `radius × 2.6`          | Cards, panels, plan cards     |
| `--radius-menu`   | 12px | `radius + 8px`          | Popovers, menus, select lists |
| `--radius-dialog` | 18px | `radius × 2.6`          | Dialogs and sheets            |
| `--radius-field`  | 10px | `radius × 2.2`          | Inputs, selects, textareas    |
| `--radius-button` | 10px | `radius × 2.6`          | Buttons                       |
| `--radius-badge`  | 6px  | `radius × 2.2`          | Badges, status chips          |

Utilities: `rounded-card`, `rounded-menu`, `rounded-dialog`, `rounded-field`,
`rounded-button`, `rounded-badge`, `rounded-sheet`.

## Elevation

Hairlines first, shadows only for things that float above the sheet. Shadow
colour is indigo-tinted, never neutral black at 10%.

| Level | Token         | Use                                  |
| ----- | ------------- | ------------------------------------ |
| 0     | none + border | Cards and sections on the sheet      |
| 1     | `shadow-sm`   | The sheet on the frame, the composer |
| 2     | `shadow-lg`   | Menus, popovers, tooltips            |
| 3     | `shadow-2xl`  | Dialogs and the mobile drawer        |

## Motion

Durations 120ms (hover, press), 180ms (menus, accordions), 240ms (dialogs,
drawer). Easing `cubic-bezier(0.2, 0, 0, 1)` (`--ease-out-quint`). Motion only
answers an action: no idle animation, no staggered entrances. The single
orchestrated moment is the chat home greeting fading in once. Everything
respects `prefers-reduced-motion` (global override in `globals.css`).

## Component principles

- Buttons: `default` is solid indigo; `secondary` the pale indigo fill;
  `outline` a 1px `input` border on the sheet; `ghost` for toolbars. Height 36
  (default), 32 (`sm`), 28 (`xs`). Focus is a 2px `ring` outline with offset.
- Fields: 1px `input` border on `background`, not a filled pill, so form
  boundaries pass 3:1. Invalid state adds `destructive` border and message.
- Cards are for grouped objects (a plan, a key, a project), not for wrapping a
  whole page. Pages use `PageHeader` + `PageSection`.
- Messages: the user's turn is a `secondary` bubble aligned right; the
  assistant's turn is unboxed prose on the sheet, so long answers read like a
  document. Tool calls, approvals and artifacts are bordered blocks with a
  title row; approvals add an `highlight` left edge because they wait for you.
- Active navigation uses a 3px `highlight` bar on the leading edge plus the
  `sidebar-accent` fill, so state never depends on colour alone.
- Icons: lucide at 16px in UI, 14px in dense rows; stroke 1.75.

## Layout primitives (`@deniai/ui`)

- `PageHeader` (`components/page-header`): title, optional description,
  actions; `PageHeaderTitle`, `PageHeaderDescription`, `PageHeaderActions`.
- `PageSection` (`components/page-section`): a settings row (title +
  description + content), with a `stacked` variant for full-width content.
- `SettingsLayout` (`components/settings-layout`): section nav + content, with
  `SettingsNav`, `SettingsNavItem`, `SettingsNavFooter` and `SettingsContent`.
- `AppHeader` (`components/app-header`): the sticky header bar of the sheet.

## Screen inventory

"Rebuilt" means a new layout or structure; "restyled" means the screen keeps its
structure and takes the new tokens, radii and type (plus targeted fixes).

| Screen                                         | State in next UI                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| App shell, sidebar, mode switch, mobile drawer | Rebuilt: inset frame, inverted sidebar, `AppHeader`                      |
| Chat home                                      | Rebuilt: left-aligned greeting, floating composer                        |
| Conversation, messages, tool/approval cards    | Restyled: 15px prose, user bubble, highlight edge on open questionnaires |
| Artifacts panel                                | Restyled (tokens)                                                        |
| Composer and model picker                      | Restyled: card surface, 20px radius, token toggles                       |
| Chat search (⌘K)                               | Restyled (tokens, dialog radius)                                         |
| Model comparison                               | Restyled: page title and description, card panes                         |
| Projects list                                  | Rebuilt on `PageHeader` (no wrapping card)                               |
| Project detail                                 | Restyled (tokens)                                                        |
| Settings frame and every sub-page              | Rebuilt frame (`SettingsLayout`, `PageHeader` on every page)             |
| Appearance                                     | Rebuilt on `PageSection` rows (with the UI switch)                       |
| Personalize, API keys, import, ads             | Restyled inside the new frame (their cards kept)                         |
| Account and security (`/account/*`)            | Rebuilt: moved into the app shell and settings frame                     |
| Billing (plans, usage, Max Mode), team pages   | Restyled: header, token accents for offers and Max Mode                  |
| Auth pages                                     | Rebuilt: split layout with the indigo panel                              |
| Two-factor setup (required)                    | New screen                                                               |
| Flixa device authorize                         | Restyled: the code as a dashed ticket, token status colours              |
| Deni Run (`/run`)                              | Not edited here; inherits tokens and the inverted sidebar                |
| Public pages (`/{-$locale}/*`)                 | Rebuilt: single-row header, short footer, one text column per page       |

## UI preference (next / legacy)

`ui` is a per-browser cookie (`deni-ui`, values `next` | `legacy`, default
`next`, one year). The root route reads it on the server and the client and
renders `<html data-ui="…">`. `globals.css` defines the next tokens on `:root`
/ `.dark` and the previous tokens on `:root[data-ui="legacy"]`; theme presets
(T3 Chat, Tangerine, Mono, Deep Dark…) are part of legacy and only apply there.
Appearance settings has the switch. Restructured layouts (the shell frame,
settings layout, auth layout, two-factor setup) exist only in their new form;
legacy changes colours, type and radii back, not the layout.
