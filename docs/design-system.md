# Deni AI design system

The signed-in app (chat, Run, settings, auth) uses one set of tokens: neutral
grey surfaces, with colour kept for status and for the usage bar. Tokens live in
`apps/web/src/styles/globals.css`; components in `packages/ui` read them. An
indigo system ("Aizome") with a per-browser switch back to the neutral look
existed during the v8 beta; the neutral look is now the only one.

## Subject and direction

Deni AI is a multi-model chat (GPT, Claude, Gemini and others), a model
comparison tool and an agent runner (Deni Run), used heavily in Japanese and
English, by students and developers who keep it open all day. The screen is a
reading and writing surface first: long answers, code, tables. Surfaces stay
neutral so the content and the few coloured signals stand out.

## Colour roles

All values are OKLCH, with no hue in the neutrals.
`src/styles/design-tokens.test.ts` checks the text pairs that reach 4.5:1 in
both modes. The palette does not reach it everywhere: `destructive-foreground` on
`destructive` in dark mode is below (buttons use `buttonVariants`'s
`destructive` variant, which uses white text on `destructive/60` in dark mode),
and `input` / `ring` are not 3:1 against the page.

| Role                 | Light                | Dark                  | Use                              |
| -------------------- | -------------------- | --------------------- | -------------------------------- |
| `background`         | `1 0 0`              | `0.145 0 0`           | Page and conversation surface    |
| `foreground`         | `0.145 0 0`          | `0.985 0 0`           | Body text                        |
| `card` / `popover`   | `1 0 0`              | `0.205 0 0`           | Grouped content, menus, dialogs  |
| `primary`            | `0.205 0 0`          | `0.922 0 0`           | Primary actions                  |
| `secondary`          | `0.97 0 0`           | `0.269 0 0`           | Secondary buttons, user bubble   |
| `muted` / `muted-fg` | `0.97` / `0.52`      | `0.269` / `0.708`     | Quiet fills, secondary text      |
| `accent`             | `0.97 0 0`           | `0.269 0 0`           | Hover and pressed fills          |
| `highlight`          | `0.97 0 0`           | `0.269 0 0`           | Same as `accent`                 |
| `destructive`        | `0.577 0.245 27.325` | `0.704 0.191 22.216`  | Destructive actions and errors   |
| `success`            | `0.52 0.13 150`      | `0.72 0.15 150`       | Confirmations, healthy status    |
| `border` / `input`   | `0.922` / `0.922`    | white 10% / white 15% | Hairlines / field fills          |
| `ring`               | `0.708 0 0`          | `0.556 0 0`           | Focus ring                       |
| `sidebar`            | `0.985 0 0`          | `0.205 0 0`           | The sidebar and the frame        |

Chart series (`chart-1..5`) are greys. Code highlighting keeps its own palette.
Offers, Max Mode and status use Tailwind palette colours (amber, emerald, sky,
blue) directly.

The usage pool bar (`components/billing/product-usage.tsx`) has its own
`usage-chat` (indigo), `usage-flixa` (yellow), `usage-run` (teal) and
`usage-track` tokens, because the grey chart series cannot be told apart on a
grey track. Theme presets do not change them.

## Typography

**Inter Variable with the optical-size axis**
(`@fontsource-variable/inter/opsz.css`) for everything except code;
**JetBrains Mono Variable** is for code only, never for labels. Body text
(`p`, `div`) is medium weight with tight tracking (`-0.02em` on `body`,
`tracking-tight` on text blocks); `h1` / `h2` are semibold, `h3`–`h6` medium.
The Mono preset resets tracking.

Rules: sentence case everywhere; no all-caps eyebrows; numbers in usage and
billing use `tabular-nums`. Line length for prose stays under ~80 characters
(`max-w-[46rem]`).

## Spacing, layout and grid

4px base (`--spacing: 0.25rem`). Rhythm inside the sheet uses 4 / 8 / 12 / 16
/ 24 / 32 / 48.

