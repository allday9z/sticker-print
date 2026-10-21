// Sticker Print v2 (Smile, 19 Oct 2026) — product-box stickers printed by the branches.
//  - Admin (Smile only): product data (models / capacities / colours per model),
//    suppliers (+ logo), the sticker template per category (text, font, size,
//    colour, alignment, spacing) and the paper / label size.
//  - Branch staff (no login): choose model → capacity → colour → supplier, preview,
//    print. Every write endpoint checks the admin session on the server.
// Admin password: hashed in the DB. First login with the initial password
// (ADMIN_PASSWORD env) must set a new one before anything else is allowed.
// Storage: Postgres (DATABASE_URL), tables prefixed sticker_ (shared instance).
import { SQL } from "bun"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { resolve, sep } from "node:path"

const PORT = Number(process.env.PORT ?? 3000)
const PUBLIC = resolve(import.meta.dir, "public")
const sql = new SQL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres", { max: Number(process.env.PG_MAX ?? 5) })

const CATEGORIES = ["iPhone", "iPad", "Watch"]
// iPhone models confirmed by Smile (19 Oct 2026). Capacities / colours: entered later by Smile.
const IPHONE_MODELS = ["iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max", "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max", "iPhone 16e",
  "iPhone 17", "iPhone 17 Pro", "iPhone 17 Pro Max", "iPhone Air", "iPhone 17e", "iPhone 18 Pro", "iPhone 18 Pro Max", "iPhone Duo"]
// iPad models confirmed by Smile (19 Oct 2026, htask-1792372800760). Capacities / colours: entered later by Smile.
const IPAD_MODELS = ["iPad (A16)", "iPad mini (A17 Pro)", "iPad Air 11-inch (M2)", "iPad Air 13-inch (M2)", "iPad Air 11-inch (M3)", "iPad Air 13-inch (M3)",
  "iPad Air 11-inch (M4)", "iPad Air 13-inch (M4)", "iPad Pro 11-inch (M4)", "iPad Pro 13-inch (M4)", "iPad Pro 11-inch (M5)", "iPad Pro 13-inch (M5)"]
// Apple Watch models confirmed by Smile (19 Oct 2026, htask-1792373573801). Sizes / colours / bands: entered later by Smile.
const WATCH_MODELS = ["Apple Watch SE", "Apple Watch Series 6", "Apple Watch SE (2nd generation)", "Apple Watch Series 7", "Apple Watch Series 8", "Apple Watch Ultra",
  "Apple Watch Series 9", "Apple Watch Ultra 2", "Apple Watch Series 10", "Apple Watch SE 3", "Apple Watch Series 11", "Apple Watch Ultra 3", "Apple Watch Series 12", "Apple Watch Ultra 4"]
const SEED_MODELS: Record<string, string[]> = { iPhone: IPHONE_MODELS, iPad: IPAD_MODELS, Watch: WATCH_MODELS }
// Supplier → categories it applies to (null = all). Watch: Synnex / VST only.
const SUPPLIERS: [string, string[] | null][] = [["Synnex", null], ["VST", null], ["AIS", ["iPhone", "iPad"]]]
// Logos from Smile's Pages templates (Data/image1 = Synnex, Data/image2 = VST ECS).
const SUPPLIER_LOGOS: Record<string, string> = { Synnex: "logo-synnex.png", VST: "logo-vst.png" }
const logoFile = async (f: string) => new Uint8Array(await Bun.file(resolve(PUBLIC, f)).arrayBuffer())

