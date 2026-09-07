const express = require('express');
const { pool } = require('../db');
const { generateId } = require('../helpers');

const router = express.Router();

// POST /checkout - atomic checkout with transaction safety
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { checkout_request_id, cart_id, coupon_id } = req.body;

    if (!checkout_request_id || !cart_id) {
      return res.status(400).json({ error: 'checkout_request_id and cart_id required' });
    }

    await client.query('BEGIN');

    // Idempotency check: if checkout_request_id already exists, return that order
    const existingOrder = await client.query(
      'SELECT * FROM orders WHERE checkout_request_id = $1',
      [checkout_request_id]
    );
    if (existingOrder.rows.length > 0) {
      await client.query('COMMIT');
      const order = existingOrder.rows[0];
      const items = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [order.id]
      );
      return res.status(200).json({ order, items: items.rows });
    }

    // Validate cart exists and not already checked out
    const cartResult = await client.query(
      'SELECT * FROM carts WHERE id = $1',
      [cart_id]
    );
    if (cartResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cart not found' });
    }
    if (cartResult.rows[0].is_checked_out) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart already checked out' });
    }

    // Get cart items with product info
    const itemsResult = await client.query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.price_cents, p.available_inventory
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1`,
      [cart_id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Lock products and verify inventory (SELECT FOR UPDATE)
    const productIds = itemsResult.rows.map(row => row.product_id);
    const productsResult = await client.query(
      `SELECT id, available_inventory FROM products WHERE id = ANY($1) FOR UPDATE`,
      [productIds]
    );

    const inventoryMap = {};
    productsResult.rows.forEach(row => {
      inventoryMap[row.id] = row.available_inventory;
    });

    // Check all items have sufficient inventory
    for (const item of itemsResult.rows) {
      if (inventoryMap[item.product_id] < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Insufficient inventory',
          product_id: item.product_id,
          requested: item.quantity,
          available: inventoryMap[item.product_id]
        });
      }
    }

    // Deduct inventory for all items
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE products SET available_inventory = available_inventory - $1 WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Handle coupon if provided
    let discountCents = 0;
    if (coupon_id) {
      const couponResult = await client.query(
        'SELECT * FROM coupons WHERE id = $1',
        [coupon_id]
      );
      if (couponResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Coupon not found' });
      }
      const coupon = couponResult.rows[0];
      if (coupon.is_redeemed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Coupon already redeemed' });
      }

      // Mark coupon as redeemed
      await client.query(
        `UPDATE coupons SET is_redeemed = true, redeemed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [coupon_id]
      );

      // Calculate discount
      const subtotal = itemsResult.rows.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
      discountCents = Math.floor((subtotal * coupon.discount_percent) / 100);
    }

    // Calculate totals
    const subtotalCents = itemsResult.rows.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
    const totalCents = Math.max(0, subtotalCents - discountCents);

    // Create order
    const orderId = generateId();
    const orderResult = await client.query(
      `INSERT INTO orders (id, checkout_request_id, customer_id, subtotal_cents, discount_cents, total_cents, coupon_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orderId, checkout_request_id, cartResult.rows[0].customer_id || null, subtotalCents, discountCents, totalCents, coupon_id || null]
    );

    // Create order items
    for (const item of itemsResult.rows) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [generateId(), orderId, item.product_id, item.quantity, item.price_cents]
      );
    }

    // Mark cart as checked out
    await client.query(
      `UPDATE carts SET is_checked_out = true, checked_out_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [cart_id]
    );

    await client.query('COMMIT');

    // Post-transaction: check if milestone triggers (every 5th order)
    const orderCountResult = await client.query('SELECT COUNT(*) as count FROM orders');
    const orderCount = parseInt(orderCountResult.rows[0].count, 10);

    if (orderCount % 5 === 0) {
      // Generate a 10% off coupon for the milestone
      const couponId = generateId();
      await client.query(
        `INSERT INTO coupons (id, code, discount_percent)
         VALUES ($1, $2, $3)`,
        [couponId, `MILESTONE_${orderCount}`, 10]
      );

      await client.query(
        `INSERT INTO coupon_milestones (id, order_count, coupon_id)
         VALUES ($1, $2, $3)`,
        [generateId(), orderCount, couponId]
      );

      console.log(`Milestone triggered at order ${orderCount}: generated coupon ${couponId}`);
    }

    // Fetch order items for response
    const orderItems = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );

    res.status(201).json({
      order: orderResult.rows[0],
      items: orderItems.rows
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Transaction already rolled back or not in progress
    }

    // Handle UNIQUE constraint violation on checkout_request_id (should be rare due to idempotency check)
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Checkout request already processed' });
    }

    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
