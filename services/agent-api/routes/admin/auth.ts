import { getRequestClientIp } from "../../utils/clientIp";
import { Hono } from "hono";
import {
  clearAdminSessionCookie,
  createAdminSessionToken,
  setAdminSessionCookie,
  verifyAdminCredentials,
  verifyAdminSessionToken,
  ADMIN_SESSION_COOKIE,
} from "../../middleware/adminAuth";
import { getCookie } from "hono/cookie";
import {
  failedLoginDelay,
  logAdminAudit,
} from "../../utils/adminSecurity";
import { isAuthDisabledMode } from "../../utils/authMode";

export const adminAuthRouter = new Hono();

function safeNextPath(raw: string | undefined): string {
  if (!raw) return "/admin/lookup";
  try {
    // Allow only relative /admin paths (no open redirect).
    const path = decodeURIComponent(raw);
    if (
      path.startsWith("/admin") &&
      !path.startsWith("//") &&
      !path.includes("://") &&
      !path.startsWith("/admin/login")
    ) {
      return path;
    }
  } catch {
    // ignore
  }
  return "/admin/lookup";
}

adminAuthRouter.get("/login", async (c) => {
  if (isAuthDisabledMode()) {
    return c.redirect(safeNextPath(c.req.query("next")), 302);
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return c.text(
      "Admin is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USER).",
      503,
    );
  }

  // Already signed in → bounce to destination.
  const existing = getCookie(c, ADMIN_SESSION_COOKIE);
  if (await verifyAdminSessionToken(existing)) {
    return c.redirect(safeNextPath(c.req.query("next")), 302);
  }

  const next = safeNextPath(c.req.query("next"));
  const error = c.req.query("error");
  return c.html(renderLoginPage(next, error === "1"));
});

adminAuthRouter.post("/login", async (c) => {
  if (isAuthDisabledMode()) {
    const contentType = (c.req.header("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      return c.json({ ok: true, next: "/admin/lookup" });
    }
    return c.redirect("/admin/lookup", 302);
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return c.text(
      "Admin is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USER).",
      503,
    );
  }

  const ip = getRequestClientIp(c);
  const contentType = c.req.header("content-type") || "";
  let username = "";
  let pass = "";
  let nextRaw = "/admin/lookup";

  if (contentType.includes("application/json")) {
    const body = await c.req.json<{
      username?: string;
      password?: string;
      next?: string;
    }>();
    username = body.username ?? "";
    pass = body.password ?? "";
    nextRaw = body.next ?? nextRaw;
  } else {
    const body = await c.req.parseBody();
    username = String(body.username ?? "");
    pass = String(body.password ?? "");
    nextRaw = String(body.next ?? nextRaw);
  }

  const ok = await verifyAdminCredentials(username, pass);
  if (!ok) {
    await failedLoginDelay();
    logAdminAudit("login_failed", {
      ip,
      path: "/admin/login",
      username,
      reason: "form",
    });

    const next = safeNextPath(nextRaw);
    if (contentType.includes("application/json")) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    return c.redirect(
      `/admin/login?next=${encodeURIComponent(next)}&error=1`,
      302,
    );
  }

  // Rotate session on every successful login.
  const token = await createAdminSessionToken();
  setAdminSessionCookie(c, token);
  logAdminAudit("login_ok", { ip, path: "/admin/login", username });

  const next = safeNextPath(nextRaw);
  if (contentType.includes("application/json")) {
    return c.json({ ok: true, next });
  }
  return c.redirect(next, 302);
});

adminAuthRouter.get("/logout", (c) => {
  const ip = getRequestClientIp(c);
  clearAdminSessionCookie(c);
  logAdminAudit("logout", { ip, path: "/admin/logout" });
  return c.redirect("/admin/login", 302);
});

adminAuthRouter.post("/logout", (c) => {
  const ip = getRequestClientIp(c);
  clearAdminSessionCookie(c);
  logAdminAudit("logout", { ip, path: "/admin/logout" });
  if ((c.req.header("Accept") || "").includes("application/json")) {
    return c.json({ ok: true });
  }
  return c.redirect("/admin/login", 302);
});

function renderLoginPage(next: string, showError: boolean): string {
  const nextAttr = next
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Admin Login · Flixa</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2d3a4d;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --accent: #5b9fd4;
      --bad: #f07178;
      --input: #121a24;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      padding: 1rem;
    }
    .card {
      width: min(100%, 400px);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1.35rem 1.4rem;
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.15rem;
      font-weight: 600;
    }
    p {
      margin: 0 0 1rem;
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 0.7rem;
    }
    input {
      font: inherit;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--input);
      color: var(--text);
      padding: 0.55rem 0.65rem;
      font-size: 0.95rem;
      text-transform: none;
      letter-spacing: normal;
    }
    input:focus {
      outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      border-color: var(--accent);
    }
    button {
      width: 100%;
      margin-top: 0.35rem;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      padding: 0.6rem 0.85rem;
      background: var(--accent);
      color: #0b1220;
    }
    .error {
      margin: 0 0 0.85rem;
      padding: 0.55rem 0.65rem;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bad) 12%, transparent);
      color: var(--bad);
      font-size: 0.85rem;
    }
    .hint {
      margin-top: 0.9rem;
      font-size: 0.78rem;
      color: var(--muted);
      line-height: 1.4;
    }
    code { font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Flixa Admin</h1>
    <p>Sign in with your admin credentials. Session cookie is httpOnly (no Basic Auth dialog).</p>
    ${showError ? '<div class="error">Invalid username or password.</div>' : ""}
    <form method="post" action="/admin/login" autocomplete="username">
      <input type="hidden" name="next" value="${nextAttr}" />
      <label>Username
        <input name="username" type="text" required autocomplete="username" autofocus />
      </label>
      <label>Password
        <input name="password" type="password" required autocomplete="current-password" />
      </label>
      <button type="submit">Sign in</button>
    </form>
    <p class="hint">
      Use a long random <code>ADMIN_PASSWORD</code>.
      Failed attempts are rate-limited and logged.
    </p>
  </div>
</body>
</html>`;
}
