import {
  banUserFromFlixa,
  banUserFromFlixaByEmail,
  closeDeniPool,
} from "../utils/deni";

const SCRIPT_TIMEOUT_MS = 30_000;
const DEFAULT_REASON = "manual";

function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx tools/ban-flixa-user.ts --email <email> [--reason <reason>]
  pnpm exec tsx tools/ban-flixa-user.ts --user-id <userId> [--reason <reason>]
  pnpm run tools:ban-flixa-user -- --email <email> [--reason <reason>]

Manually bans a Deni AI user from Flixa and revokes all of their API keys.
Default reason is "${DEFAULT_REASON}".

Requires DENI_DATABASE_URL.
`);
}

type ParsedArgs =
  | { ok: true; mode: "email"; email: string; reason: string }
  | { ok: true; mode: "userId"; userId: string; reason: string }
  | { ok: false; help: boolean };

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    return { ok: false, help: args.includes("-h") || args.includes("--help") };
  }

  let email: string | undefined;
  let userId: string | undefined;
  let reason = DEFAULT_REASON;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];

    if (arg === "--email" || arg === "-e") {
      if (!next || next.startsWith("-")) {
        return { ok: false, help: false };
      }
      email = next.trim();
      i++;
      continue;
    }

    if (arg === "--user-id" || arg === "--userId" || arg === "-u") {
      if (!next || next.startsWith("-")) {
        return { ok: false, help: false };
      }
      userId = next.trim();
      i++;
      continue;
    }

    if (arg === "--reason" || arg === "-r") {
      if (!next || next.startsWith("-")) {
        return { ok: false, help: false };
      }
      reason = next.trim() || DEFAULT_REASON;
      i++;
      continue;
    }

    // Positional email for convenience: ban-flixa-user.ts user@example.com
    if (!arg.startsWith("-") && !email && !userId) {
      email = arg.trim();
      continue;
    }

    return { ok: false, help: false };
  }

  if (email && userId) {
    console.error("Specify either --email or --user-id, not both.");
    return { ok: false, help: false };
  }

  if (email) {
    return { ok: true, mode: "email", email, reason };
  }
  if (userId) {
    return { ok: true, mode: "userId", userId, reason };
  }

  return { ok: false, help: false };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) {
    printUsage();
    process.exitCode = parsed.help ? 0 : 1;
    return;
  }

  const auditHeaders = {
    source: "tools/ban-flixa-user.ts",
  };

  if (parsed.mode === "email") {
    const result = await banUserFromFlixaByEmail(
      parsed.email,
      parsed.reason,
      auditHeaders,
    );
    if (!result.banned) {
      console.error(`Failed to ban: ${result.error}`);
      process.exitCode = 1;
      return;
    }

    if (result.alreadyBanned) {
      console.log(
        `Already banned email=${result.email} userId=${result.userId} ` +
          `reason=${result.reason} (API keys re-revoked).`,
      );
    } else {
      console.log(
        `Banned email=${result.email} userId=${result.userId} ` +
          `reason=${result.reason}. All API keys revoked.`,
      );
    }
    return;
  }

  const result = await banUserFromFlixa(
    parsed.userId,
    parsed.reason,
    auditHeaders,
  );
  if (!result.banned) {
    console.error(`Failed to ban: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (result.alreadyBanned) {
    console.log(
      `Already banned userId=${parsed.userId} reason=${parsed.reason} ` +
        `(API keys re-revoked).`,
    );
  } else {
    console.log(
      `Banned userId=${parsed.userId} reason=${parsed.reason}. ` +
        `All API keys revoked.`,
    );
  }
}

const timeout = setTimeout(() => {
  console.error(
    `Timed out after ${SCRIPT_TIMEOUT_MS}ms while banning Flixa user.`,
  );
  process.exit(1);
}, SCRIPT_TIMEOUT_MS);

try {
  await main();
} catch (error) {
  console.error("Failed to ban Flixa user:", error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await closeDeniPool();
}
