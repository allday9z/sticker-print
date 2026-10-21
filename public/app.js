/* Sticker Print v2 — branches: model → capacity → colour → supplier → print.
   Admin (Smile): product data, suppliers, template, paper size. Every change is
   checked on the server (admin session); the branch page only reads. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var C = null;   // catalog from the server
  var ui = { cat: "iPhone", sel: {}, qty: 1, queue: [], start: 1, adminTab: "products", adminCat: "iPhone", tplCat: "iPhone" };
  try { var saved = JSON.parse(localStorage.getItem("sp2") || "{}"); ui.queue = saved.queue || []; ui.start = saved.start || 1; ui.cat = saved.cat || "iPhone"; } catch (e) {}
  function persist() { try { localStorage.setItem("sp2", JSON.stringify({ queue: ui.queue, start: ui.start, cat: ui.cat })); } catch (e) {} }

  async function api(path, opts) {
    opts = opts || {};
    var isForm = opts.body instanceof FormData;
    var res = await fetch(path, { method: opts.method || "GET", headers: opts.body && !isForm ? { "Content-Type": "application/json" } : {}, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(d.error === "auth" ? "กรุณาเข้าสู่ระบบใหม่" : d.error === "mustchange" ? "กรุณาตั้งรหัสผ่านใหม่ก่อน" : d.error || "เกิดข้อผิดพลาด"); e.code = d.error; e.status = res.status; throw e; }
    return d;
  }
  function toast(m) { var t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2800); }
  function modal(h) { $("#modalBox").innerHTML = h; $("#modal").hidden = false; return $("#modalBox"); }
  function closeModal() { $("#modal").hidden = true; $("#modalBox").innerHTML = ""; }
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  function field(l, i) { return '<div class="field"><label class="f">' + l + "</label>" + i + "</div>"; }
  function setView(h) { $("#app").innerHTML = h; }

  /* ---------- sticker rendering (real size: mm / pt) ---------- */
  var FONT_CSS = { "Helvetica": '"Helvetica Neue", Helvetica, Arial, "Noto Sans Thai", sans-serif', "Noto Sans Thai": '"Noto Sans Thai", sans-serif', "Sarabun": "Sarabun, sans-serif", "Prompt": "Prompt, sans-serif", "Kanit": "Kanit, sans-serif" };
  function L() { return C.layout; }
  function applyPageSize() {
    var s = $("#pagestyle") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "pagestyle" }));
    s.textContent = "@page { size: " + L().pageW + "mm " + L().pageH + "mm; margin: 0; }";
  }
  /* ---------- supplier logos: white edges trimmed, every logo shown at the same visible area ---------- */
  var LOGO = {};   // logo url → { src: trimmed image (blob URL), r: width / height }
  function trimLogo(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, out = { src: url, r: w / h || 1 };
        try {
          var c = document.createElement("canvas"); c.width = w; c.height = h; var g = c.getContext("2d"); g.drawImage(im, 0, 0);
          var d = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var k = (y * w + x) * 4;   // content = not transparent and not (near) white
            if (d[k + 3] > 16 && (d[k] < 235 || d[k + 1] < 235 || d[k + 2] < 235)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 >= x0) {
            var cw = x1 - x0 + 1, ch = y1 - y0 + 1, t = document.createElement("canvas"); t.width = cw; t.height = ch;
            t.getContext("2d").drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
            return t.toBlob(function (bl) { LOGO[url] = bl ? { src: URL.createObjectURL(bl), r: cw / ch } : out; res(); }, "image/png");
          }
        } catch (e) {}
        LOGO[url] = out; res();
      };
      im.onerror = function () { res(); };
      im.src = url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    });
  }
  function prepLogos(list) { return Promise.all((list || []).filter(function (s) { return s.logo; }).map(function (s) { return trimLogo(s.logo); })); }
  // Same area for all logos = the area of the widest active logo when it fills the box (maxW × maxH), so none exceeds the box.
  function logoSize(url, maxW, maxH) {
    var me = LOGO[url]; if (!me) return null;
    var fit = function (r) { return r >= maxW / maxH ? maxW * maxW / r : maxH * maxH * r; };
    var area = fit(me.r);
    ((C && C.suppliers) || []).forEach(function (s) { var o = s.logo && LOGO[s.logo]; if (o) area = Math.min(area, fit(o.r)); });
    var hh = Math.sqrt(area / me.r);
    return { src: me.src, w: Math.round(hh * me.r * 100) / 100, h: Math.round(hh * 100) / 100 };
  }
  function logoImg(url, alt, maxW, maxH, unit, cls) {
    var z = logoSize(url, maxW, maxH);
    if (!z) return '<img class="' + cls + '" src="' + esc(url) + '" alt="' + esc(alt) + '" style="max-width:' + maxW + unit + ";max-height:" + maxH + unit + '">';
    return '<img class="' + cls + '" src="' + esc(z.src) + '" alt="' + esc(alt) + '" style="width:' + z.w + unit + ";height:" + z.h + unit + '">';
  }

  // vals: { model, capacity, color: {name, hex}, supplier: {name, logo} }
  function stickerHTML(tpl, v) {
    var lay = L();
    var els = tpl.elements.map(function (e) {
      var color = e.color;
      var text = "";
      if (e.type === "model") text = v.model;
      else if (e.type === "capacity") text = v.capacity;
      else if (e.type === "color") { text = v.color && v.color.name; if (e.useItemColor && v.color && v.color.hex) color = v.color.hex; }
      else if (e.type === "text") text = e.text;
      else if (e.type === "band") text = v.band;
      else if (e.type === "bandOption") text = v.bandOption;
      var style = "font-family:" + (FONT_CSS[e.font] || FONT_CSS.Helvetica) + ";font-size:" + e.size + "pt;font-weight:" + (e.bold ? 700 : 400) + ";font-style:" + (e.italic ? "italic" : "normal") +
        ";text-align:" + e.align + ";margin-top:" + e.mt + "mm;line-height:" + tpl.lineHeight + ";color:" + color;
      if (e.type === "supplier") {
        if (v.supplier && v.supplier.logo) return '<div class="el" style="' + esc(style) + '">' + logoImg(v.supplier.logo, v.supplier.name, e.logoW || 21.3, e.logoH, "mm", "lg") + "</div>";
        text = v.supplier && v.supplier.name;
      }
      if (!text) return "";
      return '<div class="el" style="' + esc(style) + '">' + esc((e.prefix || "") + text + (e.suffix || "")) + "</div>";
    }).join("");
    return '<div class="stk" style="width:' + lay.cellW + "mm;height:" + lay.cellH + "mm;padding:" + tpl.padding + "mm;justify-content:" + (tpl.valign === "top" ? "flex-start" : "center") + '">' + els + "</div>";
  }
  // Fixed sizes (as designed) — just flag a label whose content doesn't fit.
  function markOverflow(root) { var n = 0; $$(".stk", root).forEach(function (s) { var o = s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1; s.classList.toggle("over", o); if (o) n++; }); return n; }
  function afterRender(root, cb) {
    var done = function () { var n = markOverflow(root); if (cb) cb(n); };
    done();
    $$("img", root).forEach(function (i) { if (!i.complete) i.addEventListener("load", done, { once: true }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(done);
  }
  function valsOf(item) {
    var sup = C.suppliers.find(function (s) { return s.id === item.supplierId; }) || { name: item.supplierName, logo: null };
    return { model: item.model, capacity: item.capacity, color: { name: item.color, hex: item.hex }, band: item.band || "", bandOption: item.bandOption || "", supplier: { name: sup.name, logo: sup.logo } };
  }
  function tplFor(cat) { return C.templates[cat]; }

  /* ---------- sheets ---------- */
  function cellPos(i) { var l = L(), r = Math.floor(i / l.cols), c = i % l.cols; return { left: l.marginLeft + l.offsetX + c * (l.cellW + l.gapX), top: l.marginTop + l.offsetY + r * (l.cellH + l.gapY) }; }
  function buildSheets(list, start, o) {   // list: [{tpl, vals}]
    o = o || {};
    var l = L(), per = l.cols * l.rows, sheets = [], slot = Math.max(0, Math.min(per - 1, start - 1)), cur;
    function ns() { cur = new Array(per).fill(null); sheets.push(cur); } ns();
    for (var k = 0; k < slot; k++) cur[k] = "skip";
    list.forEach(function (x) { if (slot >= per) { ns(); slot = 0; } cur[slot++] = x; });
    return sheets.map(function (cells, si) {
      return '<div class="sheet" data-sheet="' + si + '" style="width:' + l.pageW + "mm;height:" + l.pageH + 'mm">' + cells.map(function (x, i) {
        var p = cellPos(i), cls = "cell" + (l.showBorders || o.borders ? " bordered" : "") + (x === "skip" ? " skip" : x ? "" : " empty") + (o.pick && si === 0 ? " pick" : "");
        var inner = x && x !== "skip" ? stickerHTML(x.tpl, x.vals) : o.numbers ? '<div class="numcell">' + (i + 1) + "</div>" : "";
        return '<div class="' + cls + '" data-i="' + i + '" style="left:' + p.left + "mm;top:" + p.top + "mm;width:" + l.cellW + "mm;height:" + l.cellH + 'mm">' + inner + "</div>";
      }).join("") + "</div>";
    });
  }
  function scaleSheets(root, width) {
    $$(".sheetwrap", root).forEach(function (w) { var s = w.querySelector(".sheet"), k = width / s.offsetWidth; s.style.transform = "scale(" + k + ")"; w.style.width = width + "px"; w.style.height = s.offsetHeight * k + "px"; });
  }
  function printSheets(html) {
    applyPageSize();
    var pa = $("#printArea"); pa.innerHTML = html.join("");
    var imgs = $$("img", pa).filter(function (i) { return !i.complete; }), go = function () { (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { window.print(); }, 120); }); };
    if (!imgs.length) return go();
    var left = imgs.length; imgs.forEach(function (i) { var d = function () { if (--left === 0) go(); }; i.addEventListener("load", d, { once: true }); i.addEventListener("error", d, { once: true }); });
  }

  /* ---------- nav ---------- */
  function renderNav() {
    var cur = (location.hash || "#/").split("?")[0];
    $("#nav").innerHTML = [["#/", "พิมพ์สติ๊กเกอร์"], ["#/admin", "ผู้ดูแลระบบ"]].map(function (l) { return '<a href="' + l[0] + '" class="' + (cur === l[0] ? "on" : "") + '">' + l[1] + "</a>"; }).join("");
  }

  /* ================= branch page ================= */
  function modelsOf(cat) { return C.models.filter(function (m) { return m.category === cat; }); }
  function viewPrint() {
    var cats = C.categories.filter(function (c) { return modelsOf(c).length; });
    if (cats.indexOf(ui.cat) === -1) ui.cat = cats[0] || "iPhone";
    setView('<h1>พิมพ์สติ๊กเกอร์แปะกล่องสินค้า</h1><p class="sub">เลือกข้อมูลสินค้าทีละขั้น → ตรวจตัวอย่าง → เพิ่มลงแผ่น → พิมพ์</p>' +
      '<div class="layout"><div>' +
      '<div class="tabs">' + C.categories.map(function (c) { var has = modelsOf(c).length; return '<button class="tab' + (ui.cat === c ? " on" : "") + '" data-cat="' + c + '"' + (has ? "" : " disabled") + ">" + c + (has ? "" : " (เร็วๆ นี้)") + "</button>"; }).join("") + "</div>" +
      '<div class="card" id="steps"></div><div class="card" id="pv"></div></div>' +
      '<div class="side"><div class="card" id="queue"></div></div></div>');
    $$("[data-cat]").forEach(function (b) { b.onclick = function () { ui.cat = b.dataset.cat; ui.sel = {}; persist(); viewPrint(); }; });
    renderSteps(); renderQueue();
  }
  // Steps per category. iPhone / iPad: model → capacity → colour → supplier.
  // Watch: model → case size → case colour → band (+ band option) → supplier.
  // Colours / bands limited to some sizes only show for those sizes; suppliers only for their categories.
  function suppliersFor(cat) { return C.suppliers.filter(function (x) { return !x.categories || x.categories.indexOf(cat) > -1; }); }
  function fitsSize(x, size) { return !x.sizes || !x.sizes.length || x.sizes.indexOf(size) > -1; }
  function renderSteps() {
    var s = ui.sel, watch = ui.cat === "Watch", models = modelsOf(ui.cat), m = models.find(function (x) { return x.id === s.modelId; }), n = 0;
    function step(title, done, body, value) {
      return '<div class="step' + (done ? " done" : "") + '"><div class="sh"><span class="sn">' + (++n) + "</span><b>" + title + "</b>" + (value ? '<span class="sv">' + esc(value) + "</span>" : "") + "</div>" + body + "</div>";
    }
    var opts = function (items, key, cur, render) { return '<div class="opts">' + items.map(function (it, i) { return '<button class="opt' + (cur === i ? " on" : "") + '" data-' + key + '="' + i + '">' + render(it) + "</button>"; }).join("") + "</div>"; };
    var none = function (what) { return '<div class="empty-note">ยังไม่มีข้อมูล' + what + "ของรุ่นนี้ — กรุณาติดต่อผู้ดูแลระบบ</div>"; };
    var colors = [], bands = [], band = null, sups = suppliersFor(ui.cat);
    var h = step("เลือกรุ่น " + (watch ? "Apple Watch" : ui.cat), !!m, opts(models, "m", m ? models.indexOf(m) : -1, function (x) { return esc(x.name); }), m && m.name);
    var ready = false;
    if (m) {
      var ci = s.capacity != null ? m.capacities.indexOf(s.capacity) : -1;
      h += step(watch ? "เลือกขนาดตัวเรือน (Case Size)" : "เลือกความจุ", ci > -1, m.capacities.length ? opts(m.capacities, "c", ci, esc) : none(watch ? "ขนาดตัวเรือน" : "ความจุ"), ci > -1 ? s.capacity : "");
      if (ci > -1) {
        colors = m.colors.filter(function (c) { return fitsSize(c, s.capacity); });
        var ki = s.color != null ? colors.findIndex(function (c) { return c.name === s.color; }) : -1;
        h += step(watch ? "เลือกสีตัวเรือน (Case Color)" : "เลือกสีเครื่อง", ki > -1, colors.length ? opts(colors, "k", ki, function (c) { return '<span class="sw" style="background:' + esc(c.hex) + '"></span>' + esc(c.name); }) : none(watch ? "สีตัวเรือน (ขนาดนี้)" : "สี"), ki > -1 ? s.color : "");
        ready = ki > -1;
        if (ready && watch) {
          bands = (m.bands || []).filter(function (b) { return fitsSize(b, s.capacity); });
          var bi = s.band != null ? bands.findIndex(function (b) { return b.name === s.band; }) : -1;
          band = bi > -1 ? bands[bi] : null;
          h += step("เลือกประเภทสาย (Band Type)", !!band && (!band.options.length || !!s.bandOption), bands.length ? opts(bands, "b", bi, function (b) { return esc(b.name); }) : none("ประเภทสาย (ขนาดนี้)"), band ? band.name + (s.bandOption ? " · " + s.bandOption : "") : "");
          if (band && band.options.length) h += '<div class="substep"><span class="small muted">ตัวเลือกของ ' + esc(band.name) + ":</span>" + opts(band.options, "bo", band.options.indexOf(s.bandOption), esc) + "</div>";
          ready = !!band && (!band.options.length || band.options.indexOf(s.bandOption) > -1);
        }
        if (ready) {
          var si = sups.findIndex(function (x) { return x.id === s.supplierId; });
          h += step("เลือก Supplier", si > -1, sups.length ? opts(sups, "s", si, function (x) { return x.logo ? logoImg(x.logo, x.name, 76, 18, "px", "olg") + '<span class="small">' + esc(x.name) + "</span>" : esc(x.name); }) : '<div class="empty-note">ยังไม่มีซัพพลายเออร์สำหรับหมวดนี้</div>', si > -1 ? sups[si].name : "");
        }
      }
    }
    $("#steps").innerHTML = h;
    $$("[data-m]").forEach(function (b) { b.onclick = function () { ui.sel = { modelId: models[Number(b.dataset.m)].id }; renderSteps(); }; });
    $$("[data-c]").forEach(function (b) { b.onclick = function () { ui.sel = { modelId: m.id, capacity: m.capacities[Number(b.dataset.c)] }; renderSteps(); }; });
    $$("[data-k]").forEach(function (b) { b.onclick = function () { var c = colors[Number(b.dataset.k)]; ui.sel = { modelId: m.id, capacity: s.capacity, color: c.name, hex: c.hex }; renderSteps(); }; });
    $$("[data-b]").forEach(function (b) { b.onclick = function () { ui.sel = { modelId: m.id, capacity: s.capacity, color: s.color, hex: s.hex, band: bands[Number(b.dataset.b)].name }; renderSteps(); }; });
    $$("[data-bo]").forEach(function (b) { b.onclick = function () { ui.sel.bandOption = band.options[Number(b.dataset.bo)]; delete ui.sel.supplierId; renderSteps(); }; });
    $$("[data-s]").forEach(function (b) { b.onclick = function () { ui.sel.supplierId = sups[Number(b.dataset.s)].id; renderSteps(); }; });
    renderPreview();
  }
  function currentItem() {
    var s = ui.sel, m = C.models.find(function (x) { return x.id === s.modelId; }), sup = suppliersFor(ui.cat).find(function (x) { return x.id === s.supplierId; });
    if (!m || s.capacity == null || s.color == null || !sup) return null;
    if (ui.cat === "Watch") { var b = (m.bands || []).find(function (x) { return x.name === s.band; }); if (!b || (b.options.length && b.options.indexOf(s.bandOption) === -1)) return null; }
    return { cat: ui.cat, model: m.name, capacity: s.capacity, color: s.color, hex: s.hex, band: s.band || "", bandOption: s.bandOption || "", supplierId: sup.id, supplierName: sup.name };
  }
  function renderPreview() {
    var it = currentItem(), pv = $("#pv");
    if (!it) { pv.innerHTML = '<div class="muted">ตัวอย่างสติ๊กเกอร์จะแสดงเมื่อเลือกครบทุกขั้นตอน</div>'; return; }
    pv.innerHTML = '<div class="row"><b>ตัวอย่างสติ๊กเกอร์</b><span class="spacer"></span><span class="small muted">ขนาดจริง ' + L().cellW + " × " + L().cellH + ' มม. (แสดงขยาย 2 เท่า)</span></div>' +
      '<div class="pvbox"><div class="zoom2">' + stickerHTML(tplFor(it.cat), valsOf(it)) + "</div></div>" +
      '<div class="row" style="justify-content:center"><label>จำนวน</label><div class="qty"><button id="qm">−</button><input class="i" type="number" min="1" max="500" id="qn" value="' + ui.qty + '"><button id="qp">+</button></div>' +
      '<button class="btn ghost" id="qfill">เต็มแผ่น</button><button class="btn" id="add">+ เพิ่มลงแผ่น</button></div><div class="err" id="pverr"></div>';
    afterRender(pv, function (n) { $("#pverr").textContent = n ? "ข้อความยาวเกินช่องสติ๊กเกอร์ — แจ้งผู้ดูแลระบบให้ปรับเทมเพลต" : ""; });
    var setQ = function (v) { ui.qty = Math.max(1, Math.min(500, Math.round(Number(v) || 1))); $("#qn").value = ui.qty; };
    $("#qm").onclick = function () { setQ(ui.qty - 1); }; $("#qp").onclick = function () { setQ(ui.qty + 1); }; $("#qn").oninput = function () { setQ(this.value); };
    $("#qfill").onclick = function () { var per = L().cols * L().rows, used = (ui.start - 1 + totalQty()) % per; setQ(per - used || per); };
    $("#add").onclick = function () {
      var key = JSON.stringify([it.cat, it.model, it.capacity, it.color, it.band, it.bandOption, it.supplierId]), ex = ui.queue.find(function (q) { return q.key === key; });
      if (ex) ex.qty += ui.qty; else ui.queue.push(Object.assign({ key: key, qty: ui.qty }, it));
      persist(); toast("เพิ่ม " + ui.qty + " ดวง: " + [it.model, it.capacity, it.color, it.band, it.bandOption].filter(Boolean).join(" ")); renderQueue();
    };
  }
  function totalQty() { return ui.queue.reduce(function (a, q) { return a + q.qty; }, 0); }
  function queueList() { var out = []; ui.queue.forEach(function (q) { var t = tplFor(q.cat), v = valsOf(q); for (var i = 0; i < q.qty; i++) out.push({ tpl: t, vals: v }); }); return out; }
  function renderQueue() {
    var box = $("#queue"); if (!box) return;
    var l = L(), per = l.cols * l.rows; if (ui.start > per) ui.start = 1;
    var list = queueList(), sheets = buildSheets(list, ui.start, { pick: true, borders: true });
    box.innerHTML = '<div class="row"><b>รายการที่จะพิมพ์</b><span class="spacer"></span><span><b>' + list.length + "</b> ดวง · <b>" + (list.length ? sheets.length : 0) + "</b> แผ่น</span></div>" +
      (ui.queue.length ? '<div class="ql">' + ui.queue.map(function (q, i) {
        return '<div class="qi"><div class="qt"><b>' + esc(q.model) + "</b> " + esc(q.capacity) + " · " + esc(q.color) + (q.band ? " · " + esc(q.band) + (q.bandOption ? " " + esc(q.bandOption) : "") : "") + '<div class="small muted">' + esc(q.supplierName) + '</div></div><input class="i" type="number" min="1" max="500" value="' + q.qty + '" data-qq="' + i + '"><button class="x" data-qx="' + i + '" title="ลบ">×</button></div>';
      }).join("") + "</div>" : '<p class="muted small">ยังไม่มีรายการ — เลือกสินค้าแล้วกด "เพิ่มลงแผ่น"</p>') +
      '<div class="row" style="margin-top:8px"><label class="small">เริ่มพิมพ์ที่ช่อง</label><input class="i" type="number" min="1" max="' + per + '" id="start" value="' + ui.start + '" style="width:76px"><span class="small muted">กดช่องในตัวอย่างได้ (กระดาษที่ใช้ไปแล้วบางส่วน)</span></div>' +
      sheets.map(function (h, i) { return '<div class="sheetwrap">' + h + '</div><div class="sheetlabel">แผ่นที่ ' + (i + 1) + " / " + sheets.length + "</div>"; }).join("") +
      '<div class="row"><button class="btn ghost" id="qclear"' + (list.length ? "" : " disabled") + '>ล้างรายการ</button><span class="spacer"></span><button class="btn" id="print"' + (list.length ? "" : " disabled") + ">พิมพ์ " + (list.length ? sheets.length + " แผ่น" : "") + "</button></div>" +
      '<p class="small muted" style="margin:10px 0 0">ตอนพิมพ์: กระดาษ ' + (l.pageW === 210 && l.pageH === 297 ? "A4" : l.pageW + " × " + l.pageH + " มม.") + " · สเกล <b>100% (ขนาดจริง)</b> ไม่เลือก \"พอดีหน้ากระดาษ\" · ปิดหัว-ท้ายกระดาษ</p>";
    scaleSheets(box, box.clientWidth - 34);
    afterRender(box);
    $$("[data-qq]").forEach(function (inp) { inp.onchange = function () { ui.queue[Number(inp.dataset.qq)].qty = Math.max(1, Math.min(500, Math.round(Number(inp.value) || 1))); persist(); renderQueue(); }; });
    $$("[data-qx]").forEach(function (x) { x.onclick = function () { ui.queue.splice(Number(x.dataset.qx), 1); persist(); renderQueue(); }; });
    $("#start").onchange = function () { ui.start = Math.max(1, Math.min(per, Math.round(Number(this.value) || 1))); persist(); renderQueue(); };
    $$('.sheet[data-sheet="0"] .cell.pick', box).forEach(function (c) { c.onclick = function () { ui.start = Number(c.dataset.i) + 1; persist(); renderQueue(); }; });
    $("#qclear").onclick = function () { if (confirm("ล้างรายการทั้งหมด?")) { ui.queue = []; persist(); renderQueue(); } };
    $("#print").onclick = function () { printSheets(buildSheets(queueList(), ui.start)); };
  }

  /* ================= admin ================= */
  function loginView() {
    setView('<div class="card" style="max-width:380px;margin:8vh auto"><h1>ผู้ดูแลระบบ</h1><p class="sub">จัดการข้อมูลสินค้า เทมเพลต และขนาดกระดาษ</p>' +
      field("รหัสผ่าน", '<input class="i" type="password" id="pw" autocomplete="current-password">') + '<div class="err" id="err"></div><button class="btn" id="go" style="width:100%;justify-content:center">เข้าสู่ระบบ</button></div>');
    var go = async function () { try { var r = await api("/api/admin/login", { method: "POST", body: { password: $("#pw").value } }); C.admin = true; C.mustChange = r.mustChange; viewAdmin(); } catch (e) { $("#err").textContent = e.message; } };
    $("#go").onclick = go; $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); }); $("#pw").focus();
  }
  function passwordView(forced) {
    var h = '<div class="card" style="max-width:420px;' + (forced ? "margin:6vh auto" : "") + '"><h2 style="margin-top:0">' + (forced ? "ตั้งรหัสผ่านใหม่ (ครั้งแรก)" : "เปลี่ยนรหัสผ่าน") + "</h2>" +
      (forced ? '<p class="sub">รหัสผ่านเริ่มต้นใช้ได้ครั้งเดียว — ตั้งรหัสผ่านของคุณเอง (อย่างน้อย 8 ตัวอักษร) แล้วรหัสเริ่มต้นจะใช้ไม่ได้อีก</p>' : '<p class="sub">เมื่อเปลี่ยนแล้ว ทุกเครื่องที่เคยเข้าสู่ระบบจะต้องเข้าใหม่</p>') +
      field("รหัสผ่านปัจจุบัน", '<input class="i" type="password" id="p0" autocomplete="current-password">') + field("รหัสผ่านใหม่", '<input class="i" type="password" id="p1" autocomplete="new-password">') + field("ยืนยันรหัสผ่านใหม่", '<input class="i" type="password" id="p2" autocomplete="new-password">') +
      '<div class="err" id="perr"></div><button class="btn" id="psave">บันทึกรหัสผ่าน</button></div>';
    return { html: h, bind: function () { $("#psave").onclick = async function () {
      if ($("#p1").value !== $("#p2").value) { $("#perr").textContent = "รหัสผ่านใหม่ไม่ตรงกัน"; return; }
      try { await api("/api/admin/password", { method: "POST", body: { current: $("#p0").value, next: $("#p1").value } }); C.mustChange = false; toast("เปลี่ยนรหัสผ่านแล้ว"); viewAdmin(); } catch (e) { $("#perr").textContent = e.message; }
    }; } };
  }
  var A = null;   // admin catalog (incl. inactive)
  async function viewAdmin() {
    if (!C.admin) return loginView();
    if (C.mustChange) { var pv = passwordView(true); setView(pv.html); return pv.bind(); }
    try { A = await api("/api/admin/catalog"); await prepLogos(A.suppliers.filter(function (s) { return s.logo && !LOGO[s.logo]; })); } catch (e) { if (e.status === 401) { C.admin = false; return loginView(); } if (e.code === "mustchange") { C.mustChange = true; return viewAdmin(); } throw e; }
    var tabs = [["products", "ข้อมูลสินค้า"], ["suppliers", "ซัพพลายเออร์"], ["template", "เทมเพลต"], ["paper", "ขนาดกระดาษ"], ["account", "บัญชี"]];
    setView('<div class="row"><div><h1>ผู้ดูแลระบบ</h1><p class="sub">เฉพาะผู้ดูแลแก้ไขได้ — หน้าสาขาเลือกและพิมพ์ได้อย่างเดียว</p></div><span class="spacer"></span><button class="btn ghost" id="logout">ออกจากระบบ</button></div>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (ui.adminTab === t[0] ? " on" : "") + '" data-at="' + t[0] + '">' + t[1] + "</button>"; }).join("") + '</div><div id="atab"></div>');
    $$("[data-at]").forEach(function (b) { b.onclick = function () { ui.adminTab = b.dataset.at; viewAdmin(); }; });
    $("#logout").onclick = async function () { await api("/api/admin/logout", { method: "POST", body: {} }); C.admin = false; location.hash = "#/"; };
    ({ products: adminProducts, suppliers: adminSuppliers, template: adminTemplate, paper: adminPaper, account: adminAccount })[ui.adminTab]();
  }
  async function refresh() { var adm = C && C.admin; C = await api("/api/catalog"); if (adm && !C.admin) C.admin = false; await prepLogos(C.suppliers); applyPageSize(); }
  function act(fn) { return async function () { try { await fn.apply(this, arguments); } catch (e) { if (e.status === 401) { C.admin = false; return loginView(); } alert(e.message); } }; }

  // --- product data
  function adminProducts() {
    var ms = A.models.filter(function (m) { return m.category === ui.adminCat; });
    $("#atab").innerHTML = '<div class="tabs">' + A.categories.map(function (c) { return '<button class="tab sm' + (ui.adminCat === c ? " on" : "") + '" data-ac="' + c + '">' + c + " (" + A.models.filter(function (m) { return m.category === c; }).length + ")</button>"; }).join("") + "</div>" +
      '<div class="card"><div class="row"><b>รุ่น ' + ui.adminCat + '</b><span class="spacer"></span><input class="i" id="newm" placeholder="ชื่อรุ่นใหม่" style="width:220px"><button class="btn" id="addm">+ เพิ่มรุ่น</button></div>' +
      '<p class="small muted">ความจุและสีของแต่ละรุ่น เพิ่มเองได้ที่ปุ่ม "แก้ไข" — หน้าสาขาจะแสดงเฉพาะที่กำหนดไว้</p><div class="list">' +
      (ms.length ? ms.map(function (m, i) {
        return '<div class="it' + (m.active ? "" : " off") + '"><div class="main"><b>' + esc(m.name) + "</b>" + (m.active ? "" : ' <span class="small muted">(ซ่อน)</span>') +
          '<div class="small">' + (m.capacities.length ? m.capacities.map(esc).join(" · ") : '<span class="warn">ยังไม่มี' + (m.category === "Watch" ? "ขนาดตัวเรือน" : "ความจุ") + "</span>") + " &nbsp;|&nbsp; " +
          (m.colors.length ? m.colors.map(function (c) { return '<span class="sw" style="background:' + esc(c.hex) + '"></span>' + esc(c.name); }).join(" ") : '<span class="warn">ยังไม่มีสี</span>') +
          (m.category === "Watch" ? " &nbsp;|&nbsp; " + ((m.bands || []).length ? m.bands.map(function (b) { return esc(b.name) + (b.options.length ? " (" + b.options.map(esc).join("/") + ")" : ""); }).join(" · ") : '<span class="warn">ยังไม่มีประเภทสาย</span>') : "") + "</div></div>" +
          '<button class="btn sm ghost" data-mu="' + m.id + '"' + (i ? "" : " disabled") + '>▲</button><button class="btn sm ghost" data-md="' + m.id + '"' + (i < ms.length - 1 ? "" : " disabled") + '>▼</button><button class="btn sm" data-me="' + m.id + '">แก้ไข</button></div>';
      }).join("") : '<div class="muted small">ยังไม่มีรุ่นในหมวดนี้</div>') + "</div></div>";
    $$("[data-ac]").forEach(function (b) { b.onclick = function () { ui.adminCat = b.dataset.ac; adminProducts(); }; });
    $("#addm").onclick = act(async function () { var n = $("#newm").value.trim(); if (!n) return; await api("/api/admin/models", { method: "POST", body: { category: ui.adminCat, name: n } }); await refresh(); await viewAdmin(); });
    $$("[data-mu],[data-md]").forEach(function (b) { b.onclick = act(async function () { await api("/api/admin/models/" + (b.dataset.mu || b.dataset.md) + "/move", { method: "POST", body: { dir: b.dataset.mu ? "up" : "down" } }); await refresh(); await viewAdmin(); }); });
    $$("[data-me]").forEach(function (b) { b.onclick = function () { modelEditor(A.models.find(function (m) { return m.id === Number(b.dataset.me); })); }; });
  }
  var CAP_SUGGEST = { iPhone: ["64GB", "128GB", "256GB", "512GB", "1TB", "2TB"], iPad: ["64GB", "128GB", "256GB", "512GB", "1TB", "2TB"], Watch: ["40mm", "41mm", "42mm", "44mm", "46mm", "49mm"] };
  var BAND_SUGGEST = ["Milanese Loop", "Trail Loop", "Alpine Loop", "Ocean Band"];   // examples from Smile's spec — quick-add only
  function modelEditor(m) {
    var e = JSON.parse(JSON.stringify(m)), watch = e.category === "Watch";
    e.bands = e.bands || [];
    var capL = watch ? "ขนาดตัวเรือน (Case Size)" : "ความจุ";
    var b = modal("<h2>แก้ไขรุ่น</h2>" + '<div class="grid2">' + field("ชื่อรุ่น", '<input class="i" id="mn" value="' + esc(e.name) + '">') +
      field("คัดลอกข้อมูลจากรุ่นอื่น", '<select class="i" id="mcopy"><option value="">— เลือกรุ่น —</option>' + A.models.filter(function (x) { return x.id !== e.id && x.category === e.category && (x.capacities.length || x.colors.length || (x.bands || []).length); }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("") + "</select>") + "</div>" +
      '<label class="f">' + capL + ' (ขั้นที่ 2)</label><div class="chips" id="mcaps"></div><div class="row" style="margin:6px 0 12px"><input class="i" id="mcap" placeholder="เช่น ' + CAP_SUGGEST[e.category][2] + '" style="width:150px"><button class="btn sm" id="mcapadd">เพิ่ม</button><span class="small muted">หรือกด:</span>' + CAP_SUGGEST[e.category].map(function (c) { return '<button class="btn sm ghost" data-cs="' + c + '">' + c + "</button>"; }).join("") + "</div>" +
      '<label class="f">' + (watch ? "สีตัวเรือน (Case Color) — ติ๊กขนาดที่มีสีนี้ (ไม่ติ๊ก = ทุกขนาด)" : "สีเครื่อง (ขั้นที่ 3 · ใช้เป็นสีตัวอักษรบนสติ๊กเกอร์ได้)") + '</label><div id="mcols"></div><button class="btn sm ghost" id="mcoladd">+ เพิ่มสี</button>' +
      (watch ? '<label class="f" style="margin-top:12px">ประเภทสาย (Band Type) — ติ๊กขนาดที่ใช้ได้ (ไม่ติ๊ก = ทุกขนาด) · ตัวเลือกย่อยคั่นด้วย , เช่น S/M, M/L</label><div id="mbands"></div><div class="row"><button class="btn sm ghost" id="mbandadd">+ เพิ่มประเภทสาย</button><span class="small muted">หรือกด:</span>' + BAND_SUGGEST.map(function (x) { return '<button class="btn sm ghost" data-bs="' + x + '">' + x + "</button>"; }).join("") + "</div>" : "") +
      '<div class="row" style="margin-top:12px"><label><input type="checkbox" id="mact"' + (e.active ? " checked" : "") + "> แสดงที่หน้าสาขา</label></div>" +
      '<div class="err" id="merr"></div><div class="acts"><button class="btn danger" id="mdel">ลบรุ่น</button><span class="spacer"></span><button class="btn ghost" id="mx">ยกเลิก</button><button class="btn" id="ms">บันทึก</button></div>');
    var sizeBoxes = function (cls, sel) { return watch && e.capacities.length ? '<div class="sizes">' + e.capacities.map(function (c) { return '<label class="small"><input type="checkbox" class="' + cls + '" value="' + esc(c) + '"' + ((sel || []).indexOf(c) > -1 ? " checked" : "") + "> " + esc(c) + "</label>"; }).join("") + "</div>" : ""; };
    function readAll() {
      e.colors = $$(".crow", b).map(function (r) { return { name: $(".cn", r).value, hex: $(".cc", r).value, sizes: $$(".csz:checked", r).map(function (x) { return x.value; }) }; });
      if (watch) e.bands = $$(".brow", b).map(function (r) { return { name: $(".bn", r).value, options: $(".bopt", r).value.split(",").map(function (o) { return o.trim(); }).filter(Boolean), sizes: $$(".bsz:checked", r).map(function (x) { return x.value; }) }; });
    }
    function draw() {
      $("#mcaps", b).innerHTML = e.capacities.length ? e.capacities.map(function (c, i) { return '<span class="chip">' + esc(c) + ' <button class="x" data-cx="' + i + '">×</button></span>'; }).join("") : '<span class="muted small">ยังไม่มี</span>';
      $("#mcols", b).innerHTML = e.colors.map(function (c, i) { return '<div class="crow"><div class="crowin"><input class="i cn" value="' + esc(c.name) + '" placeholder="ชื่อสี เช่น Midnight"><input type="color" class="cc" value="' + esc(c.hex) + '"><button class="x" data-kx="' + i + '">×</button></div>' + sizeBoxes("csz", c.sizes) + "</div>"; }).join("");
      if (watch) $("#mbands", b).innerHTML = e.bands.map(function (x, i) { return '<div class="brow"><div class="crowin2"><input class="i bn" value="' + esc(x.name) + '" placeholder="ชื่อประเภทสาย"><input class="i bopt" value="' + esc((x.options || []).join(", ")) + '" placeholder="ตัวเลือกย่อย (ถ้ามี) เช่น S/M, M/L"><button class="x" data-bx="' + i + '">×</button></div>' + sizeBoxes("bsz", x.sizes) + "</div>"; }).join("") || '<span class="muted small">ยังไม่มี</span>';
      $$("[data-cx]", b).forEach(function (x) { x.onclick = function () { readAll(); var rm = e.capacities.splice(Number(x.dataset.cx), 1)[0]; e.colors.forEach(function (c) { c.sizes = (c.sizes || []).filter(function (z) { return z !== rm; }); }); e.bands.forEach(function (c) { c.sizes = (c.sizes || []).filter(function (z) { return z !== rm; }); }); draw(); }; });
      $$("[data-kx]", b).forEach(function (x) { x.onclick = function () { readAll(); e.colors.splice(Number(x.dataset.kx), 1); draw(); }; });
      $$("[data-bx]", b).forEach(function (x) { x.onclick = function () { readAll(); e.bands.splice(Number(x.dataset.bx), 1); draw(); }; });
    }
    draw();
    var addCap = function (v) { readAll(); v = String(v || "").trim(); if (v && e.capacities.indexOf(v) === -1) e.capacities.push(v); draw(); };
    $("#mcapadd", b).onclick = function () { addCap($("#mcap", b).value); $("#mcap", b).value = ""; };
    $("#mcap", b).addEventListener("keydown", function (ev) { if (ev.key === "Enter") { addCap(this.value); this.value = ""; } });
    $$("[data-cs]", b).forEach(function (x) { x.onclick = function () { addCap(x.dataset.cs); }; });
    $("#mcoladd", b).onclick = function () { readAll(); e.colors.push({ name: "", hex: "#000000", sizes: [] }); draw(); $$(".cn", b).slice(-1)[0].focus(); };
    if (watch) {
      $("#mbandadd", b).onclick = function () { readAll(); e.bands.push({ name: "", options: [], sizes: [] }); draw(); $$(".bn", b).slice(-1)[0].focus(); };
      $$("[data-bs]", b).forEach(function (x) { x.onclick = function () { readAll(); if (!e.bands.some(function (y) { return y.name === x.dataset.bs; })) e.bands.push({ name: x.dataset.bs, options: [], sizes: [] }); draw(); }; });
    }
    $("#mcopy", b).onchange = function () { var id = Number(this.value), src = A.models.find(function (x) { return x.id === id; }); if (!src) return; e.capacities = src.capacities.slice(); e.colors = JSON.parse(JSON.stringify(src.colors)); e.bands = JSON.parse(JSON.stringify(src.bands || [])); draw(); };
    $("#mx", b).onclick = closeModal;
    $("#ms", b).onclick = act(async function () { readAll(); await api("/api/admin/models/" + e.id, { method: "PUT", body: { name: $("#mn", b).value, active: $("#mact", b).checked, capacities: e.capacities, colors: e.colors, bands: e.bands } }); closeModal(); toast("บันทึกแล้ว"); await refresh(); viewAdmin(); });
    $("#mdel", b).onclick = act(async function () { if (!confirm("ลบรุ่น " + e.name + " พร้อมข้อมูลทั้งหมด?")) return; await api("/api/admin/models/" + e.id, { method: "DELETE" }); closeModal(); await refresh(); viewAdmin(); });
  }

  // --- suppliers
  function adminSuppliers() {
    $("#atab").innerHTML = '<div class="card"><div class="row"><b>ซัพพลายเออร์ (ขั้นที่ 4)</b><span class="spacer"></span><input class="i" id="news" placeholder="ชื่อซัพพลายเออร์" style="width:200px"><button class="btn" id="adds">+ เพิ่ม</button></div>' +
      '<p class="small muted">มีโลโก้ → แสดงโลโก้บนสติ๊กเกอร์ · ไม่มีโลโก้ → แสดงชื่อเป็นตัวอักษร</p><div class="list">' + A.suppliers.map(function (s, i) {
        return '<div class="it' + (s.active ? "" : " off") + '"><div class="slogo">' + (s.logo ? logoImg(s.logo, s.name, 110, 28, "px", "") : '<span class="muted small">ไม่มีโลโก้</span>') + '</div><div class="main"><input class="i" value="' + esc(s.name) + '" data-sn="' + s.id + '" style="max-width:220px"> <label class="small"><input type="checkbox" data-sa="' + s.id + '"' + (s.active ? " checked" : "") + '> แสดงที่หน้าสาขา</label>' +
          '<div class="small">ใช้กับหมวด: ' + A.categories.map(function (c) { return '<label><input type="checkbox" data-scat="' + s.id + '" value="' + c + '"' + (!s.categories || s.categories.indexOf(c) > -1 ? " checked" : "") + "> " + c + "</label>"; }).join(" ") + "</div></div>" +
          '<label class="btn sm ghost">อัปโหลดโลโก้<input type="file" accept="image/png,image/jpeg,image/webp" data-sl="' + s.id + '" hidden></label>' + (s.logo ? '<button class="btn sm ghost" data-slx="' + s.id + '">ลบโลโก้</button>' : "") +
          '<button class="btn sm ghost" data-su="' + s.id + '"' + (i ? "" : " disabled") + '>▲</button><button class="btn sm ghost" data-sd="' + s.id + '"' + (i < A.suppliers.length - 1 ? "" : " disabled") + '>▼</button><button class="btn sm danger" data-sx="' + s.id + '">ลบ</button></div>';
      }).join("") + "</div></div>";
    var save = act(async function (id) { await api("/api/admin/suppliers/" + id, { method: "PUT", body: { name: $('[data-sn="' + id + '"]').value, active: $('[data-sa="' + id + '"]').checked, categories: $$('[data-scat="' + id + '"]:checked').map(function (x) { return x.value; }) } }); toast("บันทึกแล้ว"); await refresh(); A = await api("/api/admin/catalog"); });
    $$("[data-scat]").forEach(function (i) { i.onchange = function () { save(i.dataset.scat); }; });
    $$("[data-sn]").forEach(function (i) { i.onchange = function () { save(i.dataset.sn); }; });
    $$("[data-sa]").forEach(function (i) { i.onchange = function () { save(i.dataset.sa); }; });
    $("#adds").onclick = act(async function () { var n = $("#news").value.trim(); if (!n) return; await api("/api/admin/suppliers", { method: "POST", body: { name: n } }); await refresh(); viewAdmin(); });
    $$("[data-sl]").forEach(function (i) { i.onchange = act(async function () { var fd = new FormData(); fd.append("logo", i.files[0]); await api("/api/admin/suppliers/" + i.dataset.sl + "/logo", { method: "POST", body: fd }); toast("อัปโหลดโลโก้แล้ว"); await refresh(); viewAdmin(); }); });
    $$("[data-slx]").forEach(function (b) { b.onclick = act(async function () { await api("/api/admin/suppliers/" + b.dataset.slx + "/logo", { method: "DELETE" }); await refresh(); viewAdmin(); }); });
    $$("[data-su],[data-sd]").forEach(function (b) { b.onclick = act(async function () { await api("/api/admin/suppliers/" + (b.dataset.su || b.dataset.sd) + "/move", { method: "POST", body: { dir: b.dataset.su ? "up" : "down" } }); await refresh(); viewAdmin(); }); });
    $$("[data-sx]").forEach(function (b) { b.onclick = act(async function () { if (!confirm("ลบซัพพลายเออร์นี้?")) return; await api("/api/admin/suppliers/" + b.dataset.sx, { method: "DELETE" }); await refresh(); viewAdmin(); }); });
  }

  // --- template designer
  var EL_LABEL = { model: "รุ่น", capacity: "ความจุ / ขนาดตัวเรือน", color: "สีเครื่อง / สีตัวเรือน", band: "ประเภทสาย (Watch)", bandOption: "ตัวเลือกสาย (Watch)", supplier: "ซัพพลายเออร์", text: "ข้อความคงที่" };
  function adminTemplate() {
    var t = JSON.parse(JSON.stringify(A.templates[ui.tplCat]));
    var sm = A.models.filter(function (m) { return m.category === ui.tplCat; });
    var sample = (sm.find(function (m) { return m.capacities.length && m.colors.length; }) || sm[0] || {}).id;
    $("#atab").innerHTML = '<div class="tabs">' + A.categories.map(function (c) { return '<button class="tab sm' + (ui.tplCat === c ? " on" : "") + '" data-tc="' + c + '">เทมเพลต ' + c + "</button>"; }).join("") + "</div>" +
      '<div class="editor"><div class="card"><div class="grid4">' + field("ระยะขอบในช่อง (มม.)", '<input class="i" type="number" step="0.1" id="tpad" value="' + t.padding + '">') +
      field("แนวตั้ง", '<select class="i" id="tval"><option value="center"' + (t.valign === "center" ? " selected" : "") + '>กึ่งกลาง</option><option value="top"' + (t.valign === "top" ? " selected" : "") + ">ชิดบน</option></select>") +
      field("ระยะบรรทัด", '<input class="i" type="number" step="0.05" id="tlh" value="' + t.lineHeight + '">') + "</div>" +
      '<div id="tels"></div><div class="row"><select class="i" id="tnew" style="width:auto">' + Object.keys(EL_LABEL).map(function (k) { return '<option value="' + k + '">' + EL_LABEL[k] + "</option>"; }).join("") + '</select><button class="btn sm ghost" id="tadd">+ เพิ่มบรรทัด</button></div>' +
      '<div class="err" id="terr"></div><div class="row"><button class="btn" id="tsave">บันทึกเทมเพลต</button><span class="small muted">บันทึกแล้วหน้าสาขาใช้ทันที</span></div></div>' +
      '<div class="card"><b>ตัวอย่าง</b><div class="grid2" style="margin-top:8px">' +
      field("รุ่นตัวอย่าง", '<select class="i" id="smod">' + sm.map(function (m) { return '<option value="' + m.id + '"' + (m.id === sample ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") + "</select>") +
      field("ซัพพลายเออร์", '<select class="i" id="ssup">' + A.suppliers.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + "</option>"; }).join("") + "</select>") + "</div>" +
      '<div class="pvbox"><div class="zoom3" id="tpv"></div></div><div class="center small muted">ขยาย 3 เท่า · ขนาดจริง ' + L().cellW + " × " + L().cellH + ' มม.</div><div class="pvbox" id="tpv1"></div><div class="center small muted">ขนาดจริง</div><div class="err" id="tover"></div></div></div>';
    $$("[data-tc]").forEach(function (b) { b.onclick = function () { ui.tplCat = b.dataset.tc; adminTemplate(); }; });
    function sampleVals() {
      var mid = Number($("#smod") ? $("#smod").value : 0), sid = Number($("#ssup") ? $("#ssup").value : 0);
      var m = A.models.find(function (x) { return x.id === mid; }) || { name: "ชื่อรุ่น", capacities: [], colors: [] };
      var s = A.suppliers.find(function (x) { return x.id === sid; }) || { name: "Supplier" };
      var bd = (m.bands || [])[0];
      return { model: m.name, capacity: m.capacities[0] || (ui.tplCat === "Watch" ? "44mm" : "256GB"), color: m.colors[0] || { name: "สีตัวอย่าง", hex: "#3d4466" },
        band: bd ? bd.name : (ui.tplCat === "Watch" ? "Sport Band" : ""), bandOption: bd ? (bd.options[0] || "") : (ui.tplCat === "Watch" ? "M/L" : ""), supplier: { name: s.name, logo: s.logo } };
    }
    function drawEls() {
      $("#tels").innerHTML = t.elements.map(function (e, i) {
        return '<div class="tel"><div class="row"><b>' + (i + 1) + ". " + EL_LABEL[e.type] + '</b><span class="spacer"></span><button class="btn sm ghost" data-eu="' + i + '"' + (i ? "" : " disabled") + '>▲</button><button class="btn sm ghost" data-ed="' + i + '"' + (i < t.elements.length - 1 ? "" : " disabled") + '>▼</button><button class="x" data-ex="' + i + '">×</button></div>' +
          '<div class="grid4">' +
          (e.type === "text" ? field("ข้อความ", '<input class="i" data-k="text" data-i="' + i + '" value="' + esc(e.text || "") + '">') : "") +
          (e.type === "supplier" ? field("โลโก้กว้างไม่เกิน (มม.)", '<input class="i" type="number" step="0.1" data-k="logoW" data-i="' + i + '" value="' + (e.logoW || 21.3) + '">') + field("โลโก้สูงไม่เกิน (มม.)", '<input class="i" type="number" step="0.1" data-k="logoH" data-i="' + i + '" value="' + e.logoH + '">') : "") +
          field("ฟอนต์", '<select class="i" data-k="font" data-i="' + i + '">' + A.fonts.map(function (f) { return "<option" + (f === e.font ? " selected" : "") + ">" + f + "</option>"; }).join("") + "</select>") +
          field("ขนาด (pt)", '<input class="i" type="number" step="0.5" data-k="size" data-i="' + i + '" value="' + e.size + '">') +
          field("สีตัวอักษร", '<input type="color" class="i cpick" data-k="color" data-i="' + i + '" value="' + e.color + '">' + (e.type === "color" ? '<label class="small"><input type="checkbox" data-k="useItemColor" data-i="' + i + '"' + (e.useItemColor ? " checked" : "") + "> ใช้สีของสีเครื่อง</label>" : "")) +
          field("จัดวาง", '<select class="i" data-k="align" data-i="' + i + '">' + [["left", "ชิดซ้าย"], ["center", "กึ่งกลาง"], ["right", "ชิดขวา"]].map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === e.align ? " selected" : "") + ">" + a[1] + "</option>"; }).join("") + "</select>") +
          field("ระยะห่างด้านบน (มม.)", '<input class="i" type="number" step="0.1" data-k="mt" data-i="' + i + '" value="' + e.mt + '">') +
          (e.type !== "supplier" && e.type !== "text" ? field("ข้อความหน้า", '<input class="i" data-k="prefix" data-i="' + i + '" value="' + esc(e.prefix) + '" placeholder="เช่น - ">') + field("ข้อความท้าย", '<input class="i" data-k="suffix" data-i="' + i + '" value="' + esc(e.suffix) + '">') : "") +
          '<div class="field"><label class="small"><input type="checkbox" data-k="bold" data-i="' + i + '"' + (e.bold ? " checked" : "") + '> ตัวหนา</label> <label class="small"><input type="checkbox" data-k="italic" data-i="' + i + '"' + (e.italic ? " checked" : "") + "> ตัวเอียง</label></div></div></div>";
      }).join("");
      $$("[data-k]", $("#tels")).forEach(function (inp) {
        function upd() { var e = t.elements[Number(inp.dataset.i)], k = inp.dataset.k; e[k] = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? Number(inp.value) : inp.value; preview(); }
        inp.addEventListener("input", upd); inp.addEventListener("change", upd);
      });
      $$("[data-eu],[data-ed]", $("#tels")).forEach(function (bt) { bt.onclick = function () { var i = Number(bt.dataset.eu || bt.dataset.ed), j = i + (bt.dataset.eu ? -1 : 1); var x = t.elements[i]; t.elements[i] = t.elements[j]; t.elements[j] = x; drawEls(); preview(); }; });
      $$("[data-ex]", $("#tels")).forEach(function (bt) { bt.onclick = function () { t.elements.splice(Number(bt.dataset.ex), 1); drawEls(); preview(); }; });
    }
    function preview() {
      t.padding = Number($("#tpad").value); t.valign = $("#tval").value; t.lineHeight = Number($("#tlh").value);
      var h = stickerHTML(t, sampleVals()); $("#tpv").innerHTML = h; $("#tpv1").innerHTML = h;
      afterRender($("#atab"), function () { var o = $("#tpv1 .stk.over"); $("#tover").textContent = o ? "ข้อความยาวเกินช่อง — ลดขนาดตัวอักษรหรือระยะห่าง" : ""; });
    }
    drawEls(); preview();
    ["#tpad", "#tval", "#tlh", "#smod", "#ssup"].forEach(function (s) { $(s).addEventListener("input", preview); $(s).addEventListener("change", preview); });
    $("#tadd").onclick = function () { var ty = $("#tnew").value; t.elements.push({ type: ty, font: "Helvetica", size: 8, bold: false, italic: false, color: "#000000", align: "center", mt: 0.3, prefix: "", suffix: "", logoW: 21.3, logoH: 6.35, useItemColor: true, text: ty === "text" ? "ข้อความ" : "" }); drawEls(); preview(); };
    $("#tsave").onclick = act(async function () { preview(); await api("/api/admin/template/" + ui.tplCat, { method: "PUT", body: t }); toast("บันทึกเทมเพลตแล้ว"); await refresh(); A.templates = C.templates; });
  }

  // --- paper
  function adminPaper() {
    var l = L();
    var F = [["pageW", "ความกว้างกระดาษ (มม.)"], ["pageH", "ความสูงกระดาษ (มม.)"], ["cols", "จำนวนคอลัมน์"], ["rows", "จำนวนแถว"], ["cellW", "ความกว้างสติ๊กเกอร์ (มม.)"], ["cellH", "ความสูงสติ๊กเกอร์ (มม.)"], ["marginTop", "ขอบบน (มม.)"], ["marginLeft", "ขอบซ้าย (มม.)"], ["gapX", "ระยะห่างแนวนอน (มม.)"], ["gapY", "ระยะห่างแนวตั้ง (มม.)"], ["offsetX", "เลื่อนทั้งแผ่น ซ้าย(−)/ขวา(+)"], ["offsetY", "เลื่อนทั้งแผ่น ขึ้น(−)/ลง(+)"]];
    $("#atab").innerHTML = '<div class="layout"><div class="card"><div class="row" style="margin-bottom:8px"><span class="small">ขนาดกระดาษสำเร็จรูป:</span><button class="btn sm ghost" data-ps="210x297">A4 แนวตั้ง</button></div>' +
      '<div class="grid4">' + F.map(function (f) { return field(f[1], '<input class="i" type="number" step="0.1" id="l_' + f[0] + '" value="' + l[f[0]] + '">'); }).join("") + "</div>" +
      '<label><input type="checkbox" id="l_showBorders"' + (l.showBorders ? " checked" : "") + "> พิมพ์เส้นขอบสติ๊กเกอร์</label>" +
      '<div class="err" id="lerr"></div><div class="row"><button class="btn" id="lsave">บันทึก</button><button class="btn ghost" id="ltest">พิมพ์หน้าทดสอบ (กรอบ + เลขช่อง)</button><button class="btn ghost" id="lreset">ค่าเริ่มต้น (A4 50 ช่อง)</button></div>' +
      '<div class="note" style="margin-top:10px">พิมพ์หน้าทดสอบลงกระดาษธรรมดา (สเกล 100%) → วางทาบกระดาษสติ๊กเกอร์ → ถ้าเลื่อนทั้งแผ่นปรับ "เลื่อนทั้งแผ่น" / ถ้าค่อยๆ เลื่อนทีละแถวปรับขนาดหรือระยะห่าง</div></div>' +
      '<div class="card"><b>ตัวอย่าง</b><div class="sheetwrap" id="lpv"></div></div></div>';
    function read() { var v = {}; F.forEach(function (f) { v[f[0]] = Number($("#l_" + f[0]).value); }); v.showBorders = $("#l_showBorders").checked; return v; }
    function withLayout(v, fn) { var s = C.layout; C.layout = Object.assign({}, s, v); try { return fn(); } finally { C.layout = s; } }
    function pv() { withLayout(read(), function () { $("#lpv").innerHTML = buildSheets([], 1, { borders: true, numbers: true })[0]; scaleSheets($("#lpv").parentNode, $("#lpv").parentNode.clientWidth - 34); }); }
    $$("input", $("#atab")).forEach(function (i) { i.addEventListener("input", pv); });
    $$("[data-ps]").forEach(function (b) { b.onclick = function () { var p = b.dataset.ps.split("x"); $("#l_pageW").value = p[0]; $("#l_pageH").value = p[1]; pv(); }; });
    pv();
    $("#lsave").onclick = act(async function () { try { C.layout = await api("/api/admin/layout", { method: "PUT", body: read() }); applyPageSize(); $("#lerr").textContent = ""; toast("บันทึกแล้ว"); } catch (e) { if (e.status === 401) throw e; $("#lerr").textContent = e.message; } });
    $("#ltest").onclick = function () { var v = read(), saved = C.layout; C.layout = Object.assign({}, saved, v); var h = buildSheets([], 1, { borders: true, numbers: true }); printSheets(h); C.layout = saved; };
    $("#lreset").onclick = function () { var d = { pageW: 210, pageH: 297, cols: 5, rows: 10, cellW: 38, cellH: 27, marginTop: 9.45, marginLeft: 2, gapX: 4, gapY: 0.9, offsetX: 0, offsetY: 0 }; Object.keys(d).forEach(function (k) { $("#l_" + k).value = d[k]; }); pv(); };
  }
  function adminAccount() { var pv = passwordView(false); $("#atab").innerHTML = pv.html; pv.bind(); }

  /* ---------- routing ---------- */
  async function route() {
    closeModal(); renderNav();
    var h = (location.hash || "#/").split("?")[0];
    try { if (h === "#/admin") return await viewAdmin(); return viewPrint(); }
    catch (e) { setView('<div class="card">' + esc(e.message) + "</div>"); }
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", function () { if ((location.hash || "#/") === "#/") renderQueue(); });
  window.addEventListener("afterprint", function () { $("#printArea").innerHTML = ""; });
  refresh().then(route).catch(function () { setView('<div class="card">เชื่อมต่อระบบไม่สำเร็จ กรุณารีเฟรช</div>'); });
})();
