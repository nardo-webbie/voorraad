import { createClient } from '@libsql/client';

let client;
let ready;

export function db() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  if (!ready) {
    ready = client.batch([
      `CREATE TABLE IF NOT EXISTS products (
        barcode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT DEFAULT '',
        quantity TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        min_qty INTEGER DEFAULT 0,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL REFERENCES products(barcode),
        location TEXT NOT NULL DEFAULT 'Voorraadkast',
        expiry TEXT NOT NULL DEFAULT '',
        qty INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE (barcode, location, expiry)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_stock_barcode ON stock(barcode)`,
    ], 'write').catch((e) => { ready = null; throw e; });
  }
  return ready.then(() => client);
}

export function checkAuth(req, res) {
  const pin = process.env.APP_PIN;
  if (pin && req.headers['x-app-pin'] !== pin) {
    res.status(401).json({ error: 'Onjuiste pincode' });
    return false;
  }
  return true;
}

export function fail(res, e) {
  console.error(e);
  res.status(500).json({ error: String(e?.message || e) });
}

export const rows = (rs) => rs.rows.map((r) => ({ ...r }));
