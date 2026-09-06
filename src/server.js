const express = require('express');
const bodyParser = require('body-parser');
const { db, initializeDatabase } = require('./db');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// Initialize database
initializeDatabase();

// Helper: generate IDs
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Simple health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Seed products
function seedProducts() {
  const products = [
    { id: 'prod_laptop', name: 'Laptop', price_cents: 100000, inventory: 5 },
    { id: 'prod_mouse', name: 'Wireless Mouse', price_cents: 2500, inventory: 50 },
    { id: 'prod_keyboard', name: 'Mechanical Keyboard', price_cents: 15000, inventory: 20 },
    { id: 'prod_monitor', name: '4K Monitor', price_cents: 45000, inventory: 3 },
    { id: 'prod_hdmi', name: 'HDMI Cable', price_cents: 500, inventory: 200 },
  ];

  products.forEach(p => {
    try {
      const insert = db.prepare(`
        INSERT INTO products (id, name, price_cents, available_inventory)
        VALUES (?, ?, ?, ?)
      `);
      insert.run(p.id, p.name, p.price_cents, p.inventory);
    } catch (e) {
      // Product already exists, skip
    }
  });

  console.log('Products seeded');
}

seedProducts();

// Placeholder endpoints (will implement in phases)
app.post('/carts', (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
