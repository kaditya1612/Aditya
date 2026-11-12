// =====================================================================
// TEST-ONLY local stand-in for the Supabase HTTP APIs (REST / Auth / Storage)
// used by the end-to-end suite. Every REST request runs inside a transaction
// as the Postgres role `authenticated` with request.jwt.claim.sub set to the
// caller's user id — so RLS, triggers, guards and RPCs behave exactly as on
// Supabase. Implements only the PostgREST subset this app uses.
// NEVER deploy this. Production uses a real Supabase project.
// =====================================================================
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.EMU_PORT ?? 54321);
// Match PostgREST's JSON representation of Postgres types
pg.types.setTypeParser(1082, (v) => v);                          // date → "YYYY-MM-DD"
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());  // timestamptz → ISO 8601
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T"));        // timestamp
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(20, (v) => Number(v));                     // bigint → number
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const STORE = process.env.EMU_STORAGE ?? "/var/tmp/emu-storage";
fs.mkdirSync(STORE, { recursive: true });
const SECRET = "e2e-only-secret";
const ID = /^[a-z_][a-z0-9_]*$/;

// ---------- JWT (HS256) ----------
const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(token) {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!s || crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function pgError(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "PGRST116" ? 406 : 400;
  send(res, status, { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}
async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (claims?.role === "service_role") {
      await c.query("set local role service_role");
    } else {
      await c.query(`set local role ${claims ? "authenticated" : "anon"}`);
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [claims?.sub ?? ""]);
    }
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------- PostgREST subset ----------
function splitTop(s) {
  const out = []; let depth = 0, quote = false, cur = "";
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unq = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
function cond(col, expr, params) {
  if (!ID.test(col)) throw Object.assign(new Error(`bad column ${col}`), { code: "PGRST100" });
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot); const val = expr.slice(dot + 1);
  let sql;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  switch (op) {
    case "eq": sql = `"${col}" = ${p(unq(val))}`; break;
    case "neq": sql = `"${col}" <> ${p(unq(val))}`; break;
    case "gt": sql = `"${col}" > ${p(unq(val))}`; break;
    case "gte": sql = `"${col}" >= ${p(unq(val))}`; break;
    case "lt": sql = `"${col}" < ${p(unq(val))}`; break;
    case "lte": sql = `"${col}" <= ${p(unq(val))}`; break;
    case "is": sql = `"${col}" is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": sql = `"${col}"::text = any(${p(splitTop(val.replace(/^\(|\)$/g, "")).map(unq))}::text[])`; break;
    case "ilike": sql = `"${col}" ilike ${p(unq(val).replace(/\*/g, "%"))}`; break;
    default: throw Object.assign(new Error(`unsupported operator ${op}`), { code: "PGRST100" });
  }
  return neg ? `not (${sql})` : sql;
}
function parseOr(v, params) {
  return "(" + splitTop(v.replace(/^\(|\)$/g, "")).map((part) => {
    const d = part.indexOf(".");
    return cond(part.slice(0, d), part.slice(d + 1), params);
  }).join(" or ") + ")";
}
function whereClause(q, params) {
  const parts = [];
  for (const [k, v] of q) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    parts.push(k === "or" ? parseOr(v, params) : cond(k, v, params));
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}
async function selectList(c, table, sel) {
  if (!sel || sel === "*") return "t.*";
  const out = [];
  for (const item of splitTop(sel)) {
    const m = item.trim().match(/^([a-z_]+)\((.*)\)$/);
    if (!m) { const col = item.trim(); out.push(col === "*" ? "t.*" : (ID.test(col) ? `t."${col}"` : (() => { throw new Error("bad select"); })())); continue; }
    const [, rel, cols] = m;
    const fk = await c.query(
      `select a.attname from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.contype = 'f' and k.conrelid = $1::regclass and k.confrelid = $2::regclass limit 1`, [`public.${table}`, `public.${rel}`]);
    if (!fk.rows[0]) throw new Error(`no relationship ${table} → ${rel}`);
    const cl = cols.split(",").map((x) => x.trim()).filter((x) => ID.test(x)).map((x) => `"${x}"`).join(", ");
    out.push(`(select row_to_json(e) from (select ${cl} from public."${rel}" r where r.id = t."${fk.rows[0].attname}") e) as "${rel}"`);
  }
  return out.join(", ");
}
const wantsObject = (req) => (req.headers.accept ?? "").includes("vnd.pgrst.object");
function respondRows(req, res, rows, status = 200) {
  if (wantsObject(req)) {
    if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned`, details: `Results contain ${rows.length} rows` });
    return send(res, status, rows[0]);
  }
  send(res, status, rows);
}

