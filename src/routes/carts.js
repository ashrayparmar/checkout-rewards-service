const express = require('express');
const { pool } = require('../db');
const { generateId } = require('../helpers');

const router = express.Router();

// POST /carts - create a new cart
router.post('/', async (req, res) => {
  try {
    const { customer_id } = req.body;
    const cartId = generateId();

    await pool.query(
      `INSERT INTO carts (id, customer_id) VALUES ($1, $2)`,
      [cartId, customer_id || null]
    );

    const result = await pool.query('SELECT * FROM carts WHERE id = $1', [cartId]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /carts/:id - view a cart with its items
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cartResult = await pool.query('SELECT * FROM carts WHERE id = $1', [id]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    const itemsResult = await pool.query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price_cents
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1`,
      [id]
    );

    res.json({ ...cartResult.rows[0], items: itemsResult.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /carts/:id/items - add item to cart
router.post('/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, quantity } = req.body;

    if (!product_id || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid product_id or quantity' });
    }

    // Verify cart exists and not checked out
    const cartResult = await pool.query('SELECT * FROM carts WHERE id = $1', [id]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    if (cartResult.rows[0].is_checked_out) {
      return res.status(400).json({ error: 'Cannot add items to checked-out cart' });
    }

    // Verify product exists
    const prodResult = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (prodResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const itemId = generateId();

    try {
      await pool.query(
        `INSERT INTO cart_items (id, cart_id, product_id, quantity)
         VALUES ($1, $2, $3, $4)`,
        [itemId, id, product_id, quantity]
      );
    } catch (e) {
      // Item already exists in cart, update quantity instead
      if (e.code === '23505') { // PostgreSQL UNIQUE violation
        await pool.query(
          `UPDATE cart_items SET quantity = quantity + $1
           WHERE cart_id = $2 AND product_id = $3`,
          [quantity, id, product_id]
        );
      } else {
        throw e;
      }
    }

    const itemResult = await pool.query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price_cents
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1 AND ci.product_id = $2`,
      [id, product_id]
    );

    res.status(201).json(itemResult.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /carts/:id/items/:productId - remove item from cart
router.delete('/:id/items/:productId', async (req, res) => {
  try {
    const { id, productId } = req.params;

    // Verify cart exists and not checked out
    const cartResult = await pool.query('SELECT * FROM carts WHERE id = $1', [id]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    if (cartResult.rows[0].is_checked_out) {
      return res.status(400).json({ error: 'Cannot modify checked-out cart' });
    }

    const result = await pool.query(
      `DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
      [id, productId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found in cart' });
    }

    res.json({ success: true, message: 'Item removed from cart' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
