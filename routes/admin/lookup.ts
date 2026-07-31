import { Hono } from "hono";
import {
  getClientSignalLogStats,
  queryClientSignalLogs,
  type ClientSignalLogOutcome,
} from "../../utils/deni/clientSignalLog";

const OUTCOMES: ClientSignalLogOutcome[] = [
  "allowed",
  "missing_banned",
  "legacy_update_required",
  "enforcement_disabled",
  "already_banned",
  "silent_rule_banned",
];

const CLIENTS = [
  "codex",
  "claude_code",
  "opencode",
  "flixa",
  "flixa_cli",
  "none",
] as const;

export const adminLookupRouter = new Hono();

adminLookupRouter.get("/lookup/api", (c) => {
  const userId = c.req.query("userId") || undefined;
  const client = c.req.query("client") || undefined;
  const outcome = c.req.query("outcome") || undefined;
  const path = c.req.query("path") || undefined;
  const allowedRaw = c.req.query("allowed");
  const limitRaw = c.req.query("limit");

  let allowed: boolean | undefined;
  if (allowedRaw === "true" || allowedRaw === "1") allowed = true;
  if (allowedRaw === "false" || allowedRaw === "0") allowed = false;

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const stats = getClientSignalLogStats();
  const entries = queryClientSignalLogs({
    userId,
    client,
    outcome,
    path,
    allowed,
    limit,
  });

  return c.json({
    stats,
    count: entries.length,
    entries,
  });
});

adminLookupRouter.get("/lookup", (c) => {
  return c.html(renderLookupPage());
});

