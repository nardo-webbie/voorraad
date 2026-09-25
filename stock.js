import { db, checkAuth, fail, rows } from '../lib/db.js';

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    const c = await db();

    if (req.method === 'GET') {
      // Alle producten met voorraad of een minimum (voor de boodschappenlijst)
      const products = rows(await c.execute(`
        SELECT p.*, COALESCE(SUM(s.qty), 0) AS total
        FROM products p LEFT JOIN stock s ON s.barcode = p.barcode
        GROUP BY p.barcode
        HAVING total > 0 OR p.min_qty > 0
        ORDER BY p.name COLLATE NOCASE`));
      const batches = rows(await c.execute(
        `SELECT id, barcode, location, expiry, qty FROM stock WHERE qty > 0
         ORDER BY CASE WHEN expiry = '' THEN 1 ELSE 0 END, expiry`));
      return res.json({ products, batches });
    }

    if (req.method === 'POST') {
      // { barcode, delta, location?, expiry?, id? }
      const { barcode, id } = req.body || {};
      const delta = parseInt(req.body?.delta, 10);
      if (!barcode || !delta) return res.status(400).json({ error: 'barcode en delta zijn verplicht' });

      if (delta > 0 && !id) {
        const location = req.body.location || 'Voorraadkast';
        const expiry = req.body.expiry || '';
        await c.execute({
          sql: `INSERT INTO stock (barcode, location, expiry, qty) VALUES (?, ?, ?, ?)
                ON CONFLICT(barcode, location, expiry)
                DO UPDATE SET qty = stock.qty + excluded.qty, updated_at = datetime('now')`,
          args: [barcode, location, expiry, delta],
        });
      } else if (id) {
        await c.execute({
          sql: `UPDATE stock SET qty = MAX(qty + ?, 0), updated_at = datetime('now') WHERE id = ?`,
          args: [delta, id],
        });
      } else {
        // Verbruiken zonder specifieke partij: eerst wat het eerst verloopt (FIFO)
        let left = -delta;
        const list = rows(await c.execute({
          sql: `SELECT id, qty FROM stock WHERE barcode = ? AND qty > 0
                ORDER BY CASE WHEN expiry = '' THEN 1 ELSE 0 END, expiry, id`,
          args: [barcode],
        }));
        const stmts = [];
        for (const b of list) {
          if (left <= 0) break;
          const take = Math.min(left, Number(b.qty));
          stmts.push({ sql: `UPDATE stock SET qty = qty - ?, updated_at = datetime('now') WHERE id = ?`, args: [take, b.id] });
          left -= take;
        }
        if (stmts.length) await c.batch(stmts, 'write');
      }
      await c.execute('DELETE FROM stock WHERE qty <= 0');
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Methode niet toegestaan' });
  } catch (e) {
    fail(res, e);
  }
}
