/**
 * Writes schema/client-api-v1.json, the JSON Schema the Rust client (Deni AI
 * Desktop) generates its types from. Run after changing a schema:
 *
 *   pnpm --filter @deniai/client-contract schema
 *
 * `src/contract.test.ts` fails while the committed file is out of date.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { clientApiJsonSchema } from "../src/json-schema.js";

const out = fileURLToPath(new URL("../schema/client-api-v1.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(clientApiJsonSchema(), null, 2)}\n`);
console.info(`wrote ${out}`);