// Sheet: A4 portrait, 5 × 10 = 50 labels of 38 × 27 mm (Smile, htask-1792553252649). Smile's Pages template is a
// 42 × 27.9 mm grid starting 9 mm from the top; each label sits centred in its grid cell (gaps 4 / 0.9 mm).
const DEFAULT_LAYOUT = { pageW: 210, pageH: 297, cols: 5, rows: 10, cellW: 38, cellH: 27, marginTop: 9.45, marginLeft: 2, gapX: 4, gapY: 0.9, offsetX: 0, offsetY: 0, showBorders: false }
type Layout = typeof DEFAULT_LAYOUT
const FONTS = ["Helvetica", "Noto Sans Thai", "Sarabun", "Prompt", "Kanit"]
const EL_TYPES = ["model", "capacity", "color", "band", "bandOption", "supplier", "text"]
// Default template = the look of Smile's sample (model / capacity / colour / logo, centred, 9 pt).
// Logos fit a box (logoW × logoH mm, aspect kept) = the template's sizes: Synnex 21.3 × 3.0, VST ECS 19.05 × 6.35.
const DEFAULT_TEMPLATE = {
  padding: 1.2, valign: "center", lineHeight: 1.15,
  elements: [
    { type: "model", font: "Helvetica", size: 9, bold: true, italic: false, color: "#000000", align: "center", mt: 0, prefix: "", suffix: "" },
    { type: "capacity", font: "Helvetica", size: 9, bold: false, italic: false, color: "#000000", align: "center", mt: 0.3, prefix: "", suffix: "" },
    { type: "color", font: "Helvetica", size: 9, bold: false, italic: false, color: "#000000", useItemColor: true, align: "center", mt: 0.3, prefix: "", suffix: "" },
    { type: "supplier", font: "Helvetica", size: 8, bold: true, italic: false, color: "#000000", align: "center", mt: 0.8, prefix: "", suffix: "", logoW: 21.3, logoH: 6.35 },
  ],
}

// Product data from Smile's Excel "Apple_Product_Master_Data.xlsx" (htask-1792553683856) → data/apple-master.json:
// capacities (Watch: case sizes), colours with the Excel font colour, Watch bands + size options. Runs once; only fills
// models that still have no capacities / colours / bands (never overwrites what the admin entered); missing models are added.
async function importMaster() {
  if (await getSetting("imported:apple-master")) return
  const d = JSON.parse(await Bun.file(resolve(import.meta.dir, "data", "apple-master.json")).text())
  const done: string[] = [], skipped: string[] = []
  await sql.begin(async (tx) => {
    for (const cat of Object.keys(SEED_MODELS)) for (const m of d[cat] ?? []) {
      let [row] = await tx`SELECT id FROM sticker_models WHERE category = ${cat} AND lower(name) = lower(${m.name}) ORDER BY id LIMIT 1`
      if (!row) {
        const [{ n }] = await tx`SELECT COALESCE(max(sort), -1) + 1 AS n FROM sticker_models WHERE category = ${cat}`;
        [row] = await tx`INSERT INTO sticker_models (category, name, sort) VALUES (${cat}, ${m.name}, ${n}) RETURNING id`
      }
      const [{ k }] = await tx`SELECT (SELECT count(*) FROM sticker_capacities WHERE model_id = ${row.id}) + (SELECT count(*) FROM sticker_colors WHERE model_id = ${row.id}) + (SELECT count(*) FROM sticker_bands WHERE model_id = ${row.id}) AS k`
      if (Number(k) > 0) { skipped.push(m.name); continue }
      for (const [i, v] of m.capacities.entries()) await tx`INSERT INTO sticker_capacities (model_id, value, sort) VALUES (${row.id}, ${v}, ${i})`
      for (const [i, c] of m.colors.entries()) await tx`INSERT INTO sticker_colors (model_id, name, hex, sizes, sort) VALUES (${row.id}, ${c.name}, ${c.hex}, ${JSON.stringify(c.sizes ?? [])}::jsonb, ${i})`
      for (const [i, b] of (m.bands ?? []).entries()) await tx`INSERT INTO sticker_bands (model_id, name, sizes, options, sort) VALUES (${row.id}, ${b.name}, ${JSON.stringify(b.sizes ?? [])}::jsonb, ${JSON.stringify(b.options ?? [])}::jsonb, ${i})`
      done.push(m.name)
    }
  })
  await setSetting("imported:apple-master", { at: new Date().toISOString(), filled: done.length, skipped })
  console.log("[db] product master imported:", done.length, "models filled", skipped.length ? "· kept existing: " + skipped.join(", ") : "")
}

