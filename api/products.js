import { db, checkAuth, fail, rows } from '../lib/db.js';

const OFF_FIELDS = 'product_name,product_name_nl,generic_name_nl,brands,quantity,image_front_small_url,image_front_url';

async function lookupOFF(barcode) {
  const r = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=${OFF_FIELDS}`,
    { headers: { 'User-Agent': 'VoorraadApp/1.0 (persoonlijk gebruik)' } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product;
  const name = p.product_name_nl || p.product_name || p.generic_name_nl;
  if (!name) return null;
  return {
    barcode,
    name: name.trim(),
    brand: (p.brands || '').split(',')[0].trim(),
    quantity: p.quantity || '',
    image_url: p.image_front_small_url || p.image_front_url || '',
    source: 'openfoodfacts',
  };
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    const c = await db();

    if (req.method === 'GET') {
      const barcode = String(req.query.barcode || '').trim();
      if (!barcode) {
        return res.json(rows(await c.execute('SELECT * FROM products ORDER BY name')));
      }
      const hit = await c.execute({ sql: 'SELECT * FROM products WHERE barcode = ?', args: [barcode] });
      if (hit.rows.length) return res.json({ found: true, product: { ...hit.rows[0] } });

      const off = await lookupOFF(barcode).catch(() => null);
      if (!off) return res.json({ found: false, product: { barcode } });
      await c.execute({
        sql: `INSERT OR IGNORE INTO products (barcode, name, brand, quantity, image_url, source)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [off.barcode, off.name, off.brand, off.quantity, off.image_url, off.source],
      });
      return res.json({ found: true, product: { ...off, min_qty: 0 } });
    }

    if (req.method === 'POST') {
      const p = req.body || {};
      if (!p.barcode || !p.name) return res.status(400).json({ error: 'barcode en naam zijn verplicht' });
      await c.execute({
        sql: `INSERT INTO products (barcode, name, brand, quantity, image_url, min_qty, source)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(barcode) DO UPDATE SET
                name = excluded.name, brand = excluded.brand, quantity = excluded.quantity,
                image_url = CASE WHEN excluded.image_url <> '' THEN excluded.image_url ELSE products.image_url END,
                min_qty = excluded.min_qty`,
        args: [
          String(p.barcode), String(p.name).trim(), p.brand || '', p.quantity || '',
          p.image_url || '', Number(p.min_qty) || 0, p.source || 'manual',
        ],
      });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Methode niet toegestaan' });
  } catch (e) {
    fail(res, e);
  }
}
