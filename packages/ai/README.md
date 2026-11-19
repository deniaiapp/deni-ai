# @deniai/ai

Chat model catalog and provider helpers for Deni AI. Everything here is free of
app modules (database, auth, tRPC, env): configuration is passed in by the
caller.

| Export                           | What it is                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@deniai/ai/models`              | Model catalog (`models`, `defaultModel`, `ModelDefinition`), reasoning efforts, plan and guest access rules, usage tiers (from `@deniai/billing`), Pro/Fast/long-context multipliers |
| `@deniai/ai/openrouter`          | `createDeniOpenRouter(settings)`: OpenRouter provider with the Deni AI app attribution; pass `apiKey` from the caller's env                                                          |
| `@deniai/ai/reasoning`           | `stripEarlierTurnReasoning(messages)`: drops signed reasoning of earlier turns before a request                                                                                      |
| `@deniai/ai/tools/questionnaire` | The `questionnaire` chat tool (AI SDK `tool()`) and its input/output types                                                                                                           |

Model ids, tiers and access rules are product policy: change them here together
with the web app's UI copy (`apps/web/src/lib/model-description-copy.ts`).

Still in `apps/web`, because they read env or use app modules:
`src/server/http/chat/_lib/model.ts` (provider routing, usage checks),
`src/lib/chat-tools/{search,browse,fetch-page,index}.ts` (Exa key, usage
billing, the SSRF guard in `src/lib/network-security.ts`, platform
capabilities), `src/lib/model-health.ts`, `src/lib/memory.ts` and
`src/lib/token-weighting.ts` (env overrides of the `@deniai/billing` weights).

Scripts: `typecheck`, `lint`, `format`, `format:check`, `test` (vitest).