async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS sticker_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL)`
  await sql`CREATE TABLE IF NOT EXISTS sticker_models (id SERIAL PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, sort INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`
  await sql`CREATE TABLE IF NOT EXISTS sticker_capacities (id SERIAL PRIMARY KEY, model_id INT NOT NULL REFERENCES sticker_models(id) ON DELETE CASCADE, value TEXT NOT NULL, sort INT NOT NULL DEFAULT 0)`
  await sql`CREATE TABLE IF NOT EXISTS sticker_colors (id SERIAL PRIMARY KEY, model_id INT NOT NULL REFERENCES sticker_models(id) ON DELETE CASCADE, name TEXT NOT NULL, hex TEXT NOT NULL DEFAULT '#000000', sort INT NOT NULL DEFAULT 0)`
  await sql`CREATE TABLE IF NOT EXISTS sticker_suppliers (id SERIAL PRIMARY KEY, name TEXT NOT NULL, logo BYTEA, logo_mime TEXT, sort INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`
  // Watch (Oct 2026): colours / bands can be limited to some case sizes ([] = all sizes); bands may have
  // sub-options (e.g. S/M, M/L); suppliers can be limited to some categories (NULL = all).
  await sql`ALTER TABLE sticker_colors ADD COLUMN IF NOT EXISTS sizes JSONB NOT NULL DEFAULT '[]'::jsonb`
  await sql`CREATE TABLE IF NOT EXISTS sticker_bands (id SERIAL PRIMARY KEY, model_id INT NOT NULL REFERENCES sticker_models(id) ON DELETE CASCADE, name TEXT NOT NULL,
    sizes JSONB NOT NULL DEFAULT '[]'::jsonb, options JSONB NOT NULL DEFAULT '[]'::jsonb, sort INT NOT NULL DEFAULT 0)`
  await sql`ALTER TABLE sticker_suppliers ADD COLUMN IF NOT EXISTS categories JSONB`
  // Each category's confirmed model list is inserted once (a flag keeps deleted models from coming back).
  for (const [cat, list] of Object.entries(SEED_MODELS)) {
    if (await getSetting("seeded:" + cat)) continue
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sticker_models WHERE category = ${cat}`
    if (n === 0) { for (const [i, m] of list.entries()) await sql`INSERT INTO sticker_models (category, name, sort) VALUES (${cat}, ${m}, ${i})`; console.log("[db] seeded", cat, "models", list.length) }
    await setSetting("seeded:" + cat, true)
  }
  await importMaster()
  const [{ s }] = await sql`SELECT count(*)::int AS s FROM sticker_suppliers`
  if (s === 0) {
    for (const [i, [name, cats]] of SUPPLIERS.entries()) {
      const c = cats ? JSON.stringify(cats) : null, f = SUPPLIER_LOGOS[name]
      if (f) await sql`INSERT INTO sticker_suppliers (name, logo, logo_mime, sort, categories) VALUES (${name}, ${await logoFile(f)}, 'image/png', ${i}, ${c}::jsonb)`
      else await sql`INSERT INTO sticker_suppliers (name, sort, categories) VALUES (${name}, ${i}, ${c}::jsonb)`
    }
    await setSetting("migrated:vst-logo", true)
    console.log("[db] seeded suppliers", SUPPLIERS.map((x) => x[0]).join(", "))
    await setSetting("migrated:supplier-categories", true)
  }
  // Existing installs: AIS is not a Watch supplier (Smile's Watch spec lists Synnex / VST) — once.
  if (!(await getSetting("migrated:supplier-categories"))) {
    await sql`UPDATE sticker_suppliers SET categories = '["iPhone","iPad"]'::jsonb WHERE lower(name) = 'ais' AND categories IS NULL`
    await setSetting("migrated:supplier-categories", true)
    console.log("[db] AIS limited to iPhone / iPad")
  }
  // Existing installs (htask-1792553252649), once each: VST gets the VST ECS logo from Smile's template (only if it has none);
  // the layout moves to 38 × 27 mm labels on the same grid; supplier logos get the template's box size.
  if (!(await getSetting("migrated:vst-logo"))) {
    const r = await sql`UPDATE sticker_suppliers SET logo = ${await logoFile(SUPPLIER_LOGOS.VST)}, logo_mime = 'image/png' WHERE lower(name) IN ('vst', 'vst ecs') AND logo IS NULL`
    await setSetting("migrated:vst-logo", true); console.log("[db] VST logo added:", r.count)
  }
  if (!(await getSetting("migrated:label-38x27"))) {
    const l = await getSetting("layout")
    // Only a layout still on the old 42 × 27.9 grid is converted; offsets / page size / borders are kept.
    if (l && l.cellW === 42 && l.cellH === 27.9 && !l.gapX && !l.gapY && l.cols === 5 && l.rows === 10) {
      await setSetting("layout", { ...l, cellW: 38, cellH: 27, gapX: 4, gapY: 0.9, marginLeft: (l.marginLeft || 0) + 2, marginTop: (l.marginTop ?? 9) + 0.45 })
      console.log("[db] layout converted to 38 x 27 mm labels")
    }
    await setSetting("migrated:label-38x27", true)
  }
  if (!(await getSetting("migrated:logo-box"))) {
    for (const cat of Object.keys(SEED_MODELS)) {
      const t = await getSetting("template:" + cat); if (!t?.elements) continue
      let n = 0
      for (const e of t.elements) if (e.type === "supplier" && e.logoW === undefined && (e.logoH === 2.6 || e.logoH === 2.4)) { e.logoW = 21.3; e.logoH = 6.35; n++ }
      if (n) { await setSetting("template:" + cat, t); console.log("[db] logo box set on template", cat) }
    }
    await setSetting("migrated:logo-box", true)
  }
  // Admin account: created from ADMIN_PASSWORD once, must be changed at first login.
  if (!(await getSetting("admin")) && process.env.ADMIN_PASSWORD) {
    await setSetting("admin", { hash: await Bun.password.hash(process.env.ADMIN_PASSWORD), mustChange: true, secret: randomBytes(32).toString("base64url"), ver: 1 })
    console.log("[db] admin account initialised (must change password at first login)")
  }
}
const parse = (v: any) => { let x = v; while (typeof x === "string") x = JSON.parse(x); return x }
async function getSetting(key: string): Promise<any> { const [r] = await sql`SELECT value::text AS v FROM sticker_settings WHERE key = ${key}`; return r ? parse(r.v) : null }
async function setSetting(key: string, value: any) { await sql`INSERT INTO sticker_settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value` }
async function getLayout(): Promise<Layout> { return { ...DEFAULT_LAYOUT, ...((await getSetting("layout")) ?? {}) } }
// Watch default: model / case size / case colour / band (+ option) / supplier.
const el = (type: string, x: any = {}) => ({ type, font: "Helvetica", size: 8.5, bold: false, italic: false, color: "#000000", align: "center", mt: 0.25, prefix: "", suffix: "", ...x })
const DEFAULT_TEMPLATES: Record<string, any> = {
  Watch: { padding: 1.2, valign: "center", lineHeight: 1.12, elements: [el("model", { bold: true, mt: 0 }), el("capacity"), el("color", { useItemColor: true }), el("band"), el("bandOption"), el("supplier", { size: 8, bold: true, mt: 0.6, logoW: 21.3, logoH: 6.35 })] },
}
async function getTemplate(cat: string) { return (await getSetting("template:" + cat)) ?? DEFAULT_TEMPLATES[cat] ?? DEFAULT_TEMPLATE }

