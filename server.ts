// Sticker Print — templates for product-box stickers (iPhone / iPad / Watch),
// laid out on an A4 label sheet (default 5 × 10 = 50 labels, 4.2 × 2.79 cm) and
// printed by the branches straight from the browser.
//  - Branches: no login — pick templates + quantities, preview, print.
//  - Admin (ADMIN_PASSWORD): create / edit templates, sheet calibration.
// Storage: Postgres (DATABASE_URL), tables prefixed sticker_ (shared instance).
import { SQL } from "bun"
import { createHmac, timingSafeEqual } from "node:crypto"
import { resolve, sep } from "node:path"

const PORT = Number(process.env.PORT ?? 3000)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ""
const SECRET = process.env.SESSION_SECRET ?? ADMIN_PASSWORD + ":sticker-print"
const PUBLIC = resolve(import.meta.dir, "public")
const sql = new SQL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres", { max: Number(process.env.PG_MAX ?? 5) })

const CATEGORIES = ["iPhone", "iPad", "Watch"]
// Default sheet: A4 portrait, 5 columns × 10 rows, label 42 × 27.9 mm, centred.
const DEFAULT_LAYOUT = { cols: 5, rows: 10, cellW: 42, cellH: 27.9, marginTop: 9, marginLeft: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0, padding: 1.2, showBorders: false }
type Layout = typeof DEFAULT_LAYOUT

