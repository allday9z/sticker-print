# Sticker Print — สติ๊กเกอร์แปะกล่องสินค้า

Templates for product-box stickers (iPhone / iPad / Watch) laid out on an A4 label sheet and printed by the branches from the browser.

- **พิมพ์สติ๊กเกอร์** (`#/`, no login): choose templates + quantities, start cell (for part-used sheets), A4 preview, print at real size.
- **จัดการเทมเพลต** (`#/admin`, `ADMIN_PASSWORD`): model, capacity line, colours (each with its own text colour), up to 4 extra lines, SYNNEX logo, font size — live real-size preview; text auto-shrinks to fit the label.
- **ตั้งค่ากระดาษ** (`#/settings`): default A4 portrait 5 × 10 = 50 labels, 42 × 27.9 mm, top margin 9 mm; offsets / gaps / sizes for calibration + printable test sheet.

Print dialog: A4, scale 100%, no "fit to page", no headers/footers.

```
DATABASE_URL=postgres://… ADMIN_PASSWORD=… PORT=3000 bun server.ts
```
Tables `sticker_templates`, `sticker_settings` (shared Postgres), created on start. The logo comes from the sample Pages file.
