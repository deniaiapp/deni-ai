// Runs `vinext dev` against the local SQLite file (.deni/local.sqlite) even when .env.local
// points D1_PROXY_URL at a remote D1. Empty values win over .env files, which never
// override variables that are already set. Pending migrations apply on the first query.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// vinext does not export its CLI, so resolve it next to the package entry.
const vinextBin = fileURLToPath(new URL("./cli.js", import.meta.resolve("vinext")));
const child = spawn(process.execPath, [vinextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, D1_PROXY_URL: "", D1_PROXY_TOKEN: "" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
