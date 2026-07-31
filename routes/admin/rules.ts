import { Hono } from "hono";
import {
  createSilentBanRule,
  deleteSilentBanRule,
  getSilentBanRule,
  listSilentBanHits,
  listSilentBanRules,
  resetSilentBanHits,
  updateSilentBanRule,
  type SilentBanCondition,
  type SilentBanMatchOp,
} from "../../utils/deni";

export const adminRulesRouter = new Hono();

const MATCH_OPS: SilentBanMatchOp[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "regex",
  "exists",
  "not_exists",
];

// ── JSON API ─────────────────────────────────────────────────────────────────

adminRulesRouter.get("/rules/api", async (c) => {
  try {
    const rules = await listSilentBanRules();
    const hits = await listSilentBanHits({ limit: 200 });
    return c.json({ rules, hits, matchOps: MATCH_OPS });
  } catch (error) {
    console.error("[AdminRules] list failed:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list rules",
      },
      500,
    );
  }
});

// Static paths before /rules/api/:id so "hits" is not captured as an id.
adminRulesRouter.get("/rules/api/hits/list", async (c) => {
  const userId = c.req.query("userId") || undefined;
  const ruleId = c.req.query("ruleId") || undefined;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const hits = await listSilentBanHits({ userId, ruleId, limit });
    return c.json({ hits, count: hits.length });
  } catch (error) {
    console.error("[AdminRules] list hits failed:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to list hits",
      },
      500,
    );
  }
});

adminRulesRouter.delete("/rules/api/hits", async (c) => {
  const userId = c.req.query("userId") || undefined;
  const ruleId = c.req.query("ruleId") || undefined;
  const result = await resetSilentBanHits({ userId, ruleId });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ deleted: result.deleted });
});

adminRulesRouter.post("/rules/api", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Body must be an object" }, 400);
  }

  const input = body as {
    name?: string;
    enabled?: boolean;
    hitsBeforeBan?: number;
    reason?: string;
    conditions?: SilentBanCondition[];
  };

  const result = await createSilentBanRule({
    name: input.name ?? "",
    enabled: input.enabled,
    hitsBeforeBan: input.hitsBeforeBan,
    reason: input.reason,
    conditions: input.conditions ?? [],
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ rule: result.rule }, 201);
});

adminRulesRouter.get("/rules/api/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const rule = await getSilentBanRule(id);
    if (!rule) {
      return c.json({ error: "rule_not_found" }, 404);
    }
    const hits = await listSilentBanHits({ ruleId: id, limit: 200 });
    return c.json({ rule, hits });
  } catch (error) {
    console.error(`[AdminRules] get rule=${id} failed:`, error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to get rule",
      },
      500,
    );
  }
});

adminRulesRouter.put("/rules/api/:id", async (c) => {
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Body must be an object" }, 400);
  }

  const input = body as {
    name?: string;
    enabled?: boolean;
    hitsBeforeBan?: number;
    reason?: string;
    conditions?: SilentBanCondition[];
  };

  const result = await updateSilentBanRule(id, input);
  if (!result.ok) {
    const status = result.error === "rule_not_found" ? 404 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json({ rule: result.rule });
});

adminRulesRouter.patch("/rules/api/:id", async (c) => {
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Body must be an object" }, 400);
  }

  const result = await updateSilentBanRule(
    id,
    body as {
      name?: string;
      enabled?: boolean;
      hitsBeforeBan?: number;
      reason?: string;
      conditions?: SilentBanCondition[];
    },
  );
  if (!result.ok) {
    const status = result.error === "rule_not_found" ? 404 : 400;
    return c.json({ error: result.error }, status);
  }

  return c.json({ rule: result.rule });
});

adminRulesRouter.delete("/rules/api/:id", async (c) => {
  const id = c.req.param("id");
  const result = await deleteSilentBanRule(id);
  if (!result.ok) {
    return c.json({ error: result.error }, 500);
  }
  if (!result.deleted) {
    return c.json({ error: "rule_not_found" }, 404);
  }
  return c.json({ deleted: true, id });
});

