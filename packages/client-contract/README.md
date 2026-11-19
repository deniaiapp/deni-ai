# @deniai/client-contract

Zod schemas, TypeScript types and a JSON Schema of the native client API
(`/api/client/v1`), which Deni AI Desktop uses. The web app's handlers
(`apps/web/src/server/http/client-v1/router.ts`) build their responses from
these types; the Rust client generates its types from
`schema/client-api-v1.json` (`typify`).

| Export                                                                                                      | What it is                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CLIENT_API_BASE_PATH`, `CLIENT_HEADER`, `parseClientHeader()`, `formatClientHeader()`, `compareVersions()` | Client identification: every request sends `x-deni-client: desktop/<semver> (<os>; <arch>)` |
| `CLIENT_ERROR_CODES`, `clientErrorSchema`                                                                   | The error body of every non-2xx response: `{ error, code, message }`                        |
| `bootstrapResponseSchema`                                                                                   | `GET /bootstrap`                                                                            |
| `modelsResponseSchema`                                                                                      | `GET /models`                                                                               |
| `chatListQuerySchema`, `chatListResponseSchema`                                                             | `GET /chats?limit=&cursor=`                                                                 |
| `createChatBodySchema`, `chatDetailSchema`                                                                  | `POST /chats`, `GET /chats/:id`, `PATCH /chats/:id` (returns the chat)                      |
| `olderMessagesQuerySchema`, `messageWindowSchema`                                                           | `GET /chats/:id/messages?before=&limit=`                                                    |
| `chatStatusSchema`                                                                                          | `GET /chats/:id/status`                                                                     |
| `updateChatBodySchema`                                                                                      | `PATCH /chats/:id`                                                                          |
| `preferredModelBodySchema`                                                                                  | `PUT /preferences/model`                                                                    |
| `clientApiJsonSchema()`, `CLIENT_API_SCHEMAS`                                                               | The JSON Schema document written to `schema/client-api-v1.json`                             |

`DELETE /chats/:id` answers 204. Sending (`POST /api/chat`, the AI SDK UI
message stream), stopping (`POST /api/chat/stop`) and attachments
(`POST /api/upload-attachment`, `GET /api/attachments/:id`) are the web app's
existing endpoints; they accept the same credential.

## Credentials

An access token from the Deni AI OAuth provider, sent as
`Authorization: Bearer <token>`. The desktop client is a public native client
(no secret, PKCE, loopback redirect, RFC 8252), registered with
`pnpm --filter @deniai/web tools:register-oauth-client --native`, and asks for
`profile email offline_access chat`. Only tokens that carry the `chat` scope,
issued to a client registered with that scope, are accepted
(`apps/web/src/lib/request-session.server.ts`). The browser session works too,
which is handy for trying endpoints by hand.

## Compatibility

- Objects in the JSON Schema are open: clients must ignore fields they do not
  know, so the server can add fields without a new version.
- Removing or renaming a field, or changing its meaning, needs `/api/client/v2`.
- `DESKTOP_MIN_CLIENT_VERSION` (web app env) retires old clients: they get 426
  `client_update_required`, while `GET /bootstrap` still answers with
  `client.updateRequired: true` so the client can explain.

## Scripts

`schema` (regenerate `schema/client-api-v1.json`; the test fails while the
committed file is stale), `typecheck`, `lint`, `format`, `format:check`, `test`.
