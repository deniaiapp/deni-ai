import { closeDeniPool, unbanUserFromFlixaByEmail } from "../utils/deni";

const SCRIPT_TIMEOUT_MS = 30_000;

function printUsage(): void {
  console.log(`Usage:
  bun run tools/unban-flixa-user.ts <email>
  bun run tools:unban-flixa-user -- <email>

Removes the Flixa ban for the Deni AI user with the given email.
API keys are not restored — the user must log in again to issue a new key.

Requires DENI_DATABASE_URL.
`);
}

function parseEmail(argv: string[]): string | null {
  const args = argv.filter((arg) => arg !== "--");
  // bun run tools/unban-flixa-user.ts user@example.com
  // or: bun run tools:unban-flixa-user -- user@example.com
  const email = args[0]?.trim();
  if (!email || email === "-h" || email === "--help") {
    return null;
  }
  return email;
}

async function main(): Promise<void> {
  // Bun.argv: [bun, script, ...args]
  const rawArgs = Bun.argv.slice(2);
  const wantsHelp = rawArgs.some((arg) => arg === "-h" || arg === "--help");
  const email = parseEmail(rawArgs);
  if (!email) {
    printUsage();
    process.exitCode = wantsHelp ? 0 : 1;
    return;
  }

  const result = await unbanUserFromFlixaByEmail(email);
  if (!result.unbanned) {
    console.error(`Failed to unban: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (result.wasBanned) {
    console.log(
      `Unbanned user email=${result.email} userId=${result.userId}. ` +
        `They must log in to Deni AI again to create a new API key.`,
    );
  } else {
    console.log(
      `No active Flixa ban for email=${result.email} userId=${result.userId} ` +
        `(nothing to remove).`,
    );
  }
}

const timeout = setTimeout(() => {
  console.error(
    `Timed out after ${SCRIPT_TIMEOUT_MS}ms while unbanning Flixa user.`,
  );
  process.exit(1);
}, SCRIPT_TIMEOUT_MS);

try {
  await main();
} catch (error) {
  console.error("Failed to unban Flixa user:", error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await closeDeniPool();
}