/* ---------- admin session: signed cookie, invalidated when the password changes ---------- */
async function adminState(): Promise<any> { return await getSetting("admin") }
function sign(secret: string, v: string) { return createHmac("sha256", secret).update(v).digest("base64url") }
async function session(req: Request): Promise<{ ok: boolean; mustChange: boolean }> {
  const a = await adminState(); if (!a) return { ok: false, mustChange: false }
  const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)sp_admin=([^;]+)/); if (!m) return { ok: false, mustChange: false }
  const [exp, ver, sig] = m[1].split(".")
  if (!exp || !sig || Number(exp) < Date.now() || Number(ver) !== a.ver) return { ok: false, mustChange: false }
  const x = Buffer.from(sig), y = Buffer.from(sign(a.secret, exp + "." + ver))
  return { ok: x.length === y.length && timingSafeEqual(x, y), mustChange: !!a.mustChange }
}
function cookieFor(a: any, secure: boolean) { const exp = String(Date.now() + 12 * 3600_000); const v = exp + "." + a.ver; return `sp_admin=${v}.${sign(a.secret, v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? "; Secure" : ""}` }
const loginHits = new Map<string, number[]>()
function loginAllowed(ip: string) { const now = Date.now(), h = (loginHits.get(ip) ?? []).filter((t) => now - t < 600_000); h.push(now); loginHits.set(ip, h); return h.length <= 10 }