```
┌─frame─────────────────────────────────────────────────────────────┐
│ ┌sidebar─────┐ ┌sheet (16px top-left radius)──────────────────────┐ │
│ │ Deni AI    │ │ header bar: trigger · page title · actions       │ │
│ │ [Chat|Run] │ │                                                  │ │
│ │ + New chat │ │      reading column 46rem, left edge aligned     │ │
│ │ Search  ⌘K │ │      with the composer                           │ │
│ │ Compare    │ │                                                  │ │
│ │ Projects   │ │                                                  │ │
│ │ ── chats ──│ │      ┌composer────────────────────────────────┐  │ │
│ │ …          │ │      └────────────────────────────────────────┘  │ │
│ │ account    │ └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- Desktop (≥ 768px): shadcn `inset` sidebar. The frame (8px) and the sidebar
  share the `sidebar` colour; the sheet floats inside it with a 16px radius.
- Mobile (< 768px): the sheet is full-bleed (no frame), the sidebar is a drawer,
  and the header bar is sticky with the trigger on the left.
- Reading column: `max-w-[46rem]`, centred in the sheet, text left-aligned.
- Settings: `SettingsLayout` gives a vertical section nav (left, 14rem) and the
  page (right, max 52rem). Each `PageSection` is a row: title and description in
  a narrow column, controls in the wide one; rows are separated by hairlines,
  not boxed in cards. Below 1024px the nav becomes a horizontal scroller.

## Radii

Radius follows nesting depth rather than one value everywhere:

| Token             | Value          | Use                           |
| ----------------- | -------------- | ----------------------------- |
| `--radius-sheet`  | 16px           | The app sheet                 |
| `--radius-card`   | `radius × 2.6` | Cards, panels, plan cards     |
| `--radius-menu`   | `radius + 8px` | Popovers, menus, select lists |
| `--radius-dialog` | `radius × 2.6` | Dialogs and sheets            |
| `--radius-field`  | `radius × 2.2` | Inputs, selects, textareas    |
| `--radius-button` | `radius × 2.6` | Buttons                       |
| `--radius-badge`  | `radius × 2.2` | Badges, status chips          |

`--radius` is 0.625rem and theme presets change it, so these are declared on
`body`, where the presets apply.

Utilities: `rounded-card`, `rounded-menu`, `rounded-dialog`, `rounded-field`,
`rounded-button`, `rounded-badge`, `rounded-sheet`.

## Elevation

Hairlines first; shadows are neutral black and small. Cards carry `shadow-md`
and a faint ring, menus and popovers `shadow-lg`, dialogs `shadow-xl`.

## Motion

Durations 120ms (hover, press), 180ms (menus, accordions), 240ms (dialogs,
drawer). Easing `cubic-bezier(0.2, 0, 0, 1)` (`--ease-out-quint`). Motion only
answers an action: no idle animation, no staggered entrances. The single
orchestrated moment is the chat home greeting fading in once. Everything
respects `prefers-reduced-motion` (global override in `globals.css`).

## Component principles

- Buttons: `default` is the solid `primary`; `secondary` a grey fill; `outline`
  a 1px border; `ghost` for toolbars. Height 36 (default), 32 (`sm`), 28
  (`xs`). Focus is a 3px `ring`.
- Fields: a filled `input/50` surface without a visible border. Invalid state
  adds `destructive` border and message.
- Cards are for grouped objects (a plan, a key, a project), not for wrapping a
  whole page. Pages use `PageHeader` + `PageSection`.
- Messages: the user's turn is a `secondary` bubble aligned right; the
  assistant's turn is unboxed prose on the sheet, so long answers read like a
  document. Tool calls, approvals and artifacts are bordered blocks with a
  title row.
- Active navigation uses the `sidebar-accent` / `secondary` fill.
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

Layouts introduced with v8 (the shell frame and `AppHeader`, `SettingsLayout`
with `PageHeader` on every settings page, `/account/*` inside the app shell,
the split auth layout, the required two-factor setup screen, the public pages)
are the only layouts; they take the tokens above.

## Theme presets

Appearance settings offers colour themes (T3 Chat, Tangerine, Mono, Deep
Dark…): `src/styles/themes.css` redefines the tokens on a `body` class that
`src/hooks/use-theme-preset.tsx` sets. `default` is the palette above.