async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS sticker_templates (
    id SERIAL PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, data JSONB NOT NULL,
    sort INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  await sql`CREATE TABLE IF NOT EXISTS sticker_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL)`
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM sticker_templates`
  if (n === 0) {
    // Starter templates = the examples in Smile's Pages file.
    const seed = [
      { category: "iPhone", name: "iPhone Duo", data: { model: "iPhone Duo", bold: false, spec: "- 256GB 512GB 1TB 2TB", colors: [{ name: "Night Sky", hex: "#3d4466" }, { name: "Star White", hex: "#b8bcc4" }], extra: "", logo: true } },
      { category: "Watch", name: "Watch SE 3", data: { model: "Watch SE 3", bold: true, spec: "GPS / Cell", colors: [{ name: "Starlight", hex: "#3d4466" }, { name: "Midnight", hex: "#b8bcc4" }], extra: "S/M - M/L\n40\" / 44\"", logo: true } },
    ]
    for (const [i, t] of seed.entries()) await sql`INSERT INTO sticker_templates (category, name, data, sort) VALUES (${t.category}, ${t.name}, ${JSON.stringify(t.data)}::jsonb, ${i})`
    console.log("[db] seeded templates", seed.length)
  }
}
const parse = (v: any) => { let x = v; while (typeof x === "string") x = JSON.parse(x); return x }
async function getLayout(): Promise<Layout> {
  const [r] = await sql`SELECT value::text AS v FROM sticker_settings WHERE key = 'layout'`
  return { ...DEFAULT_LAYOUT, ...(r ? parse(r.v) : {}) }
}

/* ---------- admin session (signed cookie) ---------- */
const sign = (v: string) => createHmac("sha256", SECRET).update(v).digest("base64url")
function makeToken(): string { const exp = String(Date.now() + 12 * 3600_000); return exp + "." + sign(exp) }
function isAdmin(req: Request): boolean {
  if (!ADMIN_PASSWORD) return false
  const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)sp_admin=([^;]+)/)
  if (!m) return false
  const [exp, sig] = m[1].split(".")
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const a = Buffer.from(sig), b = Buffer.from(sign(exp))
  return a.length === b.length && timingSafeEqual(a, b)
}
const loginHits = new Map<string, number[]>()
function loginAllowed(ip: string) {
  const now = Date.now(), h = (loginHits.get(ip) ?? []).filter((t) => now - t < 600_000)
  h.push(now); loginHits.set(ip, h); return h.length <= 10
}

/* ---------- helpers ---------- */
const json = (d: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } })
const str = (v: any, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max)
const HEX = /^#[0-9a-fA-F]{6}$/
function cleanTemplate(b: any): { category: string; name: string; data: any } | string {
  const category = CATEGORIES.includes(b?.category) ? b.category : ""
  if (!category) return "เลือกหมวด iPhone / iPad / Watch"
  const model = str(b?.data?.model, 60)
  if (!model) return "กรุณาใส่ชื่อรุ่น"
  const colors = (Array.isArray(b?.data?.colors) ? b.data.colors : []).slice(0, 8)
    .map((c: any) => ({ name: str(c?.name, 30), hex: HEX.test(c?.hex) ? c.hex : "#1d1d1f" })).filter((c: any) => c.name)
  const data = {
    model, bold: !!b?.data?.bold, spec: str(b?.data?.spec, 120), colors,
    extra: String(b?.data?.extra ?? "").split("\n").map((l) => str(l, 60)).filter(Boolean).slice(0, 4).join("\n"),
    logo: b?.data?.logo !== false, size: [0, 1, 2].includes(Number(b?.data?.size)) ? Number(b.data.size) : 1,
  }
  return { category, name: str(b?.name, 80) || model, data }
}
async function listTemplates(all: boolean) {
  const rows = all
    ? await sql`SELECT id, category, name, data::text AS data, sort, active, updated_at FROM sticker_templates ORDER BY category, sort, id`
    : await sql`SELECT id, category, name, data::text AS data, sort, active, updated_at FROM sticker_templates WHERE active ORDER BY category, sort, id`
  return rows.map((r: any) => ({ ...r, data: parse(r.data) }))
}

async function api(req: Request, url: URL, ip: string): Promise<Response> {
  const p = url.pathname, m = req.method
  // Cookie auth → reject cross-site writes.
  if (m !== "GET") {
    const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
    if (origin && host && new URL(origin).host !== host) return json({ error: "forbidden" }, 403)
  }
  if (p === "/api/config" && m === "GET") return json({ categories: CATEGORIES, layout: await getLayout(), templates: await listTemplates(false), admin: isAdmin(req), adminEnabled: !!ADMIN_PASSWORD })
  if (p === "/api/admin/login" && m === "POST") {
    if (!loginAllowed(ip)) return json({ error: "ลองบ่อยเกินไป กรุณารอ 10 นาที" }, 429)
    const b: any = await req.json().catch(() => ({}))
    if (!ADMIN_PASSWORD || String(b.password ?? "") !== ADMIN_PASSWORD) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401)
    const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"
    return json({ ok: true }, 200, { "Set-Cookie": `sp_admin=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? "; Secure" : ""}` })
  }
  if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "Set-Cookie": "sp_admin=; Path=/; Max-Age=0" })

  if (!p.startsWith("/api/admin/")) return json({ error: "not found" }, 404)
  if (!isAdmin(req)) return json({ error: "auth" }, 401)
  if (p === "/api/admin/templates" && m === "GET") return json(await listTemplates(true))
  if (p === "/api/admin/templates" && m === "POST") {
    const t = cleanTemplate(await req.json().catch(() => ({})))
    if (typeof t === "string") return json({ error: t }, 400)
    const [{ s }] = await sql`SELECT COALESCE(max(sort), -1) + 1 AS s FROM sticker_templates WHERE category = ${t.category}`
    const [r] = await sql`INSERT INTO sticker_templates (category, name, data, sort) VALUES (${t.category}, ${t.name}, ${JSON.stringify(t.data)}::jsonb, ${s}) RETURNING id`
    return json({ id: r.id })
  }
  const tm = p.match(/^\/api\/admin\/templates\/(\d+)(\/move)?$/)
  if (tm && m === "PUT" && !tm[2]) {
    const b: any = await req.json().catch(() => ({}))
    const t = cleanTemplate(b)
    if (typeof t === "string") return json({ error: t }, 400)
    const [r] = await sql`UPDATE sticker_templates SET category = ${t.category}, name = ${t.name}, data = ${JSON.stringify(t.data)}::jsonb, active = ${b.active !== false}, updated_at = now() WHERE id = ${Number(tm[1])} RETURNING id`
    return r ? json({ ok: true }) : json({ error: "ไม่พบเทมเพลต" }, 404)
  }
  if (tm && m === "DELETE") { await sql`DELETE FROM sticker_templates WHERE id = ${Number(tm[1])}`; return json({ ok: true }) }
  if (tm && tm[2] && m === "POST") {
    const b: any = await req.json().catch(() => ({}))
    const [cur] = await sql`SELECT id, category, sort FROM sticker_templates WHERE id = ${Number(tm[1])}`
    if (!cur) return json({ error: "ไม่พบเทมเพลต" }, 404)
    const list = await sql`SELECT id FROM sticker_templates WHERE category = ${cur.category} ORDER BY sort, id`
    const ids = list.map((r: any) => r.id), i = ids.indexOf(cur.id), j = i + (b.dir === "up" ? -1 : 1)
    if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; for (const [k, id] of ids.entries()) await sql`UPDATE sticker_templates SET sort = ${k} WHERE id = ${id}` }
    return json({ ok: true })
  }
  if (p === "/api/admin/layout" && m === "PUT") {
    const b: any = await req.json().catch(() => ({}))
    const num = (k: keyof Layout, lo: number, hi: number) => { const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`ค่า ${k} ต้องอยู่ระหว่าง ${lo}–${hi}`); return Math.round(v * 100) / 100 }
    try {
      const v: Layout = {
        cols: Math.round(num("cols", 1, 10)), rows: Math.round(num("rows", 1, 20)), cellW: num("cellW", 10, 210), cellH: num("cellH", 10, 297),
        marginTop: num("marginTop", 0, 100), marginLeft: num("marginLeft", 0, 100), gapX: num("gapX", 0, 50), gapY: num("gapY", 0, 50),
        offsetX: num("offsetX", -20, 20), offsetY: num("offsetY", -20, 20), padding: num("padding", 0, 10), showBorders: !!b.showBorders,
      }
      if (v.marginLeft + v.cols * v.cellW + (v.cols - 1) * v.gapX > 210.5) throw new Error("ความกว้างรวมเกินกระดาษ A4 (210 มม.)")
      if (v.marginTop + v.rows * v.cellH + (v.rows - 1) * v.gapY > 297.5) throw new Error("ความสูงรวมเกินกระดาษ A4 (297 มม.)")
      await sql`INSERT INTO sticker_settings (key, value) VALUES ('layout', ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      return json(v)
    } catch (e: any) { return json({ error: e.message }, 400) }
  }
  return json({ error: "not found" }, 404)
}

async function serveStatic(pathname: string): Promise<Response> {
  const file = pathname === "/" ? "/index.html" : pathname
  const full = resolve(PUBLIC, "." + file)
  if (full !== PUBLIC && !full.startsWith(PUBLIC + sep)) return new Response("Not Found", { status: 404 })
  const f = Bun.file(full)
  if (!(await f.exists())) return new Response("Not Found", { status: 404 })
  return new Response(f, { headers: { "Cache-Control": /\.(html|js|css)$/.test(full) ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff" } })
}

await initDB()
Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/health") return new Response("ok")
    try {
      if (url.pathname.startsWith("/api/")) {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "?"
        return await api(req, url, ip)
      }
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 })
      return await serveStatic(url.pathname)
    } catch (e) {
      console.error("[error]", url.pathname, e)
      return json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่" }, 500)
    }
  },
})
console.log(`[sticker-print] listening on :${PORT}${ADMIN_PASSWORD ? "" : " (ADMIN_PASSWORD not set — template editing disabled)"}`)
