import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function loadEnvFile(file, override) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}

await loadEnvFile(".env", false);
await loadEnvFile(".env.local", true);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { prepare: false });
try {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.unsafe(await readFile(path.join(dir, file), "utf8"));
    console.log(`Applied ${file}`);
  }
  console.log("Database schema is ready.");
} finally {
  await sql.end({ timeout: 5 });
}