/* ---------- helpers ---------- */
const json = (d: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } })
const str = (v: any, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max)
const HEX = /^#[0-9a-fA-F]{6}$/
const num = (v: any, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : def }
function cleanTemplate(b: any) {
  const els = (Array.isArray(b?.elements) ? b.elements : []).slice(0, 10).filter((e: any) => EL_TYPES.includes(e?.type)).map((e: any) => ({
    type: e.type, font: FONTS.includes(e.font) ? e.font : "Helvetica", size: num(e.size, 4, 30, 9), bold: !!e.bold, italic: !!e.italic,
    color: HEX.test(e.color) ? e.color : "#000000", align: ["left", "center", "right"].includes(e.align) ? e.align : "center", mt: num(e.mt, 0, 20, 0),
    // prefix / suffix keep their spaces (e.g. "- ")
    prefix: String(e.prefix ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 30), suffix: String(e.suffix ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 30),
    ...(e.type === "color" ? { useItemColor: e.useItemColor !== false } : {}),
    ...(e.type === "supplier" ? { logoW: num(e.logoW, 3, 60, 21.3), logoH: num(e.logoH, 1, 20, 6.35) } : {}), ...(e.type === "text" ? { text: str(e.text, 80) } : {}),
  }))
  if (!els.length) throw new Error("เทมเพลตต้องมีอย่างน้อย 1 บรรทัด")
  return { padding: num(b?.padding, 0, 10, 1.2), valign: b?.valign === "top" ? "top" : "center", lineHeight: num(b?.lineHeight, 0.8, 2, 1.15), elements: els }
}
async function catalog(includeInactive: boolean) {
  const models = includeInactive ? await sql`SELECT * FROM sticker_models ORDER BY category, sort, id` : await sql`SELECT * FROM sticker_models WHERE active ORDER BY category, sort, id`
  const caps = await sql`SELECT model_id, value FROM sticker_capacities ORDER BY sort, id`
  const cols = await sql`SELECT model_id, name, hex, sizes::text AS sizes FROM sticker_colors ORDER BY sort, id`
  const bands = await sql`SELECT model_id, name, sizes::text AS sizes, options::text AS options FROM sticker_bands ORDER BY sort, id`
  const sups = includeInactive ? await sql`SELECT id, name, active, logo IS NOT NULL AS has_logo, categories::text AS categories FROM sticker_suppliers ORDER BY sort, id`
    : await sql`SELECT id, name, active, logo IS NOT NULL AS has_logo, categories::text AS categories FROM sticker_suppliers WHERE active ORDER BY sort, id`
  const templates: Record<string, any> = {}
  for (const c of CATEGORIES) templates[c] = await getTemplate(c)
  return {
    categories: CATEGORIES,
    models: models.map((m: any) => ({ id: m.id, category: m.category, name: m.name, active: m.active,
      capacities: caps.filter((c: any) => c.model_id === m.id).map((c: any) => c.value),
      colors: cols.filter((c: any) => c.model_id === m.id).map((c: any) => ({ name: c.name, hex: c.hex, sizes: parse(c.sizes) ?? [] })),
      bands: bands.filter((b: any) => b.model_id === m.id).map((b: any) => ({ name: b.name, sizes: parse(b.sizes) ?? [], options: parse(b.options) ?? [] })) })),
    suppliers: sups.map((s: any) => ({ id: s.id, name: s.name, active: s.active, logo: s.has_logo ? `/api/suppliers/${s.id}/logo` : null, categories: s.categories ? parse(s.categories) : null })),
    templates, layout: await getLayout(), fonts: FONTS,
  }
}
function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png"
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"
  return null
}
async function reorder(table: "sticker_models" | "sticker_suppliers", id: number, dir: string) {
  const [cur] = table === "sticker_models" ? await sql`SELECT id, category FROM sticker_models WHERE id = ${id}` : await sql`SELECT id FROM sticker_suppliers WHERE id = ${id}`
  if (!cur) return
  const rows = table === "sticker_models" ? await sql`SELECT id FROM sticker_models WHERE category = ${cur.category} ORDER BY sort, id` : await sql`SELECT id FROM sticker_suppliers ORDER BY sort, id`
  const ids = rows.map((r: any) => r.id), i = ids.indexOf(id), j = i + (dir === "up" ? -1 : 1)
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  for (const [k, x] of ids.entries()) { if (table === "sticker_models") await sql`UPDATE sticker_models SET sort = ${k} WHERE id = ${x}`; else await sql`UPDATE sticker_suppliers SET sort = ${k} WHERE id = ${x}` }
}