// ── HTML UI ──────────────────────────────────────────────────────────────────

adminRulesRouter.get("/rules", (c) => {
  return c.html(renderRulesPage());
});

function renderRulesPage(): string {
  const opOptions = MATCH_OPS.map(
    (op) => `<option value="${op}">${op}</option>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Silent Ban Rules · Flixa Admin</title>
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
    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 0.85rem; }
    main {
      padding: 1rem 1.25rem 2rem;
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    }
    @media (max-width: 980px) {
      main { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.9rem;
    }
    .stack { display: flex; flex-direction: column; gap: 0.65rem; }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    input, select, button, textarea {
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
    textarea { min-height: 4rem; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.8rem; }
    input:focus, select:focus, textarea:focus {
      outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      border-color: var(--accent);
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 0.55rem;
      align-items: end;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
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
    button.danger {
      background: color-mix(in srgb, var(--bad) 85%, #000);
      color: #fff;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .check {
      flex-direction: row;
      align-items: center;
      gap: 0.4rem;
      text-transform: none;
      font-size: 0.85rem;
      color: var(--text);
      padding-bottom: 0.2rem;
    }
    .check input { width: auto; }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      max-height: 55vh;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 0.5rem 0.65rem;
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
    tbody tr.selected { outline: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
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
    .badge.on { background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); }
    .badge.off { background: color-mix(in srgb, var(--muted) 22%, transparent); color: var(--muted); }
    .cond {
      color: var(--muted);
      font-size: 0.75rem;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty, .error, .okmsg {
      padding: 0.75rem;
      border-radius: 8px;
      font-size: 0.85rem;
    }
    .empty { color: var(--muted); text-align: center; }
    .error { color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
    .okmsg { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); }
    .hint {
      color: var(--muted);
      font-size: 0.8rem;
      line-height: 1.45;
    }
    .cond-row {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1.4fr auto auto;
      gap: 0.4rem;
      align-items: end;
      margin-bottom: 0.4rem;
    }
    @media (max-width: 720px) {
      .cond-row { grid-template-columns: 1fr 1fr; }
    }
    .full { grid-column: 1 / -1; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Silent Ban Rules</h1>
      <div class="meta" style="margin-top:0.35rem">
        <a href="/admin/lookup">← Client signal lookup</a>
        · match → count hits → ban after N requests (silent)
        · session login ·
        <a href="/admin/logout">Log out</a>
      </div>
    </div>
    <div class="meta" id="stats">Loading…</div>
  </header>
  <main>
    <section class="panel stack">
      <h2>Rules</h2>
      <div class="actions">
        <button type="button" id="refresh">Refresh</button>
        <button type="button" class="secondary" id="newRule">New rule</button>
      </div>
      <div id="listMsg"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Hits / ban</th>
              <th>Conditions</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="ruleRows">
            <tr><td colspan="5" class="empty">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <h2 style="margin-top:0.5rem">Recent hits</h2>
      <div class="table-wrap" style="max-height:28vh">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Rule</th>
              <th>Count</th>
              <th>Last hit</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="hitRows">
            <tr><td colspan="5" class="empty">—</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel stack">
      <h2 id="formTitle">Create rule</h2>
      <p class="hint">
        All conditions are AND. Targets: header names (<code>user-agent</code>, <code>x-client</code>, …),
        or <code>path</code> / <code>method</code>. Optional <code>header:</code> prefix.
        Matching requests still succeed until the hit counter reaches the ban threshold —
        then the account is banned with the same soft “service unavailable” response (no ban wording).
      </p>
      <form id="ruleForm" class="stack">
        <input type="hidden" name="id" id="ruleId" />
        <div class="row">
          <label class="full">Name
            <input name="name" id="ruleName" required maxlength="120" placeholder="Block curl scrapers" />
          </label>
          <label>Hits before ban
            <input name="hitsBeforeBan" id="hitsBeforeBan" type="number" min="1" max="10000" value="3" required />
          </label>
          <label class="full">Ban reason (internal)
            <input name="reason" id="ruleReason" maxlength="200" placeholder="silent_rule:curl" />
          </label>
          <label class="check"><input type="checkbox" name="enabled" id="ruleEnabled" checked /> Enabled</label>
        </div>

        <div>
          <div class="actions" style="margin-bottom:0.4rem">
            <strong style="font-size:0.85rem;color:var(--muted)">Conditions</strong>
            <button type="button" class="secondary" id="addCond">+ Condition</button>
          </div>
          <div id="conditions"></div>
        </div>

        <div class="actions">
          <button type="submit" id="saveBtn">Save rule</button>
          <button type="button" class="secondary" id="cancelEdit">Cancel</button>
          <button type="button" class="danger" id="deleteBtn" style="display:none">Delete</button>
        </div>
        <div id="formMsg"></div>
      </form>
    </section>
  </main>
  <script>
    const OP_OPTIONS = ${JSON.stringify(MATCH_OPS)};
    const ruleRows = document.getElementById('ruleRows');
    const hitRows = document.getElementById('hitRows');
    const statsEl = document.getElementById('stats');
    const form = document.getElementById('ruleForm');
    const conditionsEl = document.getElementById('conditions');
    const formMsg = document.getElementById('formMsg');
    const listMsg = document.getElementById('listMsg');
    const formTitle = document.getElementById('formTitle');
    const deleteBtn = document.getElementById('deleteBtn');
    let rules = [];
    let hits = [];
    let selectedId = null;

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatTime(iso) {
      try {
        return new Date(iso).toLocaleString(undefined, { hour12: false });
      } catch {
        return iso;
      }
    }

    function formatConditions(conds) {
      if (!Array.isArray(conds) || !conds.length) return '(none)';
      return conds.map((c) => {
        const val = c.op === 'exists' || c.op === 'not_exists'
          ? ''
          : ' ' + JSON.stringify(c.value ?? '');
        const cs = c.caseSensitive ? ' [cs]' : '';
        return c.target + ' ' + c.op + val + cs;
      }).join('\\n');
    }

    function opSelectHtml(selected) {
      return OP_OPTIONS.map((op) =>
        '<option value="' + op + '"' + (op === selected ? ' selected' : '') + '>' + op + '</option>'
      ).join('');
    }

    function addConditionRow(cond) {
      cond = cond || { target: 'user-agent', op: 'contains', value: '', caseSensitive: false };
      const row = document.createElement('div');
      row.className = 'cond-row';
      row.innerHTML =
        '<label>Target<input class="c-target" value="' + esc(cond.target || '') + '" placeholder="user-agent" /></label>' +
        '<label>Op<select class="c-op">' + opSelectHtml(cond.op || 'contains') + '</select></label>' +
        '<label>Value<input class="c-value" value="' + esc(cond.value || '') + '" placeholder="curl/" /></label>' +
        '<label class="check"><input type="checkbox" class="c-cs"' + (cond.caseSensitive ? ' checked' : '') + ' /> CS</label>' +
        '<button type="button" class="secondary c-remove">✕</button>';
      row.querySelector('.c-remove').addEventListener('click', () => row.remove());
      conditionsEl.appendChild(row);
    }

    function readConditions() {
      return Array.from(conditionsEl.querySelectorAll('.cond-row')).map((row) => {
        const op = row.querySelector('.c-op').value;
        const item = {
          target: row.querySelector('.c-target').value.trim(),
          op,
          caseSensitive: row.querySelector('.c-cs').checked,
        };
        if (op !== 'exists' && op !== 'not_exists') {
          item.value = row.querySelector('.c-value').value;
        }
        return item;
      });
    }

    function resetForm() {
      selectedId = null;
      form.reset();
      form.ruleId.value = '';
      form.hitsBeforeBan.value = '3';
      form.ruleEnabled.checked = true;
      conditionsEl.innerHTML = '';
      addConditionRow({ target: 'user-agent', op: 'contains', value: '' });
      formTitle.textContent = 'Create rule';
      deleteBtn.style.display = 'none';
      formMsg.innerHTML = '';
      renderRules();
    }

    function loadRuleIntoForm(rule) {
      selectedId = rule.id;
      form.ruleId.value = rule.id;
      form.ruleName.value = rule.name;
      form.hitsBeforeBan.value = rule.hitsBeforeBan;
      form.ruleReason.value = rule.reason || '';
      form.ruleEnabled.checked = !!rule.enabled;
      conditionsEl.innerHTML = '';
      (rule.conditions || []).forEach(addConditionRow);
      if (!(rule.conditions || []).length) addConditionRow();
      formTitle.textContent = 'Edit rule';
      deleteBtn.style.display = '';
      formMsg.innerHTML = '';
      renderRules();
    }

    function renderRules() {
      if (!rules.length) {
        ruleRows.innerHTML = '<tr><td colspan="5" class="empty">No rules yet. Create one on the right.</td></tr>';
        return;
      }
      ruleRows.innerHTML = rules.map((r) => {
        const selected = r.id === selectedId ? ' selected' : '';
        return (
          '<tr class="' + selected + '" data-id="' + esc(r.id) + '">' +
            '<td><span class="badge ' + (r.enabled ? 'on' : 'off') + '">' + (r.enabled ? 'on' : 'off') + '</span></td>' +
            '<td><div>' + esc(r.name) + '</div><div class="mono" style="color:var(--muted);font-size:0.72rem">' + esc(r.id.slice(0, 8)) + '…</div></td>' +
            '<td class="mono">' + esc(r.hitsBeforeBan) + '</td>' +
            '<td class="cond mono">' + esc(formatConditions(r.conditions)) + '</td>' +
            '<td class="actions">' +
              '<button type="button" class="secondary edit">Edit</button>' +
              '<button type="button" class="secondary toggle">' + (r.enabled ? 'Disable' : 'Enable') + '</button>' +
            '</td>' +
          '</tr>'
        );
      }).join('');

      ruleRows.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.getAttribute('data-id');
        const rule = rules.find((r) => r.id === id);
        if (!rule) return;
        tr.querySelector('.edit').addEventListener('click', () => loadRuleIntoForm(rule));
        tr.querySelector('.toggle').addEventListener('click', async () => {
          try {
            const res = await adminFetch('/admin/rules/api/' + encodeURIComponent(id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: !rule.enabled }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || res.statusText);
            await load();
          } catch (err) {
            listMsg.innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
          }
        });
      });
    }

    function renderHits() {
      if (!hits.length) {
        hitRows.innerHTML = '<tr><td colspan="5" class="empty">No hit counters yet.</td></tr>';
        return;
      }
      const ruleName = (id) => {
        const r = rules.find((x) => x.id === id);
        return r ? r.name : id.slice(0, 8) + '…';
      };
      hitRows.innerHTML = hits.map((h) => (
        '<tr>' +
          '<td class="mono user">' + esc(h.userId) + '</td>' +
          '<td>' + esc(ruleName(h.ruleId)) + '</td>' +
          '<td class="mono">' + esc(h.hitCount) + '</td>' +
          '<td class="mono">' + esc(formatTime(h.lastHitAt)) + '</td>' +
          '<td><button type="button" class="secondary reset" data-user="' + esc(h.userId) + '" data-rule="' + esc(h.ruleId) + '">Reset</button></td>' +
        '</tr>'
      )).join('');

      hitRows.querySelectorAll('.reset').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const userId = btn.getAttribute('data-user');
          const ruleId = btn.getAttribute('data-rule');
          if (!confirm('Reset hit counter for this user/rule?')) return;
          try {
            const params = new URLSearchParams({ userId, ruleId });
            const res = await adminFetch('/admin/rules/api/hits?' + params.toString(), {
              method: 'DELETE',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || res.statusText);
            await load();
          } catch (err) {
            listMsg.innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
          }
        });
      });
    }

    async function adminFetch(url, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        return await fetch(url, {
          credentials: 'same-origin',
          signal: controller.signal,
          ...options,
          headers: {
            Accept: 'application/json',
            ...(options && options.headers ? options.headers : {}),
          },
        });
      } finally {
        clearTimeout(timer);
      }
    }

    function formatLoadError(err, status, bodyText) {
      if (err && err.name === 'AbortError') {
        return 'Timed out after 15s loading rules. Check DENI_DATABASE_URL / DB connectivity (rules are stored in Postgres).';
      }
      if (status === 401) {
        location.href = '/admin/login?next=' + encodeURIComponent(location.pathname + location.search);
        return 'Session expired — redirecting to login…';
      }
      if (status === 503) {
        return bodyText || 'Admin is not configured. Set ADMIN_PASSWORD on the server.';
      }
      if (status) {
        return status + ' ' + (bodyText || '');
      }
      return err && err.message ? err.message : String(err);
    }

    async function load() {
      listMsg.innerHTML = '';
      statsEl.textContent = 'Loading…';
      try {
        const res = await adminFetch('/admin/rules/api');
        if (!res.ok) {
          const text = await res.text();
          throw Object.assign(new Error(formatLoadError(null, res.status, text)), {
            status: res.status,
            bodyText: text,
          });
        }
        const data = await res.json();
        rules = data.rules || [];
        hits = data.hits || [];
        statsEl.textContent =
          'Rules: ' + rules.length +
          ' · Enabled: ' + rules.filter((r) => r.enabled).length +
          ' · Hit rows: ' + hits.length +
          ' · Updated: ' + new Date().toLocaleTimeString();
        renderRules();
        renderHits();
      } catch (err) {
        const msg = formatLoadError(err, err && err.status, err && err.bodyText);
        ruleRows.innerHTML = '<tr><td colspan="5" class="error">' + esc(msg) + '</td></tr>';
        hitRows.innerHTML = '<tr><td colspan="5" class="empty">—</td></tr>';
        statsEl.textContent = 'Error loading rules';
        listMsg.innerHTML = '<div class="error">' + esc(msg) + '</div>';
      }
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      formMsg.innerHTML = '';
      const payload = {
        name: form.ruleName.value.trim(),
        hitsBeforeBan: Number(form.hitsBeforeBan.value),
        reason: form.ruleReason.value.trim() || undefined,
        enabled: form.ruleEnabled.checked,
        conditions: readConditions(),
      };
      const id = form.ruleId.value.trim();
      try {
        const res = await adminFetch(
          id ? '/admin/rules/api/' + encodeURIComponent(id) : '/admin/rules/api',
          {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        formMsg.innerHTML = '<div class="okmsg">Saved.</div>';
        await load();
        if (data.rule) loadRuleIntoForm(data.rule);
      } catch (err) {
        formMsg.innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const id = form.ruleId.value.trim();
      if (!id) return;
      if (!confirm('Delete this rule and its hit counters?')) return;
      try {
        const res = await adminFetch('/admin/rules/api/' + encodeURIComponent(id), {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        resetForm();
        await load();
      } catch (err) {
        formMsg.innerHTML = '<div class="error">' + esc(err.message || err) + '</div>';
      }
    });

    document.getElementById('addCond').addEventListener('click', () => addConditionRow());
    document.getElementById('newRule').addEventListener('click', resetForm);
    document.getElementById('cancelEdit').addEventListener('click', resetForm);
    document.getElementById('refresh').addEventListener('click', load);

    resetForm();
    load();
  </script>
</body>
</html>`;
}
