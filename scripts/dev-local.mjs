// Runs `vite dev` against the local SQLite file (.deni/local.sqlite) even when .env.local
// points D1_PROXY_URL at a remote D1. Empty values win over .env files, which never
// override variables that are already set. Pending migrations apply on the first query.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteBin = fileURLToPath(new URL("../../bin/vite.js", import.meta.resolve("vite")));
const child = spawn(process.execPath, [viteBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, D1_PROXY_URL: "", D1_PROXY_TOKEN: "" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
