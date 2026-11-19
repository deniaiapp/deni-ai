# Security Policy

## Supported versions

Security fixes are applied to the actively developed branches of this repository (`canary` and the current `master` release line). Self-hosted deployments should stay up to date with the latest released changes.

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately to:

**[security@deniai.app](mailto:security@deniai.app)**

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

### What to include

- Description of the issue and impact
- Steps to reproduce or a proof of concept (if available)
- Affected component (e.g. auth, API, chat tools, billing)
- Your preferred contact method for follow-up

### What to expect

We will acknowledge the report as soon as possible, investigate, and work with you on a fix and coordinated disclosure when appropriate.

Thank you for helping keep Deni AI and its users safe.

## Scope notes for researchers

In scope examples:

- Authentication / session issues
- Authorization bypasses involving user, team, or retained legacy share data
- Injection, XSS, SSRF (including chat tools that fetch remote URLs)
- Secrets exposure or unsafe handling of API keys, including credentials retained from the retired BYOK feature
- Billing or usage-quota bypasses

Out of scope examples (unless they lead to a real vulnerability):

- Denial of service via volumetric traffic alone
- Issues that require physical access or already-compromised user credentials
- Reports based solely on missing non-security headers without impact