function renderLookupPage(): string {
  const outcomeOptions = OUTCOMES.map(
    (o) => `<option value="${o}">${o}</option>`,
  ).join("");
  const clientOptions = CLIENTS.map(
    (cl) => `<option value="${cl}">${cl}</option>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Client Signal Lookup · Flixa Admin</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2d3a4d;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --accent: #5b9fd4;
      --ok: #3dd68c;
      --warn: #f0b429;
      --bad: #f07178;
      --row-hover: #243044;
      --input: #121a24;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.5rem;
      align-items: baseline;
      justify-content: space-between;
    }
    h1 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .meta { color: var(--muted); font-size: 0.85rem; }
    main { padding: 1rem 1.25rem 2rem; }
    form.filters {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 0.6rem 0.75rem;
      margin-bottom: 1rem;
      padding: 0.9rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    input, select, button {
      font: inherit;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--input);
      color: var(--text);
      padding: 0.45rem 0.55rem;
      font-size: 0.9rem;
      text-transform: none;
      letter-spacing: normal;
    }
    input:focus, select:focus {
      outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      border-color: var(--accent);
    }
    .actions {
      display: flex;
      align-items: end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    button {
      cursor: pointer;
      background: var(--accent);
      border-color: transparent;
      color: #0b1220;
      font-weight: 600;
      padding: 0.5rem 0.85rem;
    }
    button.secondary {
      background: transparent;
      color: var(--text);
      border-color: var(--border);
      font-weight: 500;
    }
    .check {
      flex-direction: row;
      align-items: center;
      gap: 0.4rem;
      text-transform: none;
      font-size: 0.85rem;
      color: var(--text);
      padding-bottom: 0.35rem;
    }
    .check input { width: auto; }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.7rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #152033;
      color: var(--muted);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      z-index: 1;
    }
    tbody tr:hover { background: var(--row-hover); }
    tbody tr:last-child td { border-bottom: none; }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
    }
    .badge {
      display: inline-block;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge.allowed { background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); }
    .badge.missing_banned, .badge.already_banned, .badge.silent_rule_banned {
      background: color-mix(in srgb, var(--bad) 22%, transparent); color: var(--bad);
    }
    .badge.legacy_update_required, .badge.enforcement_disabled {
      background: color-mix(in srgb, var(--warn) 22%, transparent); color: var(--warn);
    }
    .headers {
      max-width: 360px;
      color: var(--muted);
      word-break: break-all;
      white-space: pre-wrap;
      font-size: 0.75rem;
      line-height: 1.35;
    }
    .empty, .error {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
    }
    .error { color: var(--bad); }
    .user { max-width: 180px; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Client Signal Lookup</h1>
      <div class="meta" style="margin-top:0.35rem">
        <a href="/admin/rules" style="color:var(--accent);text-decoration:none">Silent ban rules →</a>
        ·
        <a href="/admin/logout" style="color:var(--muted);text-decoration:none">Log out</a>
      </div>
    </div>
    <div class="meta" id="stats">Loading…</div>
  </header>
  <main>
    <form class="filters" id="filters">
      <label>User ID
        <input name="userId" type="search" placeholder="substring" autocomplete="off" />
      </label>
      <label>Client
        <select name="client">
          <option value="">any</option>
          ${clientOptions}
        </select>
      </label>
      <label>Outcome
        <select name="outcome">
          <option value="">any</option>
          ${outcomeOptions}
        </select>
      </label>
      <label>Path
        <input name="path" type="search" placeholder="/v1/…" autocomplete="off" />
      </label>
      <label>Allowed
        <select name="allowed">
          <option value="">any</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </label>
      <label>Limit
        <input name="limit" type="number" min="1" max="1000" value="200" />
      </label>
      <div class="actions">
        <button type="submit">Search</button>
        <button type="button" class="secondary" id="reset">Reset</button>
        <label class="check"><input type="checkbox" id="autorefresh" /> Auto-refresh 5s</label>
      </div>
    </form>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Outcome</th>
            <th>Client</th>
            <th>User</th>
            <th>Request</th>
            <th>Headers</th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr><td colspan="6" class="empty">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </main>
  <script>
    const form = document.getElementById('filters');
    const rows = document.getElementById('rows');
    const statsEl = document.getElementById('stats');
    const autoEl = document.getElementById('autorefresh');
    let timer = null;

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatHeaders(h) {
      if (!h || typeof h !== 'object') return '';
      return Object.entries(h)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => k + ': ' + v)
        .join('\\n');
    }

    function formatTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, { hour12: false });
      } catch {
        return iso;
      }
    }

    async function load() {
      const fd = new FormData(form);
      const params = new URLSearchParams();
      for (const [k, v] of fd.entries()) {
        if (String(v).trim() !== '') params.set(k, String(v));
      }
      try {
        const res = await fetch('/admin/lookup/api?' + params.toString(), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          if (res.status === 401) {
            location.href = '/admin/login?next=' + encodeURIComponent(location.pathname + location.search);
            return;
          }
          const text = await res.text();
          rows.innerHTML = '<tr><td colspan="6" class="error">' + esc(res.status + ' ' + text) + '</td></tr>';
          return;
        }
        const data = await res.json();
        const count = data.stats?.count ?? 0;
        const max = data.stats?.max ?? 0;
        statsEl.textContent =
          'Buffer: ' + count + ' / ' + max +
          ' · Showing: ' + (data.count ?? 0) +
          ' · Updated: ' + new Date().toLocaleTimeString();

        const entries = data.entries || [];
        if (!entries.length) {
          rows.innerHTML = '<tr><td colspan="6" class="empty">No matching client signal logs.</td></tr>';
          return;
        }

        rows.innerHTML = entries.map((e) => {
          const outcome = esc(e.outcome);
          const client = esc(e.client ?? 'none');
          return (
            '<tr>' +
              '<td class="mono">' + esc(formatTime(e.at)) + '</td>' +
              '<td><span class="badge ' + outcome + '">' + outcome + '</span></td>' +
              '<td class="mono">' + client + '</td>' +
              '<td class="mono user">' + esc(e.userId) + '</td>' +
              '<td class="mono">' + esc(e.method) + ' ' + esc(e.path) + '</td>' +
              '<td class="headers mono">' + esc(formatHeaders(e.headers)) + '</td>' +
            '</tr>'
          );
        }).join('');
      } catch (err) {
        rows.innerHTML = '<tr><td colspan="6" class="error">' + esc(err && err.message ? err.message : err) + '</td></tr>';
      }
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      load();
    });

    document.getElementById('reset').addEventListener('click', () => {
      form.reset();
      form.limit.value = '200';
      load();
    });

    autoEl.addEventListener('change', () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (autoEl.checked) {
        timer = setInterval(load, 5000);
      }
    });

    load();
  </script>
</body>
</html>`;
}
