const express = require('express');
const { pool } = require('../db');
const { generateId } = require('../helpers');

const router = express.Router();

const MILESTONE_INTERVAL = 5;
const DISCOUNT_PERCENT = 10;

// GET /admin/coupons/available - list all available (unredeemed) coupons
router.get('/coupons/available', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, code, discount_percent FROM coupons WHERE is_redeemed = false ORDER BY generated_at DESC'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/coupons/generate - generate coupon for next unrewarded milestone
router.post('/coupons/generate', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get total order count
    const orderCountResult = await client.query('SELECT COUNT(*) as count FROM orders');
    const totalOrders = parseInt(orderCountResult.rows[0].count, 10);

    // Find next unrewarded milestone
    let nextMilestone = null;
    for (let m = MILESTONE_INTERVAL; m <= totalOrders + MILESTONE_INTERVAL; m += MILESTONE_INTERVAL) {
      // Check if milestone already has a coupon
      const existingResult = await client.query(
        'SELECT * FROM coupon_milestones WHERE order_count = $1',
        [m]
      );
      if (existingResult.rows.length === 0) {
        nextMilestone = m;
        break;
      }
    }

    if (!nextMilestone) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No unrewarded milestones available',
        total_orders: totalOrders,
        milestone_interval: MILESTONE_INTERVAL
      });
    }

    if (nextMilestone > totalOrders) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Milestone not yet reached',
        total_orders: totalOrders,
        next_milestone: nextMilestone,
        orders_needed: nextMilestone - totalOrders
      });
    }

    // Generate coupon
    const couponId = generateId();
    const couponCode = `ADMIN_${nextMilestone}`;

    await client.query(
      `INSERT INTO coupons (id, code, discount_percent)
       VALUES ($1, $2, $3)`,
      [couponId, couponCode, DISCOUNT_PERCENT]
    );

    // Record milestone
    await client.query(
      `INSERT INTO coupon_milestones (id, order_count, coupon_id)
       VALUES ($1, $2, $3)`,
      [generateId(), nextMilestone, couponId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      coupon_id: couponId,
      code: couponCode,
      discount_percent: DISCOUNT_PERCENT,
      milestone_order_count: nextMilestone,
      message: `Coupon generated for milestone ${nextMilestone}`
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Already rolled back
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /admin/reports/summary - comprehensive reporting (read-only)
router.get('/reports/summary', async (req, res) => {
  try {
    // Total orders
    const orderCountResult = await pool.query('SELECT COUNT(*) as count FROM orders');
    const totalOrders = parseInt(orderCountResult.rows[0].count, 10);

    // Revenue summary
    const revenueResult = await pool.query(
      `SELECT
        COALESCE(SUM(subtotal_cents), 0) as gross_revenue_cents,
        COALESCE(SUM(discount_cents), 0) as total_discounts_cents
       FROM orders`
    );
    const grossRevenue = parseInt(revenueResult.rows[0].gross_revenue_cents, 10);
    const totalDiscounts = parseInt(revenueResult.rows[0].total_discounts_cents, 10);
    const netRevenue = grossRevenue - totalDiscounts;

    // Coupon summary
    const couponSummaryResult = await pool.query(
      `SELECT
        COUNT(*) as total_coupons,
        SUM(CASE WHEN is_redeemed = true THEN 1 ELSE 0 END) as redeemed_count,
        SUM(CASE WHEN is_redeemed = false THEN 1 ELSE 0 END) as available_count
       FROM coupons`
    );
    const totalCoupons = parseInt(couponSummaryResult.rows[0].total_coupons, 10);
    const redeemedCoupons = parseInt(couponSummaryResult.rows[0].redeemed_count || 0, 10);
    const availableCoupons = parseInt(couponSummaryResult.rows[0].available_count || 0, 10);

    // Milestone summary
    const milestoneResult = await pool.query('SELECT COUNT(*) as count FROM coupon_milestones');
    const generatedMilestones = parseInt(milestoneResult.rows[0].count, 10);

    // Inventory sold per product
    const inventorySoldResult = await pool.query(
      `SELECT
        p.id,
        p.name,
        p.price_cents,
        COALESCE(SUM(oi.quantity), 0) as quantity_sold,
        COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) as revenue_cents
       FROM products p
       LEFT JOIN order_items oi ON p.id = oi.product_id
       GROUP BY p.id, p.name, p.price_cents
       ORDER BY quantity_sold DESC`
    );

    const inventorySold = inventorySoldResult.rows.map(row => ({
      product_id: row.id,
      name: row.name,
      price_cents: row.price_cents,
      quantity_sold: parseInt(row.quantity_sold, 10),
      revenue_cents: parseInt(row.revenue_cents, 10)
    }));

    // Reconciliation check
    const orderItemsRevenueResult = await pool.query(
      `SELECT COALESCE(SUM(quantity * unit_price_cents), 0) as order_items_revenue
       FROM order_items`
    );
    const orderItemsRevenue = parseInt(orderItemsRevenueResult.rows[0].order_items_revenue, 10);

    const reconciles = grossRevenue === orderItemsRevenue;

    res.json({
      timestamp: new Date().toISOString(),
      orders: {
        total_placed: totalOrders,
        next_milestone: Math.ceil((totalOrders + 1) / MILESTONE_INTERVAL) * MILESTONE_INTERVAL
      },
      revenue: {
        gross_cents: grossRevenue,
        total_discounts_cents: totalDiscounts,
        net_cents: netRevenue,
        gross_dollars: (grossRevenue / 100).toFixed(2),
        discounts_dollars: (totalDiscounts / 100).toFixed(2),
        net_dollars: (netRevenue / 100).toFixed(2)
      },
      coupons: {
        total_generated: totalCoupons,
        available: availableCoupons,
        redeemed: redeemedCoupons,
        milestones_triggered: generatedMilestones
      },
      inventory_sold: inventorySold,
      reconciliation: {
        gross_from_orders: grossRevenue,
        gross_from_order_items: orderItemsRevenue,
        reconciles,
        message: reconciles ? 'Revenue reconciles' : 'MISMATCH: Check data integrity'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
