# @deniai/emails

Transactional email templates for Deni AI, written with
[react-email](https://react.email), plus the render helper that turns a template
into HTML and plain text.

- Each template is a subpath: `import("@deniai/emails/magic-link-email")`.
  Import templates lazily where the email is sent, because react-email is large.
- `@deniai/emails/render` exports `renderEmail(element)` →
  `{ html, text }`; react-email is loaded on the first render.
- `@deniai/emails/org-invitation-email-subject` holds the subject builder that
  the auth server uses without loading a template.

Copy is English-only inline text (the templates do not use use-intl). Sending
(Cloudflare Email Sending, env, placeholder-address filtering) stays in the web
app: `apps/web/src/lib/email.ts`.

Scripts: `typecheck`, `lint`, `format`, `format:check`, `test` (vitest).
