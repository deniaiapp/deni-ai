import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { e2eDatabaseUrl } from "./env";

const dbPackageDir = fileURLToPath(new URL("../../../packages/db/", import.meta.url));

/** Brings the end-to-end database up to the repository's migrations before the run. */
export default function globalSetup() {
  execFileSync(process.execPath, ["./node_modules/drizzle-kit/bin.cjs", "migrate"], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
    stdio: "inherit",
  });
}
