const express = require('express');
const bodyParser = require('body-parser');
const { pool, initializeDatabase } = require('./db');
const { attachRoutes } = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Enable CORS for frontend on port 3001
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Seed products
async function seedProducts() {
  const products = [
    { id: 'prod_laptop', name: 'Laptop', price_cents: 100000, inventory: 5 },
    { id: 'prod_mouse', name: 'Wireless Mouse', price_cents: 2500, inventory: 50 },
    { id: 'prod_keyboard', name: 'Mechanical Keyboard', price_cents: 15000, inventory: 20 },
    { id: 'prod_monitor', name: '4K Monitor', price_cents: 45000, inventory: 3 },
    { id: 'prod_hdmi', name: 'HDMI Cable', price_cents: 500, inventory: 200 },
  ];

  for (const p of products) {
    try {
      await pool.query(
        `INSERT INTO products (id, name, price_cents, available_inventory)
         VALUES ($1, $2, $3, $4)`,
        [p.id, p.name, p.price_cents, p.inventory]
      );
    } catch (e) {
      // Product already exists, skip
    }
  }

  console.log('Products seeded');
}

// Initialize and start
(async () => {
  try {
    await initializeDatabase();
    await seedProducts();
    attachRoutes(app);

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
})();