async function rest(req, res, url, claims) {
  const name = url.pathname.replace(/^\/rest\/v1\//, "");
  const q = [...url.searchParams.entries()];
  const params = [];

  if (name.startsWith("rpc/")) {
    const fn = name.slice(4);
    if (!ID.test(fn)) return send(res, 404, { message: "not found" });
    const args = JSON.parse((await readBody(req)).toString() || "{}");
    return asUser(claims, async (c) => {
      const meta = await c.query(
        `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
                p.proretset, format_type(p.prorettype, null) as rettype, t.typtype
           from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn]);
      const m = meta.rows[0];
      if (!m) throw Object.assign(new Error(`function ${fn} not found`), { code: "PGRST202" });
      const named = Object.entries(args).map(([k, v]) => {
        const i = (m.names ?? []).indexOf(k);
        if (i < 0) throw Object.assign(new Error(`unknown argument ${k}`), { code: "PGRST202" });
        params.push(v === null ? null : Array.isArray(v) ? v : typeof v === "object" ? JSON.stringify(v) : v);
        return `"${k}" => $${params.length}::${m.types[i]}`;
      });
      const call = `public."${fn}"(${named.join(", ")})`;
      if (m.rettype === "void") { await c.query(`select ${call}`, params); return send(res, 204); }
      if (m.typtype === "c") {
        const r = await c.query(`select * from ${call}`, params);
        return m.proretset ? send(res, 200, r.rows) : send(res, 200, r.rows[0] ?? null);
      }
      const r = await c.query(`select ${call} as v`, params);
      return send(res, 200, r.rows[0].v);
    }).catch((e) => pgError(res, e));
  }

  if (!ID.test(name)) return send(res, 404, { message: "not found" });
  const prefer = req.headers.prefer ?? "";
  const returning = prefer.includes("return=representation");

  return asUser(claims, async (c) => {
    if (req.method === "GET") {
      const sel = await selectList(c, name, url.searchParams.get("select"));
      let sql = `select ${sel} from public."${name}" t${whereClause(q, params)}`;
      const order = url.searchParams.get("order");
      if (order) sql += " order by " + order.split(",").map((o) => {
        const [col, dir, nulls] = o.split(".");
        if (!ID.test(col)) throw new Error("bad order");
        return `t."${col}" ${dir === "desc" ? "desc" : "asc"}${nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""}`;
      }).join(", ");
      const limit = url.searchParams.get("limit"); const offset = url.searchParams.get("offset");
      if (limit) sql += ` limit ${Number(limit)}`;
      if (offset) sql += ` offset ${Number(offset)}`;
      const r = await c.query(sql, params);
      return respondRows(req, res, r.rows);
    }
    if (req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      const rows = Array.isArray(body) ? body : [body];
      const out = [];
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => ID.test(k));
        const p = cols.map((k) => row[k]).map((v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v));
        const r = await c.query(`insert into public."${name}" (${cols.map((k) => `"${k}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, p);
        out.push(...r.rows);
      }
      if (!returning) return send(res, 201);
      const sel = url.searchParams.get("select");
      if (sel && sel !== "*") {
        const keep = splitTop(sel).map((s) => s.trim());
        return respondRows(req, res, out.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]]))), 201);
      }
      return respondRows(req, res, out, 201);
    }
    if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString());
      const cols = Object.keys(body).filter((k) => ID.test(k));
      cols.forEach((k) => { const v = body[k]; params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v); });
      const set = cols.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
      const r = await c.query(`update public."${name}" t set ${set}${whereClause(q, params)} returning *`, params);
      if (!returning) return send(res, 204);
      const sel = url.searchParams.get("select");
      const rows = sel && sel !== "*" ? r.rows.map((x) => Object.fromEntries(splitTop(sel).map((k) => [k.trim(), x[k.trim()]]))) : r.rows;
      return respondRows(req, res, rows);
    }
    send(res, 405, { message: "method not allowed" });
  }).catch((e) => pgError(res, e));
}

// ---------- Auth subset ----------
async function userJson(id) {
  const r = await pool.query("select id, email, raw_app_meta_data, raw_user_meta_data from auth.users where id = $1", [id]);
  const u = r.rows[0];
  if (!u) return null;
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data, created_at: new Date().toISOString() };
}
async function session(id) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const refresh = crypto.randomBytes(16).toString("hex");
  await pool.query("insert into e2e.refresh_tokens(token, user_id) values ($1, $2)", [refresh, id]);
  return { access_token: sign({ sub: id, role: "authenticated", aud: "authenticated", exp }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: await userJson(id) };
}
const hash = (pw) => crypto.createHash("sha256").update("salt:" + pw).digest("hex");

async function auth(req, res, url) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  try {
    if (p === "/token" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = JSON.parse((await readBody(req)).toString());
      const r = await pool.query(`select u.id from auth.users u join e2e.passwords pw on pw.user_id = u.id
                                   where lower(u.email) = lower($1) and pw.hash = $2 and not pw.banned`, [email, hash(password)]);
      if (!r.rows[0]) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" });
      return send(res, 200, await session(r.rows[0].id));
    }
    if (p === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const { refresh_token } = JSON.parse((await readBody(req)).toString());
      const r = await pool.query("delete from e2e.refresh_tokens where token = $1 returning user_id", [refresh_token]);
      if (!r.rows[0]) return send(res, 400, { error: "invalid_grant", msg: "Invalid Refresh Token" });
      return send(res, 200, await session(r.rows[0].user_id));
    }
    if (p === "/user" && req.method === "GET") {
      const claims = verify(bearer(req));
      if (!claims?.sub) return send(res, 401, { msg: "invalid JWT", code: "bad_jwt" });
      return send(res, 200, await userJson(claims.sub));
    }
    if (p === "/logout") return send(res, 204);
    const claims = verify(bearer(req)) ?? (bearer(req) === process.env.SERVICE_KEY ? { role: "service_role" } : null);
    if (p.startsWith("/admin/users")) {
      if (claims?.role !== "service_role") return send(res, 403, { msg: "not admin" });
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      if (req.method === "POST") {
        const r = await pool.query("insert into auth.users(email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning id",
          [body.email, body.app_metadata ?? {}, body.user_metadata ?? {}]);
        await pool.query("insert into e2e.passwords(user_id, hash) values ($1, $2)", [r.rows[0].id, hash(body.password)]);
        return send(res, 200, await userJson(r.rows[0].id));
      }
      if (req.method === "PUT") {
        const id = p.split("/").pop();
        if (body.password) await pool.query("update e2e.passwords set hash = $2 where user_id = $1", [id, hash(body.password)]);
        if (body.ban_duration) await pool.query("update e2e.passwords set banned = $2 where user_id = $1", [id, body.ban_duration !== "none"]);
        return send(res, 200, await userJson(id));
      }
    }
    send(res, 404, { msg: "not implemented in emulator: " + p });
  } catch (e) { pgError(res, e); }
}

// ---------- Storage subset ----------
async function storage(req, res, url) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  const claims = verify(bearer(req));
  try {
    let m;
    if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === "POST") {
      const [, bucket, name] = m;
      const ok = await asUser(claims, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
      if (!ok.rows.length) return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      const token = sign({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + 120 });
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURIComponent(name)}?token=${token}` });
    }
    if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && req.method === "GET") {
      const t = verify(url.searchParams.get("token"));
      if (!t || t.url !== `${m[1]}/${m[2]}`) return send(res, 400, { message: "invalid token" });
      const file = path.join(STORE, crypto.createHash("sha1").update(t.url).digest("hex"));
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(fs.readFileSync(file));
    }
    if ((m = p.match(/^\/object\/([^/]+)\/(.+)$/)) && req.method === "POST") {
      const [, bucket, name] = m;
      const data = await readBody(req);
      await asUser(claims, (c) => c.query("insert into storage.objects(bucket_id, name) values ($1, $2)", [bucket, name]));
      fs.writeFileSync(path.join(STORE, crypto.createHash("sha1").update(`${bucket}/${name}`).digest("hex")), data);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    }
    send(res, 404, { message: "not implemented in emulator" });
  } catch (e) {
    send(res, 403, { statusCode: "403", error: "Unauthorized", message: e.message });
  }
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS" });
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/rest/v1/")) {
    const token = bearer(req);
    const claims = token === process.env.SERVICE_KEY ? { role: "service_role" } : verify(token);
    return rest(req, res, url, claims);
  }
  if (url.pathname.startsWith("/auth/v1/")) return auth(req, res, url);
  if (url.pathname.startsWith("/storage/v1/")) return storage(req, res, url);
  send(res, 404, { message: "emulator: unknown route" });
}).listen(PORT, () => console.log(`supabase emulator on :${PORT}`));
