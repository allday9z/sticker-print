# Sticker Print — สติ๊กเกอร์แปะกล่องสินค้า (v2)

Branches pick **model → capacity → colour → supplier** and print stickers from the admin's template on an A4 label sheet.

- **Branch page** (`#/`, no login, read-only): categories iPhone / iPad (Watch later), step-by-step choices that only show the capacities / colours configured for the chosen model, real-size preview, queue with quantities, start cell for part-used sheets, A4 preview, print at real size.
- **Admin** (`#/admin`, Smile only): product data (models, capacities, colours with display colour), suppliers (+ logo upload, PNG/JPG/WEBP checked by magic bytes), sticker template per category (elements: model / capacity / colour / supplier / fixed text — font, size, bold/italic, colour, alignment, spacing, prefix/suffix), paper & label size + calibration test sheet, password change.
- **Permissions on the server**: every write is under `/api/admin/*` and needs the admin session (HMAC-signed cookie, invalidated on password change); cross-site writes rejected. The admin password is hashed in the DB; the first login with the initial `ADMIN_PASSWORD` must set a new password before anything else works.
- Seed data = only what was confirmed: iPhone + iPad model lists, suppliers Synnex (logo) / VST / AIS. Capacities and colours are entered by the admin.

```
DATABASE_URL=postgres://… ADMIN_PASSWORD=<initial> PORT=3000 bun server.ts
```
Tables: sticker_models / sticker_capacities / sticker_colors / sticker_suppliers / sticker_settings (layout, template:<category>, admin).
