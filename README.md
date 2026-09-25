# Voorraad – barcode scanner voor levensmiddelen

PWA (Vercel + Turso). Scan een barcode → product wordt opgezocht in Open Food Facts → toevoegen/verbruiken per locatie en houdbaarheidsdatum.

## Deploy
1. Turso: `turso db create voorraad` → `turso db show voorraad --url` en `turso db tokens create voorraad`
2. Vercel env vars:
   - `TURSO_DATABASE_URL` (libsql://…)
   - `TURSO_AUTH_TOKEN`
   - `APP_PIN` (optioneel: pincode om de app af te schermen)
3. Deploy. Tabellen worden bij de eerste aanroep automatisch aangemaakt.

## Structuur
- `index.html`, `app.js`, `style.css` – frontend (Android: native BarcodeDetector, iPhone: ZXing-fallback via jsDelivr)
- `api/products.js` – product opzoeken (eigen DB → Open Food Facts) en bewerken
- `api/stock.js` – voorraad ophalen en muteren (verbruiken = eerst wat het eerst verloopt)