async function api(req: Request, url: URL, ip: string): Promise<Response> {
  const p = url.pathname, m = req.method
  if (m !== "GET") {   // cookie auth → reject cross-site writes
    const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
    if (origin && host && new URL(origin).host !== host) return json({ error: "forbidden" }, 403)
  }
  const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"

  /* public, read-only */
  if (p === "/api/catalog" && m === "GET") { const s = await session(req); return json({ ...(await catalog(false)), admin: s.ok, mustChange: s.ok && s.mustChange }) }
  const lg = p.match(/^\/api\/suppliers\/(\d+)\/logo$/)
  if (lg && m === "GET") {
    const [r] = await sql`SELECT logo, logo_mime FROM sticker_suppliers WHERE id = ${Number(lg[1])}`
    if (!r?.logo) return new Response("Not Found", { status: 404 })
    return new Response(r.logo, { headers: { "Content-Type": r.logo_mime, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } })
  }

  /* admin auth */
  if (p === "/api/admin/login" && m === "POST") {
    if (!loginAllowed(ip)) return json({ error: "ลองบ่อยเกินไป กรุณารอ 10 นาที" }, 429)
    const a = await adminState()
    if (!a) return json({ error: "ยังไม่ได้ตั้งค่าบัญชีผู้ดูแล" }, 503)
    const b: any = await req.json().catch(() => ({}))
    if (!(await Bun.password.verify(String(b.password ?? ""), a.hash))) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401)
    return json({ ok: true, mustChange: !!a.mustChange }, 200, { "Set-Cookie": cookieFor(a, secure) })
  }
  if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "Set-Cookie": "sp_admin=; Path=/; Max-Age=0" })
  if (!p.startsWith("/api/admin/")) return json({ error: "not found" }, 404)
  const s = await session(req)
  if (!s.ok) return json({ error: "auth" }, 401)
  if (p === "/api/admin/password" && m === "POST") {
    const b: any = await req.json().catch(() => ({}))
    const a = await adminState()
    if (!(await Bun.password.verify(String(b.current ?? ""), a.hash))) return json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, 400)
    const next = String(b.next ?? "")
    if (next.length < 8) return json({ error: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร" }, 400)
    if (await Bun.password.verify(next, a.hash)) return json({ error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม" }, 400)
    const na = { hash: await Bun.password.hash(next), mustChange: false, secret: randomBytes(32).toString("base64url"), ver: (a.ver ?? 1) + 1 }
    await setSetting("admin", na)   // new secret + version → every old session (and the shared initial password) stops working
    console.log("[admin] password changed")
    return json({ ok: true }, 200, { "Set-Cookie": cookieFor(na, secure) })
  }
  if (s.mustChange) return json({ error: "mustchange" }, 403)   // nothing else until the initial password is replaced

  if (p === "/api/admin/catalog" && m === "GET") return json(await catalog(true))
  // models
  if (p === "/api/admin/models" && m === "POST") {
    const b: any = await req.json().catch(() => ({}))
    const category = CATEGORIES.includes(b.category) ? b.category : "", name = str(b.name, 60)
    if (!category || !name) return json({ error: "กรุณาเลือกหมวดและใส่ชื่อรุ่น" }, 400)
    const [d] = await sql`SELECT 1 FROM sticker_models WHERE category = ${category} AND lower(name) = lower(${name})`
    if (d) return json({ error: "มีรุ่นนี้อยู่แล้ว" }, 400)
    const [{ n }] = await sql`SELECT COALESCE(max(sort), -1) + 1 AS n FROM sticker_models WHERE category = ${category}`
    const [r] = await sql`INSERT INTO sticker_models (category, name, sort) VALUES (${category}, ${name}, ${n}) RETURNING id`
    return json({ id: r.id })
  }
  const mm = p.match(/^\/api\/admin\/models\/(\d+)(\/move)?$/)
  if (mm && m === "PUT") {
    const id = Number(mm[1]), b: any = await req.json().catch(() => ({}))
    const name = str(b.name, 60); if (!name) return json({ error: "กรุณาใส่ชื่อรุ่น" }, 400)
    const caps = [...new Set((Array.isArray(b.capacities) ? b.capacities : []).map((v: any) => str(v, 20)).filter(Boolean))].slice(0, 12) as string[]
    // sizes on a colour / band must be among this model's sizes ([] = all sizes)
    const onlySizes = (v: any) => [...new Set((Array.isArray(v) ? v : []).map((x: any) => str(x, 20)).filter((x: string) => caps.includes(x)))]
    const cols = (Array.isArray(b.colors) ? b.colors : []).slice(0, 24).map((c: any) => ({ name: str(c?.name, 40), hex: HEX.test(c?.hex) ? c.hex : "#000000", sizes: onlySizes(c?.sizes) })).filter((c: any) => c.name)
    const bnds = (Array.isArray(b.bands) ? b.bands : []).slice(0, 30).map((x: any) => ({ name: str(x?.name, 40), sizes: onlySizes(x?.sizes),
      options: [...new Set((Array.isArray(x?.options) ? x.options : String(x?.options ?? "").split(",")).map((o: any) => str(o, 30)).filter(Boolean))].slice(0, 12) })).filter((x: any) => x.name)
    await sql.begin(async (tx) => {
      const [r] = await tx`UPDATE sticker_models SET name = ${name}, active = ${b.active !== false} WHERE id = ${id} RETURNING id`
      if (!r) throw new Error("ไม่พบรุ่นนี้")
      await tx`DELETE FROM sticker_capacities WHERE model_id = ${id}`
      for (const [i, v] of caps.entries()) await tx`INSERT INTO sticker_capacities (model_id, value, sort) VALUES (${id}, ${v}, ${i})`
      await tx`DELETE FROM sticker_colors WHERE model_id = ${id}`
      for (const [i, c] of cols.entries()) await tx`INSERT INTO sticker_colors (model_id, name, hex, sizes, sort) VALUES (${id}, ${c.name}, ${c.hex}, ${JSON.stringify(c.sizes)}::jsonb, ${i})`
      await tx`DELETE FROM sticker_bands WHERE model_id = ${id}`
      for (const [i, x] of bnds.entries()) await tx`INSERT INTO sticker_bands (model_id, name, sizes, options, sort) VALUES (${id}, ${x.name}, ${JSON.stringify(x.sizes)}::jsonb, ${JSON.stringify(x.options)}::jsonb, ${i})`
    })
    return json({ ok: true })
  }
  if (mm && m === "DELETE") { await sql`DELETE FROM sticker_models WHERE id = ${Number(mm[1])}`; return json({ ok: true }) }
  if (mm && mm[2] && m === "POST") { const b: any = await req.json().catch(() => ({})); await reorder("sticker_models", Number(mm[1]), b.dir); return json({ ok: true }) }
  // suppliers
  if (p === "/api/admin/suppliers" && m === "POST") {
    const b: any = await req.json().catch(() => ({})); const name = str(b.name, 40)
    if (!name) return json({ error: "กรุณาใส่ชื่อซัพพลายเออร์" }, 400)
    const [{ n }] = await sql`SELECT COALESCE(max(sort), -1) + 1 AS n FROM sticker_suppliers`
    const [r] = await sql`INSERT INTO sticker_suppliers (name, sort) VALUES (${name}, ${n}) RETURNING id`
    return json({ id: r.id })
  }
  const sm = p.match(/^\/api\/admin\/suppliers\/(\d+)(\/move|\/logo)?$/)
  if (sm && !sm[2] && m === "PUT") {
    const b: any = await req.json().catch(() => ({})); const name = str(b.name, 40)
    if (!name) return json({ error: "กรุณาใส่ชื่อซัพพลายเออร์" }, 400)
    const cats = Array.isArray(b.categories) ? CATEGORIES.filter((c) => b.categories.includes(c)) : null
    if (cats && !cats.length) return json({ error: "เลือกอย่างน้อย 1 หมวด" }, 400)
    const catJson = cats && cats.length < CATEGORIES.length ? JSON.stringify(cats) : null   // all categories = NULL
    await sql`UPDATE sticker_suppliers SET name = ${name}, active = ${b.active !== false}, categories = ${catJson}::jsonb WHERE id = ${Number(sm[1])}`
    return json({ ok: true })
  }
  if (sm && !sm[2] && m === "DELETE") { await sql`DELETE FROM sticker_suppliers WHERE id = ${Number(sm[1])}`; return json({ ok: true }) }
  if (sm && sm[2] === "/move" && m === "POST") { const b: any = await req.json().catch(() => ({})); await reorder("sticker_suppliers", Number(sm[1]), b.dir); return json({ ok: true }) }
  if (sm && sm[2] === "/logo" && m === "POST") {
    const form = await req.formData().catch(() => null), f = form?.get("logo")
    if (!(f instanceof File) || !f.size) return json({ error: "กรุณาเลือกไฟล์โลโก้" }, 400)
    if (f.size > 2 * 1024 * 1024) return json({ error: "ไฟล์โลโก้ใหญ่เกิน 2 MB" }, 400)
    const bytes = new Uint8Array(await f.arrayBuffer()), mime = sniffImage(bytes)
    if (!mime) return json({ error: "โลโก้ต้องเป็นไฟล์ PNG, JPG หรือ WEBP" }, 400)
    await sql`UPDATE sticker_suppliers SET logo = ${bytes}, logo_mime = ${mime} WHERE id = ${Number(sm[1])}`
    return json({ ok: true })
  }
  if (sm && sm[2] === "/logo" && m === "DELETE") { await sql`UPDATE sticker_suppliers SET logo = NULL, logo_mime = NULL WHERE id = ${Number(sm[1])}`; return json({ ok: true }) }
  // template per category
  const tm = p.match(/^\/api\/admin\/template\/(iPhone|iPad|Watch)$/)
  if (tm && m === "PUT") {
    try { const t = cleanTemplate(await req.json().catch(() => ({}))); await setSetting("template:" + tm[1], t); return json(t) }
    catch (e: any) { return json({ error: e.message }, 400) }
  }
  // paper / labels
  if (p === "/api/admin/layout" && m === "PUT") {
    const b: any = await req.json().catch(() => ({}))
    const n = (k: keyof Layout, lo: number, hi: number) => { const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`ค่า ${k} ต้องอยู่ระหว่าง ${lo}–${hi}`); return Math.round(v * 100) / 100 }
    try {
      const v: Layout = { pageW: n("pageW", 50, 420), pageH: n("pageH", 50, 600), cols: Math.round(n("cols", 1, 12)), rows: Math.round(n("rows", 1, 30)), cellW: n("cellW", 5, 400), cellH: n("cellH", 5, 600),
        marginTop: n("marginTop", 0, 200), marginLeft: n("marginLeft", 0, 200), gapX: n("gapX", 0, 50), gapY: n("gapY", 0, 50), offsetX: n("offsetX", -20, 20), offsetY: n("offsetY", -20, 20), showBorders: !!b.showBorders }
      if (v.marginLeft + v.cols * v.cellW + (v.cols - 1) * v.gapX > v.pageW + 0.5) throw new Error(`ความกว้างรวมเกินขนาดกระดาษ (${v.pageW} มม.)`)
      if (v.marginTop + v.rows * v.cellH + (v.rows - 1) * v.gapY > v.pageH + 0.5) throw new Error(`ความสูงรวมเกินขนาดกระดาษ (${v.pageH} มม.)`)
      await setSetting("layout", v); return json(v)
    } catch (e: any) { return json({ error: e.message }, 400) }
  }
  return json({ error: "not found" }, 404)
}

async function serveStatic(pathname: string): Promise<Response> {
  const full = resolve(PUBLIC, "." + (pathname === "/" ? "/index.html" : pathname))
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
      if (url.pathname.startsWith("/api/")) return await api(req, url, req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "?")
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 })
      return await serveStatic(url.pathname)
    } catch (e: any) {
      console.error("[error]", url.pathname, e)
      return json({ error: e?.message && /ไม่พบ/.test(e.message) ? e.message : "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่" }, 500)
    }
  },
})
console.log(`[sticker-print] v2 listening on :${PORT}`)
