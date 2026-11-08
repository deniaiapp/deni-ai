# @deniai/i18n

Locale configuration and message extraction shared by the Deni AI apps.

| Export                         | What it is                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@deniai/i18n/locales`         | `locales` (`en`, `ja`), `AppLocale`, `defaultLocale`. The web app and the help center (`apps/support`) both use this list. |
| `@deniai/i18n/accept-language` | `getPreferredLocaleFromHeader()`: q-value aware Accept-Language negotiation.                                               |
| `@deniai/i18n/extracted`       | `getExtracted(intl)` for inline messages outside React (route `head`, loaders, server code) and its compile target.        |
| `@deniai/i18n/vite`            | `extractMessages()` Vite plugin.                                                                                           |

## Message extraction

`extractMessages({ srcPath, messagesPath, sourceLocale, locales })` compiles
`useExtracted()` (use-intl) and `getExtracted()` calls under `srcPath` to catalog
keys with next-intl's SWC extractor, and keeps `<messagesPath>/<locale>.json` in
sync on `vite build` and on every save in `vite dev`: the source locale is
rewritten from source code, other locales keep their translations, gain `""` for
new messages and drop unused ones. `writeCatalogs: false` only compiles (tests).

Catalogs belong to the app: `apps/web/messages/*.json`. The plugin needs
`@swc/core` and `next-intl-swc-plugin-extractor` (optional peers; apps/web
provides them as dev dependencies), so `@deniai/i18n/locales` stays light for
apps that only need the locale list.

Scripts: `typecheck`, `lint`, `format`, `format:check`, `test` (vitest).
