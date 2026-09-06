const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'checkout.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for concurrency
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function initializeDatabase() {
  // Products table - immutable product catalog
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      available_inventory INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Carts table - shopping carts
  db.exec(`
    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      is_checked_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_out_at TEXT
    )
  `);

  // Cart items - items in carts
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cart_id) REFERENCES carts(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(cart_id, product_id)
    )
  `);

  // Orders table - immutable order records
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      checkout_request_id TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      coupon_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    )
  `);

  // Order items - immutable snapshot of what was ordered
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // Coupons table - discount coupons
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_percent INTEGER NOT NULL,
      is_redeemed INTEGER NOT NULL DEFAULT 0,
      redeemed_at TEXT,
      generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Coupon milestones - tracks which order counts triggered coupon generation
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupon_milestones (
      id TEXT PRIMARY KEY,
      order_count INTEGER NOT NULL UNIQUE,
      coupon_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    )
  `);

  console.log('Database initialized at', dbPath);
}

module.exports = { db, initializeDatabase };
