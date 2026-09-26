import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(root, ".env"), quiet: true });
dotenv.config({ path: path.join(root, ".env.local"), override: true, quiet: true });
const directory = path.join(root, ".deni", "postgres");
const dataDir = path.join(directory, "data");
const logFile = path.join(directory, "postgres.log");
const lockFile = path.join(directory, "start.lock");
const port = Number(process.env.LOCAL_POSTGRES_PORT || 5432);
const connectionUrl = (value) => `postgres://deni:deni@127.0.0.1:${value}/deni`;
const require = createRequire(import.meta.url);

async function binaries() {
  const platforms = { win32: "windows", darwin: "darwin", linux: "linux" };
  const name = platforms[process.platform];
  if (!name) throw new Error(`Native PostgreSQL is not available for ${process.platform}.`);
  try {
    const resolveFromPackage = createRequire(require.resolve("embedded-postgres"));
    return await import(pathToFileURL(resolveFromPackage.resolve(`@embedded-postgres/${name}-${process.arch}`)).href);
  } catch {
    throw new Error(`Install dependencies with native PostgreSQL support for ${name}-${process.arch} first (bun install or pnpm install).`);
  }
}

function run(binary, args, log = true, waitForPipes = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_MESSAGES: "C" } });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-12000);
      if (log) appendFileSync(logFile, chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    // A backgrounded postgres can inherit pg_ctl's pipes on Windows. Its exit
    // must not leave db:start waiting for those pipes to close indefinitely.
    if (!waitForPipes) child.once("exit", (code) => {
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, output });
    });
    else child.once("close", (code) => resolve({ code, output }));
  });
}

async function successful(binary, args, log = true, waitForPipes = true) {
  const result = await run(binary, args, log, waitForPipes);
  if (result.code !== 0) throw new Error(result.output.trim() || `PostgreSQL exited with code ${result.code}. See ${logFile}`);
}

async function running(bin) {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) return false;
  const result = await run(bin.pg_ctl, ["status", "-D", dataDir], false);
  if (![0, 3, 4].includes(result.code)) throw new Error(result.output.trim() || "Could not inspect local PostgreSQL.");
  return result.code === 0;
}

async function activePort() {
  const lines = (await readFile(path.join(dataDir, "postmaster.pid"), "utf8")).split(/\r?\n/);
  const value = Number(lines[3]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("Could not read the running PostgreSQL port.");
  return value;
}

async function ensureDatabase(value) {
  // Never use DATABASE_URL here: it may still point to Neon or a production DB.
  const client = postgres({ host: "127.0.0.1", port: value, username: "deni", password: "deni", database: "postgres", ssl: false, max: 1, prepare: false, connect_timeout: 10 });
  try {
    const [settings] = await client.unsafe("SHOW data_directory");
    const normalize = (location) => process.platform === "win32" ? path.resolve(location).toLowerCase() : path.resolve(location);
    if (normalize(settings.data_directory) !== normalize(await realpath(dataDir))) throw new Error("The connected PostgreSQL is not this project's local cluster.");
    const rows = await client`SELECT 1 FROM pg_database WHERE datname = ${"deni"}`;
    if (!rows.length) await client.unsafe('CREATE DATABASE "deni"');
  } finally { await client.end({ timeout: 5 }); }
}

async function ensurePortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use. Set LOCAL_POSTGRES_PORT to a free port and update your local DATABASE_URL.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function acquireStartLock() {
  try {
    const previous = JSON.parse(await readFile(lockFile, "utf8"));
    if (Number.isInteger(previous.pid) && previous.pid > 0) {
      try { process.kill(previous.pid, 0); }
      catch (error) { if (error.code === "ESRCH") await unlink(lockFile); }
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const token = randomUUID();
  let handle;
  try { handle = await open(lockFile, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Another db:start is already in progress."); throw error; }
  await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
  await handle.close();
  return async () => {
    const current = JSON.parse(await readFile(lockFile, "utf8").catch(() => "null"));
    if (current?.token === token) await unlink(lockFile);
  };
}

async function start(bin) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("LOCAL_POSTGRES_PORT must be between 1 and 65535.");
  if (process.getuid?.() === 0) throw new Error("Run local PostgreSQL as a regular user, not root.");
  const release = await acquireStartLock();
  try {
    if (await running(bin)) {
      const value = await activePort();
      await ensureDatabase(value);
      console.log(`PostgreSQL is already running.\n${connectionUrl(value)}`);
      return;
    }
    await ensurePortAvailable();
    const versionFile = path.join(dataDir, "PG_VERSION");
    if (!existsSync(versionFile)) {
      const passwordFile = path.join(directory, `.init-password-${randomUUID()}`);
      await writeFile(passwordFile, "deni\n", { mode: 0o600 });
      console.log("Initializing local PostgreSQL 17…");
      try { await successful(bin.initdb, ["-D", dataDir, "--username=deni", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]); }
      finally { await unlink(passwordFile).catch(() => undefined); }
    } else if ((await readFile(versionFile, "utf8")).trim() !== "17") {
      throw new Error("The local data belongs to a different PostgreSQL major version. Keep it and migrate explicitly; it will not be overwritten.");
    }
    // pg_ctl backgrounds the native server and waits until it accepts connections.
    // Bind only to loopback; local development credentials are intentionally fixed.
    // On Windows pg_ctl/PostgreSQL owns the log file; appending its output there
    // from Node while it starts can fail with EBUSY. Errors are still captured by run().
    await successful(bin.pg_ctl, ["start", "-D", dataDir, "-l", logFile, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "60"], false, false);
    await ensureDatabase(port);
    console.log(`PostgreSQL 17 is running in the background.\n${connectionUrl(port)}\nData: ${dataDir}\nStop: bun db:stop`);
  } finally { await release(); }
}

async function logs() {
  if (!existsSync(logFile)) { console.log("No PostgreSQL log yet. Start it with bun db:start."); return; }
  const handle = await open(logFile, "r");
  const { size } = await handle.stat();
  const buffer = Buffer.alloc(Math.min(size, 64000));
  await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
  await handle.close();
  process.stdout.write(buffer.toString("utf8"));
  let offset = size;
  let reading = false;
  watchFile(logFile, { interval: 1000 }, async () => {
    if (reading) return;
    reading = true;
    let file;
    try {
      file = await open(logFile, "r");
      const { size: nextSize } = await file.stat();
      if (nextSize < offset) offset = 0;
      if (nextSize > offset) {
        const chunk = Buffer.alloc(Math.min(nextSize - offset, 64000));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
        offset += bytesRead;
        process.stdout.write(chunk.subarray(0, bytesRead).toString("utf8"));
      }
    } catch (error) { console.error(error.message); }
    finally { await file?.close(); reading = false; }
  });
  process.once("SIGINT", () => { unwatchFile(logFile); process.exit(0); });
}

async function main() {
  const command = process.argv[2];
  if (!["start", "stop", "status", "logs"].includes(command)) throw new Error("Use bun db:start, bun db:stop, bun db:status, or bun db:logs.");
  await mkdir(directory, { recursive: true });
  if (command === "logs") return logs();
  const bin = await binaries();
  if (command === "start") return start(bin);
  if (!(await running(bin))) { console.log("Local PostgreSQL is stopped. Data is preserved."); return; }
  if (command === "status") { console.log(`Local PostgreSQL is running.\n${connectionUrl(await activePort())}`); return; }
  await successful(bin.pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "60"], false);
  console.log("Local PostgreSQL stopped. Data is preserved.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
