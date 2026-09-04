import dotenv from "dotenv";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const sql = postgres(databaseUrl, { prepare: false });
  try {
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await sql.unsafe(await readFile(path.join(dir, file), "utf8"));
      console.log(`Applied ${file}`);
    }
    console.log("Database schema is ready.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
