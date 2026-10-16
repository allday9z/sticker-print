/* Sticker Print — single-page client. Branches print without login; template
   editing and sheet calibration need the admin password (checked on the server). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var state = { cfg: null, cat: "all", qty: {}, start: 1 };
  try { state.qty = JSON.parse(localStorage.getItem("sp_qty") || "{}"); state.start = Number(localStorage.getItem("sp_start") || 1) || 1; } catch (e) {}
  function saveSel() { try { localStorage.setItem("sp_qty", JSON.stringify(state.qty)); localStorage.setItem("sp_start", String(state.start)); } catch (e) {} }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, { method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(d.error || "เกิดข้อผิดพลาด"); e.status = res.status; throw e; }
    return d;
  }
  function toast(m) { var t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2800); }
  function modal(html) { $("#modalBox").innerHTML = html; $("#modal").hidden = false; return $("#modalBox"); }
  function closeModal() { $("#modal").hidden = true; $("#modalBox").innerHTML = ""; }
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  function field(label, input) { return '<div class="field"><label class="f">' + label + "</label>" + input + "</div>"; }
  function setView(h) { $("#app").innerHTML = h; }

  /* ---------- sticker rendering (real size: mm / pt) ---------- */
  var BASE_PT = [7.5, 9, 10.5];   // ขนาดตัวอักษรเริ่มต้น: เล็ก / กลาง / ใหญ่ (ย่อให้พอดีช่องอัตโนมัติ)
  function L() { return state.cfg.layout; }
  function stickerHTML(d, extraClass) {
    var lay = L();
    var colors = (d.colors || []).map(function (c) { return '<span style="color:' + esc(c.hex) + '">' + esc(c.name) + "</span>"; }).join(" / ");
    return '<div class="stk ' + (extraClass || "") + '" style="width:' + lay.cellW + "mm;height:" + lay.cellH + "mm;padding:" + lay.padding + 'mm"><div class="stk-in" data-base="' + BASE_PT[d.size == null ? 1 : d.size] + '">' +
      '<div class="m' + (d.bold ? " b" : "") + '">' + esc(d.model) + "</div>" +
      (d.spec ? '<div class="sp">' + esc(d.spec) + "</div>" : "") +
      (colors ? '<div class="co">' + colors + "</div>" : "") +
      (d.extra ? '<div class="ex">' + esc(d.extra) + "</div>" : "") +
      (d.logo ? '<img class="lg" src="/logo-synnex.png" alt="SYNNEX">' : "") + "</div></div>";
  }
  // Shrink the text until it fits the label (never below 5pt).
  function fit(root) {
    $$(".stk-in", root || document).forEach(function (el) {
      var pt = Number(el.dataset.base) || 9;
      el.style.fontSize = pt + "pt";
      var guard = 0;
      while ((el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5) && pt > 5 && guard++ < 40) { pt -= 0.25; el.style.fontSize = pt + "pt"; }
    });
  }
  function fitWhenReady(root) {
    fit(root);
    var imgs = $$("img.lg", root).filter(function (i) { return !i.complete; });
    imgs.forEach(function (i) { i.addEventListener("load", function () { fit(root); }, { once: true }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(root); });
  }

  /* ---------- sheets ---------- */
  function cellPos(i) {
    var lay = L(), r = Math.floor(i / lay.cols), c = i % lay.cols;
    return { left: lay.marginLeft + lay.offsetX + c * (lay.cellW + lay.gapX), top: lay.marginTop + lay.offsetY + r * (lay.cellH + lay.gapY) };
  }
  // items: array of template data (one per sticker), placed from `start` (1-based) on the first sheet.
  function buildSheets(items, start, opts) {
    opts = opts || {};
    var lay = L(), per = lay.cols * lay.rows, sheets = [], slot = Math.max(0, Math.min(per - 1, start - 1)), cur = null;
    function newSheet() { cur = new Array(per).fill(null); sheets.push(cur); }
    newSheet();
    for (var k = 0; k < slot; k++) cur[k] = "skip";
    items.forEach(function (d) { if (slot >= per) { newSheet(); slot = 0; } cur[slot++] = d; });
    return sheets.map(function (cells, si) {
      return '<div class="sheet" data-sheet="' + si + '">' + cells.map(function (d, i) {
        var p = cellPos(i), cls = "cell" + (lay.showBorders || opts.borders ? " bordered" : "") + (d === "skip" ? " skip" : d ? "" : " empty") + (opts.pick && si === 0 ? " pick" : "");
        var inner = d && d !== "skip" ? stickerHTML(d) : opts.numbers ? '<div class="stk" style="width:' + lay.cellW + "mm;height:" + lay.cellH + 'mm"><div class="stk-in"><span class="num" style="position:static;font-size:9pt">' + (i + 1) + "</span></div></div>" : "";
        return '<div class="' + cls + '" data-i="' + i + '" style="left:' + p.left + "mm;top:" + p.top + "mm;width:" + lay.cellW + "mm;height:" + lay.cellH + 'mm">' + inner + "</div>";
      }).join("") + "</div>";
    });
  }
  // Scale real-size sheets to fit their wrapper on screen.
  function scaleSheets(root, width) {
    $$(".sheetwrap", root).forEach(function (w) {
      var s = w.querySelector(".sheet"), k = width / s.offsetWidth;
      s.style.transform = "scale(" + k + ")"; w.style.width = width + "px"; w.style.height = s.offsetHeight * k + "px";
    });
  }
  function printSheets(html) {
    var pa = $("#printArea"); pa.innerHTML = html.join("");
    fitWhenReady(pa);
    var imgs = $$("img", pa).filter(function (i) { return !i.complete; });
    var go = function () { setTimeout(function () { fit(pa); window.print(); }, 150); };
    if (!imgs.length) return go();
    var left = imgs.length; imgs.forEach(function (i) { var done = function () { if (--left === 0) go(); }; i.addEventListener("load", done, { once: true }); i.addEventListener("error", done, { once: true }); });
  }

  /* ---------- nav ---------- */
  function renderNav() {
    var cur = location.hash.split("?")[0] || "#/";
    var links = [["#/", "พิมพ์สติ๊กเกอร์"], ["#/admin", "จัดการเทมเพลต"], ["#/settings", "ตั้งค่ากระดาษ"]];
    $("#nav").innerHTML = links.map(function (l) { return '<a href="' + l[0] + '" class="' + (cur === l[0] ? "on" : "") + '">' + l[1] + "</a>"; }).join("");
  }

  /* ---------- print page (branches) ---------- */
  function selectedItems() {
    var items = [];
    state.cfg.templates.forEach(function (t) { var n = Number(state.qty[t.id]) || 0; for (var i = 0; i < n; i++) items.push(t.data); });
    return items;
  }
  function viewPrint() {
    var cfg = state.cfg, lay = L(), per = lay.cols * lay.rows;
    // forget quantities of templates that no longer exist
    Object.keys(state.qty).forEach(function (id) { if (!cfg.templates.some(function (t) { return String(t.id) === id; })) delete state.qty[id]; });
    var cats = ["all"].concat(cfg.categories);
    var list = cfg.templates.filter(function (t) { return state.cat === "all" || t.category === state.cat; });
    setView('<h1>พิมพ์สติ๊กเกอร์แปะกล่องสินค้า</h1><p class="sub">เลือกเทมเพลตและจำนวน → ตรวจตัวอย่างหน้ากระดาษ → กดพิมพ์ (กระดาษ A4 · ' + per + " ช่อง/แผ่น)</p>" +
      '<div class="layout"><div>' +
      '<div class="tabs">' + cats.map(function (c) { var n = c === "all" ? cfg.templates.length : cfg.templates.filter(function (t) { return t.category === c; }).length; return '<button class="tab' + (state.cat === c ? " on" : "") + '" data-cat="' + c + '">' + (c === "all" ? "ทั้งหมด" : c) + " (" + n + ")</button>"; }).join("") + "</div>" +
      (list.length ? '<div class="tpls">' + list.map(function (t) {
        var n = Number(state.qty[t.id]) || 0;
        return '<div class="tpl' + (n ? " has" : "") + '" data-id="' + t.id + '"><div class="pv">' + stickerHTML(t.data) + '</div><div><div class="name">' + esc(t.name) + '</div><div class="cat">' + esc(t.category) + "</div></div>" +
          '<div class="row"><div class="qty"><button data-dec="' + t.id + '">−</button><input class="i" type="number" min="0" max="500" value="' + n + '" data-q="' + t.id + '"><button data-inc="' + t.id + '">+</button></div><span class="spacer"></span><button class="btn sm ghost" data-fill="' + t.id + '">เต็มแผ่น</button></div></div>';
      }).join("") + "</div>" : '<div class="card muted">ยังไม่มีเทมเพลตในหมวดนี้' + (cfg.admin ? ' — <a href="#/admin">เพิ่มเทมเพลต</a>' : " — ติดต่อผู้ดูแลเพื่อเพิ่มเทมเพลต") + "</div>") +
      '</div><div class="side"><div class="card" id="sideCard"></div></div></div>');
    $$("[data-cat]").forEach(function (b) { b.onclick = function () { state.cat = b.dataset.cat; viewPrint(); }; });
    function setQ(id, v) { v = Math.max(0, Math.min(500, Math.round(Number(v) || 0))); if (v) state.qty[id] = v; else delete state.qty[id]; saveSel(); var inp = $('[data-q="' + id + '"]'); if (inp && Number(inp.value) !== v) inp.value = v; var card = $('.tpl[data-id="' + id + '"]'); if (card) card.classList.toggle("has", v > 0); renderSide(); }
    $$("[data-dec]").forEach(function (b) { b.onclick = function () { setQ(b.dataset.dec, (Number(state.qty[b.dataset.dec]) || 0) - 1); }; });
    $$("[data-inc]").forEach(function (b) { b.onclick = function () { setQ(b.dataset.inc, (Number(state.qty[b.dataset.inc]) || 0) + 1); }; });
    $$("[data-q]").forEach(function (i) { i.oninput = function () { setQ(i.dataset.q, i.value); }; });
    $$("[data-fill]").forEach(function (b) { b.onclick = function () { var others = selectedItems().length - (Number(state.qty[b.dataset.fill]) || 0); var room = per - ((state.start - 1 + others) % per); setQ(b.dataset.fill, (Number(state.qty[b.dataset.fill]) || 0) + (room === per && others ? per : room)); }; });
    fitWhenReady($("#app"));
    renderSide();
  }
  function renderSide() {
    var lay = L(), per = lay.cols * lay.rows, items = selectedItems(), side = $("#sideCard"); if (!side) return;
    if (state.start > per) state.start = 1;
    var sheets = buildSheets(items, state.start, { pick: true, borders: true });
    side.innerHTML = '<div class="row"><div class="sum"><b>' + items.length + '</b> ดวง · <b>' + (items.length ? sheets.length : 0) + "</b> แผ่น</div><span class=\"spacer\"></span>" +
      '<button class="btn ghost sm" id="clear"' + (items.length ? "" : " disabled") + '>ล้าง</button></div>' +
      '<div class="row" style="margin-top:8px"><label class="small">เริ่มพิมพ์ที่ช่อง</label><input class="i" type="number" min="1" max="' + per + '" id="start" value="' + state.start + '" style="width:80px"><span class="small muted">(กดช่องในตัวอย่างได้ — ใช้กับกระดาษที่ใช้ไปแล้วบางส่วน)</span></div>' +
      sheets.map(function (h, i) { return '<div class="sheetwrap">' + h + '</div><div class="sheetlabel">แผ่นที่ ' + (i + 1) + " / " + sheets.length + "</div>"; }).join("") +
      '<button class="btn" id="print" style="width:100%;justify-content:center;margin-top:10px"' + (items.length ? "" : " disabled") + '>พิมพ์ ' + (items.length ? sheets.length + " แผ่น" : "") + "</button>" +
      '<p class="small muted" style="margin:10px 0 0">ตอนพิมพ์: เลือกกระดาษ A4 · ขนาด/สเกล <b>100% (ขนาดจริง)</b> ไม่ใช้ "พอดีหน้ากระดาษ" · ระยะขอบ <b>ไม่มี/ค่าเริ่มต้น</b> · ปิดหัว-ท้ายกระดาษ</p>';
    scaleSheets(side, side.clientWidth - 34);
    fitWhenReady(side);
    $("#start").oninput = function () { state.start = Math.max(1, Math.min(per, Math.round(Number(this.value) || 1))); saveSel(); renderSide(); };
    $$('.sheet[data-sheet="0"] .cell.pick', side).forEach(function (c) { c.onclick = function () { state.start = Number(c.dataset.i) + 1; saveSel(); renderSide(); }; });
    $("#clear").onclick = function () { state.qty = {}; saveSel(); viewPrint(); };
    $("#print").onclick = function () { printSheets(buildSheets(selectedItems(), state.start)); };
  }

  /* ---------- admin: templates ---------- */
  function loginView(after) {
    setView('<div class="card" style="max-width:380px;margin:8vh auto"><h1>เข้าสู่ระบบผู้ดูแล</h1><p class="sub">ใช้สำหรับสร้าง/แก้ไขเทมเพลต และตั้งค่ากระดาษ</p>' +
      (state.cfg.adminEnabled ? field("รหัสผ่าน", '<input class="i" type="password" id="pw" autocomplete="current-password">') + '<div class="err" id="err"></div><button class="btn" id="go" style="width:100%;justify-content:center">เข้าสู่ระบบ</button>'
        : '<div class="note">ยังไม่ได้ตั้งรหัสผ่านผู้ดูแลบนเซิร์ฟเวอร์ (ADMIN_PASSWORD)</div>') + "</div>");
    if (!state.cfg.adminEnabled) return;
    var go = async function () { try { await api("/api/admin/login", { method: "POST", body: { password: $("#pw").value } }); state.cfg.admin = true; after(); } catch (e) { $("#err").textContent = e.message; } };
    $("#go").onclick = go; $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); }); $("#pw").focus();
  }
  async function viewAdmin() {
    if (!state.cfg.admin) return loginView(viewAdmin);
    var all;
    try { all = await api("/api/admin/templates"); } catch (e) { if (e.status === 401) { state.cfg.admin = false; return loginView(viewAdmin); } throw e; }
    setView('<div class="row"><div><h1>จัดการเทมเพลต</h1><p class="sub">สร้างเทมเพลตสติ๊กเกอร์แยกตามหมวด — หน้าสาขาจะเห็นเฉพาะเทมเพลตที่เปิดใช้งาน</p></div><span class="spacer"></span>' +
      (state.cfg.adminEnabled ? '<button class="btn ghost" id="logout">ออกจากระบบ</button>' : "") + '<button class="btn" id="add">+ เพิ่มเทมเพลต</button></div>' +
      state.cfg.categories.map(function (cat) {
        var ts = all.filter(function (t) { return t.category === cat; });
        return '<div class="card"><h3 style="margin:0 0 6px">' + cat + ' <span class="muted small">(' + ts.length + ')</span> <button class="btn sm ghost" data-addcat="' + cat + '">+ เพิ่มใน ' + cat + '</button></h3><div class="list">' +
          (ts.length ? ts.map(function (t, i) {
            return '<div class="it' + (t.active ? "" : " off") + '"><div class="pvs">' + stickerHTML(t.data) + '</div><div class="main"><b>' + esc(t.name) + "</b>" + (t.active ? "" : ' <span class="small muted">(ปิดใช้งาน)</span>') + '<div class="small muted">' + esc([t.data.spec, (t.data.colors || []).map(function (c) { return c.name; }).join(" / ")].filter(Boolean).join(" · ")) + "</div></div>" +
              '<button class="btn sm ghost" data-up="' + t.id + '"' + (i === 0 ? " disabled" : "") + '>▲</button><button class="btn sm ghost" data-down="' + t.id + '"' + (i === ts.length - 1 ? " disabled" : "") + '>▼</button>' +
              '<button class="btn sm ghost" data-dup="' + t.id + '">ทำสำเนา</button><button class="btn sm" data-edit="' + t.id + '">แก้ไข</button></div>';
          }).join("") : '<div class="muted small">ยังไม่มีเทมเพลต</div>') + "</div></div>";
      }).join(""));
    fitWhenReady($("#app"));
    var byId = function (id) { return all.find(function (t) { return String(t.id) === String(id); }); };
    $("#add").onclick = function () { editor(null, "iPhone"); };
    $$("[data-addcat]").forEach(function (b) { b.onclick = function () { editor(null, b.dataset.addcat); }; });
    $$("[data-edit]").forEach(function (b) { b.onclick = function () { editor(byId(b.dataset.edit)); }; });
    $$("[data-dup]").forEach(function (b) { b.onclick = function () { var t = byId(b.dataset.dup); editor({ id: null, category: t.category, name: t.name + " (สำเนา)", data: JSON.parse(JSON.stringify(t.data)), active: true }); }; });
    $$("[data-up],[data-down]").forEach(function (b) { b.onclick = async function () { await api("/api/admin/templates/" + (b.dataset.up || b.dataset.down) + "/move", { method: "POST", body: { dir: b.dataset.up ? "up" : "down" } }); await reloadCfg(); viewAdmin(); }; });
    if ($("#logout")) $("#logout").onclick = async function () { await api("/api/admin/logout", { method: "POST", body: {} }); state.cfg.admin = false; location.hash = "#/"; };
  }
  var HINT = { iPhone: { spec: "- 256GB 512GB 1TB 2TB", extra: "" }, iPad: { spec: "Wi-Fi / Cellular · 128GB 256GB", extra: "11\" / 13\"" }, Watch: { spec: "GPS / Cell", extra: "S/M - M/L\n40\" / 44\"" } };
  function editor(t, cat) {
    var e = t ? JSON.parse(JSON.stringify(t)) : { id: null, category: cat || "iPhone", name: "", data: { model: "", bold: false, spec: "", colors: [{ name: "", hex: "#3d4466" }], extra: "", logo: true, size: 1 }, active: true };
    if (e.data.size == null) e.data.size = 1;
    var b = modal("<h2>" + (e.id ? "แก้ไขเทมเพลต" : "เพิ่มเทมเพลต") + '</h2><div class="editor"><div>' +
      '<div class="grid2">' + field("หมวด", '<select class="i" id="ecat">' + state.cfg.categories.map(function (c) { return "<option" + (c === e.category ? " selected" : "") + ">" + c + "</option>"; }).join("") + "</select>") +
      field("ชื่อเทมเพลต (แสดงในรายการ)", '<input class="i" id="ename" value="' + esc(e.name) + '" placeholder="เว้นว่าง = ชื่อรุ่น">') + "</div>" +
      '<div class="grid2">' + field("รุ่น (บรรทัดแรก)", '<input class="i" id="emodel" value="' + esc(e.data.model) + '" placeholder="เช่น iPhone 17 Pro">') +
      field("ความจุ / รายละเอียด", '<input class="i" id="espec" value="' + esc(e.data.spec) + '">') + "</div>" +
      '<label class="f">สี (แต่ละสีกำหนดสีตัวอักษรได้)</label><div class="colors" id="ecolors"></div><button class="btn sm ghost" id="addc">+ เพิ่มสี</button>' +
      '<div class="field" style="margin-top:10px"><label class="f">บรรทัดเพิ่มเติม (สูงสุด 4 บรรทัด)</label><textarea class="i" id="eextra" rows="3">' + esc(e.data.extra) + "</textarea></div>" +
      '<div class="row"><label><input type="checkbox" id="ebold"' + (e.data.bold ? " checked" : "") + '> ชื่อรุ่นตัวหนา</label><label><input type="checkbox" id="elogo"' + (e.data.logo ? " checked" : "") + '> แสดงโลโก้ SYNNEX</label>' +
      '<label>ขนาดตัวอักษร <select class="i" id="esize" style="width:auto">' + ["เล็ก", "กลาง", "ใหญ่"].map(function (l, i) { return '<option value="' + i + '"' + (e.data.size === i ? " selected" : "") + ">" + l + "</option>"; }).join("") + "</select></label>" +
      (e.id ? '<label><input type="checkbox" id="eactive"' + (e.active ? " checked" : "") + "> เปิดใช้งาน (แสดงที่หน้าสาขา)</label>" : "") + "</div>" +
      '</div><div><label class="f">ตัวอย่างขนาดจริง</label><div class="bigpv" id="epv"></div><p class="small muted">ตัวอักษรย่ออัตโนมัติให้พอดีช่อง ' + L().cellW + " × " + L().cellH + " มม.</p></div></div>" +
      '<div class="err" id="eerr"></div><div class="acts">' + (e.id ? '<button class="btn danger" id="edel">ลบเทมเพลต</button><span class="spacer"></span>' : "") + '<button class="btn ghost" id="ecancel">ยกเลิก</button><button class="btn" id="esave">บันทึก</button></div>');
    function read() {
      e.category = $("#ecat", b).value; e.name = $("#ename", b).value;
      e.data.model = $("#emodel", b).value; e.data.spec = $("#espec", b).value; e.data.extra = $("#eextra", b).value;
      e.data.bold = $("#ebold", b).checked; e.data.logo = $("#elogo", b).checked; e.data.size = Number($("#esize", b).value);
      if ($("#eactive", b)) e.active = $("#eactive", b).checked;
      e.data.colors = $$(".crow", b).map(function (r) { return { name: $(".cn", r).value, hex: $(".cc", r).value }; });
    }
    function drawColors() {
      $("#ecolors", b).innerHTML = e.data.colors.map(function (c, i) { return '<div class="crow"><input class="i cn" value="' + esc(c.name) + '" placeholder="ชื่อสี เช่น Night Sky"><input type="color" class="cc" value="' + esc(c.hex || "#1d1d1f") + '"><button class="x" data-rc="' + i + '" title="ลบสี">×</button></div>'; }).join("");
      $$(".cn,.cc", b).forEach(function (i) { i.oninput = preview; });
      $$("[data-rc]", b).forEach(function (x) { x.onclick = function () { read(); e.data.colors.splice(Number(x.dataset.rc), 1); drawColors(); preview(); }; });
    }
    function placeholders() { var h = HINT[$("#ecat", b).value] || {}; $("#espec", b).placeholder = h.spec || ""; $("#eextra", b).placeholder = h.extra ? "เช่น " + h.extra.replace("\n", " / ") : ""; }
    function preview() { read(); var d = Object.assign({}, e.data, { model: e.data.model || "ชื่อรุ่น", colors: e.data.colors.filter(function (c) { return c.name; }) }); $("#epv", b).innerHTML = stickerHTML(d); fitWhenReady($("#epv", b)); }
    drawColors(); placeholders(); preview();
    ["#ecat", "#ename", "#emodel", "#espec", "#eextra", "#ebold", "#elogo", "#esize"].forEach(function (s) { $(s, b).addEventListener("input", preview); $(s, b).addEventListener("change", preview); });
    $("#ecat", b).addEventListener("change", placeholders);
    $("#addc", b).onclick = function () { read(); e.data.colors.push({ name: "", hex: "#1d1d1f" }); drawColors(); $$(".cn", b).slice(-1)[0].focus(); };
    $("#ecancel", b).onclick = closeModal;
    $("#esave", b).onclick = async function () {
      read(); this.disabled = true;
      var body = { category: e.category, name: e.name, data: e.data, active: e.active };
      try { if (e.id) await api("/api/admin/templates/" + e.id, { method: "PUT", body: body }); else await api("/api/admin/templates", { method: "POST", body: body }); closeModal(); toast("บันทึกเทมเพลตแล้ว"); await reloadCfg(); viewAdmin(); }
      catch (er) { $("#eerr", b).textContent = er.message; this.disabled = false; }
    };
    if ($("#edel", b)) $("#edel", b).onclick = async function () { if (!confirm("ลบเทมเพลต \"" + e.name + "\"?")) return; await api("/api/admin/templates/" + e.id, { method: "DELETE" }); closeModal(); toast("ลบแล้ว"); await reloadCfg(); viewAdmin(); };
  }

  /* ---------- admin: sheet calibration ---------- */
  function viewSettings() {
    if (!state.cfg.admin) return loginView(viewSettings);
    var lay = L();
    var F = [["cols", "จำนวนคอลัมน์ (แนวนอน)"], ["rows", "จำนวนแถว (แนวตั้ง)"], ["cellW", "ความกว้างช่อง (มม.)"], ["cellH", "ความสูงช่อง (มม.)"], ["marginTop", "ขอบบน (มม.)"], ["marginLeft", "ขอบซ้าย (มม.)"], ["gapX", "ระยะห่างแนวนอน (มม.)"], ["gapY", "ระยะห่างแนวตั้ง (มม.)"], ["offsetX", "เลื่อนทั้งแผ่น ซ้าย(−)/ขวา(+) มม."], ["offsetY", "เลื่อนทั้งแผ่น ขึ้น(−)/ลง(+) มม."], ["padding", "ระยะขอบในช่อง (มม.)"]];
    setView('<h1>ตั้งค่ากระดาษ</h1><p class="sub">ค่าเริ่มต้น: A4 แนวตั้ง 5 × 10 = 50 ช่อง ช่องละ 42 × 27.9 มม. (กว้าง 4.2 ซม. · สูง 2.79 ซม.) — ใช้ปรับให้ตรงกับกระดาษสติ๊กเกอร์และเครื่องพิมพ์</p>' +
      '<div class="layout"><div class="card"><div class="grid4">' + F.map(function (f) { return field(f[1], '<input class="i" type="number" step="0.1" id="l_' + f[0] + '" value="' + lay[f[0]] + '">'); }).join("") + "</div>" +
      '<label><input type="checkbox" id="l_showBorders"' + (lay.showBorders ? " checked" : "") + '> พิมพ์เส้นขอบช่อง (สำหรับกระดาษธรรมดา)</label>' +
      '<div class="err" id="lerr"></div><div class="row"><button class="btn" id="lsave">บันทึก</button><button class="btn ghost" id="ltest">พิมพ์หน้าทดสอบ (กรอบ + เลขช่อง)</button><button class="btn ghost" id="lreset">คืนค่าเริ่มต้น</button></div>' +
      '<div class="note" style="margin-top:12px"><b>วิธีปรับให้ตรงกระดาษ:</b> พิมพ์หน้าทดสอบลงกระดาษ A4 ธรรมดา (สเกล 100%) → วางทาบกับกระดาษสติ๊กเกอร์ส่องกับไฟ → ถ้ากรอบเลื่อนทั้งแผ่น ให้ปรับ "เลื่อนทั้งแผ่น" / ถ้าค่อยๆ เลื่อนทีละแถว ให้ปรับขนาดช่องหรือระยะห่าง → บันทึก แล้วทดสอบอีกครั้ง</div></div>' +
      '<div class="card"><b>ตัวอย่าง</b><div class="sheetwrap" id="lpv"></div></div></div>');
    function read() { var v = {}; F.forEach(function (f) { v[f[0]] = Number($("#l_" + f[0]).value); }); v.showBorders = $("#l_showBorders").checked; return v; }
    function pv() { var saved = state.cfg.layout; state.cfg.layout = Object.assign({}, saved, read()); $("#lpv").innerHTML = buildSheets([], 1, { borders: true, numbers: true })[0]; scaleSheets($("#lpv").parentNode, $("#lpv").parentNode.clientWidth - 34); state.cfg.layout = saved; }
    $$("input", $("#app")).forEach(function (i) { i.addEventListener("input", pv); });
    pv();
    $("#lsave").onclick = async function () { try { state.cfg.layout = await api("/api/admin/layout", { method: "PUT", body: read() }); toast("บันทึกแล้ว"); $("#lerr").textContent = ""; } catch (e) { if (e.status === 401) { state.cfg.admin = false; return loginView(viewSettings); } $("#lerr").textContent = e.message; } };
    $("#ltest").onclick = function () { var saved = state.cfg.layout; state.cfg.layout = Object.assign({}, saved, read()); var h = buildSheets([], 1, { borders: true, numbers: true }); state.cfg.layout = saved; printSheets(h); };
    $("#lreset").onclick = function () { var d = { cols: 5, rows: 10, cellW: 42, cellH: 27.9, marginTop: 9, marginLeft: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0, padding: 1.2 }; Object.keys(d).forEach(function (k) { $("#l_" + k).value = d[k]; }); pv(); };
  }

  /* ---------- routing ---------- */
  async function reloadCfg() { var admin = state.cfg && state.cfg.admin; state.cfg = await api("/api/config"); state.cfg.admin = state.cfg.admin || false; return admin; }
  async function route() {
    closeModal(); renderNav();
    var h = location.hash.split("?")[0] || "#/";
    try {
      if (h === "#/admin") return await viewAdmin();
      if (h === "#/settings") return viewSettings();
      return viewPrint();
    } catch (e) { setView('<div class="card">' + esc(e.message) + "</div>"); }
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", function () { if ((location.hash || "#/") === "#/") renderSide(); });
  window.addEventListener("afterprint", function () { $("#printArea").innerHTML = ""; });
  reloadCfg().then(route).catch(function () { setView('<div class="card">เชื่อมต่อระบบไม่สำเร็จ กรุณารีเฟรช</div>'); });
})();
