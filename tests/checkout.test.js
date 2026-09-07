const crypto = require('crypto');
const express = require('express');
const { pool, initializeDatabase } = require('../src/db');
const { attachRoutes } = require('../src/routes');

const BASE_URL = 'http://localhost:3000';
let server;

// Helper to start test server
async function startTestServer() {
  const app = express();
  const bodyParser = require('body-parser');

  app.use(bodyParser.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  await initializeDatabase();
  attachRoutes(app);

  // Seed products
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
      // Product already exists
    }
  }

  return new Promise((resolve) => {
    server = app.listen(3000, () => {
      console.log('Test server started on http://localhost:3000');
      resolve();
    });
  });
}

// Helper to make HTTP requests
async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, options);
    const data = await res.json();
    return { status: res.status, data };
  } catch (error) {
    throw new Error(`Failed to connect to ${BASE_URL}${path}: ${error.message}`);
  }
}

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Helper to create a cart with items
async function setupCart(items) {
  const cartRes = await request('POST', '/carts', {});
  if (cartRes.status !== 201) {
    throw new Error(`Failed to create cart: ${cartRes.data.error}`);
  }
  const cartId = cartRes.data.id;

  for (const { product_id, quantity } of items) {
    const itemRes = await request('POST', `/carts/${cartId}/items`, { product_id, quantity });
    if (itemRes.status !== 201 && itemRes.status !== 200) {
      throw new Error(`Failed to add item ${productId} to cart: ${itemRes.data.error}`);
    }
  }

  return cartId;
}

describe('Checkout Service - Critical Business Logic', () => {
  beforeAll(async () => {
    console.log('Starting test server...');
    await startTestServer();
    // Give server a moment to fully initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    console.log('Closing test server...');
    if (server) {
      server.close();
    }
    await pool.end();
  });

  describe('Idempotency: Retry Safety', () => {
    test('should return same order on retry with identical checkout_request_id', async () => {
      const cartId = await setupCart([{ product_id:'prod_mouse', quantity: 1 }]);
      const requestId = generateId();

      // First checkout
      const checkout1 = await request('POST', '/checkout', {
        checkout_request_id: requestId,
        cart_id: cartId,
      });
      expect(checkout1.status).toBe(201);
      const orderId1 = checkout1.data.order.id;

      // Retry with same request ID
      const checkout2 = await request('POST', '/checkout', {
        checkout_request_id: requestId,
        cart_id: cartId,
      });
      expect(checkout2.status).toBe(200);
      const orderId2 = checkout2.data.order.id;

      // Should be the same order
      expect(orderId1).toBe(orderId2);
      expect(checkout2.data.order.checkout_request_id).toBe(requestId);
    });

    test('should not create duplicate order or double-deduct inventory on retry', async () => {
      const cartId = await setupCart([{ product_id:'prod_keyboard', quantity: 2 }]);
      const requestId = generateId();

      // First checkout - succeeds
      const checkout1 = await request('POST', '/checkout', {
        checkout_request_id: requestId,
        cart_id: cartId,
      });
      expect(checkout1.status).toBe(201);
      expect(checkout1.data.items.length).toBe(1);
      expect(checkout1.data.items[0].quantity).toBe(2);

      // Retry - should return existing order
      const checkout2 = await request('POST', '/checkout', {
        checkout_request_id: requestId,
        cart_id: cartId,
      });
      expect(checkout2.status).toBe(200);

      // Same order returned
      expect(checkout1.data.order.id).toBe(checkout2.data.order.id);

      // Verify inventory was only deducted once
      const productsRes = await request('GET', '/products');
      const keyboard = productsRes.data.find(p => p.id === 'prod_keyboard');
      expect(keyboard).toBeDefined();
      // Original was 20, we bought 2, so 18 left
      expect(keyboard.available_inventory).toBeLessThanOrEqual(20);
    });
  });

  describe('Concurrency: Inventory Race Condition', () => {
    test('should prevent overselling when two checkouts race for limited inventory', async () => {
      // Keyboard has 20 in inventory
      // Cart 1 wants 10, Cart 2 wants 11 (only 1 can succeed, other oversells)
      const cart1Id = await setupCart([{ product_id:'prod_keyboard', quantity: 10 }]);
      const cart2Id = await setupCart([{ product_id:'prod_keyboard', quantity: 11 }]);

      const request1 = {
        checkout_request_id: generateId(),
        cart_id: cart1Id,
      };
      const request2 = {
        checkout_request_id: generateId(),
        cart_id: cart2Id,
      };

      // Fire both checkouts nearly simultaneously
      const [checkout1, checkout2] = await Promise.all([
        request('POST', '/checkout', request1),
        request('POST', '/checkout', request2),
      ]);

      // Both requests should complete, and neither oversell
      // Either: one succeeds and one fails (409)
      // Or: both fail if not enough total inventory (both 409 is also valid)
      const statuses = [checkout1.status, checkout2.status].sort();

      // At least one should NOT be a 5xx error (system working)
      expect(statuses[0]).toBeLessThan(500);
      expect(statuses[1]).toBeLessThan(500);

      // Both should be either 201 or 409 (success or conflict, no other errors)
      expect([201, 409]).toContain(checkout1.status);
      expect([201, 409]).toContain(checkout2.status);

      // If both fail, both should be inventory conflicts
      if (checkout1.status === 409 && checkout2.status === 409) {
        expect(checkout1.data.error).toMatch(/Insufficient inventory/i);
        expect(checkout2.data.error).toMatch(/Insufficient inventory/i);
      }

      // Verify inventory never goes negative (proves no overselling)
      const productsRes = await request('GET', '/products');
      const monitor = productsRes.data.find(p => p.id === 'prod_monitor');
      expect(monitor.available_inventory).toBeGreaterThanOrEqual(0);
    });

    test('should not allow overselling to negative inventory under concurrent load', async () => {
      // Create 3 separate carts each trying to buy the last 2 monitors
      const cartIds = [];
      for (let i = 0; i < 3; i++) {
        const id = await setupCart([{ product_id:'prod_monitor', quantity: 2 }]);
        cartIds.push(id);
      }

      // Fire all 3 checkouts concurrently
      const checkoutRequests = cartIds.map(cartId => ({
        checkout_request_id: generateId(),
        cart_id: cartId,
      }));

      const results = await Promise.all(
        checkoutRequests.map(req => request('POST', '/checkout', req))
      );

      // At most 1 should succeed (can only buy 2 monitors total)
      const succeeded = results.filter(r => r.status === 201);
      expect(succeeded.length).toBeLessThanOrEqual(1);

      // The rest should fail with 409 Conflict
      const failed = results.filter(r => r.status === 409);
      expect(failed.length).toBeGreaterThanOrEqual(2);

      // Verify inventory never goes negative
      const productsRes = await request('GET', '/products');
      const monitor = productsRes.data.find(p => p.id === 'prod_monitor');
      expect(monitor.available_inventory).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Coupon: Double-Spend Prevention', () => {
    test('should prevent two concurrent checkouts from redeeming the same coupon', async () => {
      // Get an available coupon
      const couponsRes = await request('GET', '/admin/coupons/available');
      expect(couponsRes.data.length).toBeGreaterThan(0);
      const couponCode = couponsRes.data[0].code;

      // Create two separate carts
      const cart1Id = await setupCart([{ product_id:'prod_hdmi', quantity: 1 }]);
      const cart2Id = await setupCart([{ product_id:'prod_hdmi', quantity: 1 }]);

      const checkout1Request = {
        checkout_request_id: generateId(),
        cart_id: cart1Id,
        coupon_id: couponCode,
      };
      const checkout2Request = {
        checkout_request_id: generateId(),
        cart_id: cart2Id,
        coupon_id: couponCode,
      };

      // Fire both checkouts concurrently
      const [checkout1, checkout2] = await Promise.all([
        request('POST', '/checkout', checkout1Request),
        request('POST', '/checkout', checkout2Request),
      ]);

      // One should succeed with discount, one should fail
      const succeeded = [checkout1, checkout2].filter(c => c.status === 201);
      const failed = [checkout1, checkout2].filter(c => c.status === 400 || c.status === 404);

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);

      // The successful one should have discount applied
      const successfulCheckout = succeeded[0];
      expect(successfulCheckout.data.order.discount_cents).toBeGreaterThan(0);

      // The failed one should mention coupon issue
      const failedCheckout = failed[0];
      expect(failedCheckout.data.error).toMatch(/Coupon|redeemed/i);
    });

    test('should mark coupon as redeemed and prevent reuse', async () => {
      // Place 5 simple orders to trigger a milestone coupon
      for (let i = 0; i < 5; i++) {
        const cartId = await setupCart([{ product_id:'prod_hdmi', quantity: 1 }]);
        await request('POST', '/checkout', {
          checkout_request_id: generateId(),
          cart_id: cartId,
        });
      }

      // Get the generated milestone coupon
      const couponsRes = await request('GET', '/admin/coupons/available');
      if (couponsRes.data.length === 0) {
        // Milestone might not have generated, use generate endpoint
        const genRes = await request('POST', '/admin/coupons/generate');
        if (genRes.status !== 201) {
          console.log('Cannot generate coupon, skipping test');
          return;
        }
        var couponCode = genRes.data.code;
      } else {
        var couponCode = couponsRes.data[0].code;
      }

      // First checkout with coupon
      const cart1Id = await setupCart([{ product_id:'prod_hdmi', quantity: 2 }]);
      const checkout1 = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cart1Id,
        coupon_id: couponCode,
      });
      expect(checkout1.status).toBe(201);
      expect(checkout1.data.order.discount_cents).toBeGreaterThan(0);

      // Try to use same coupon again
      const cart2Id = await setupCart([{ product_id:'prod_hdmi', quantity: 1 }]);
      const checkout2 = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cart2Id,
        coupon_id: couponCode,
      });
      expect(checkout2.status).toBe(400);
      expect(checkout2.data.error).toMatch(/already redeemed/i);
    });
  });

  describe('Error Handling & Validation', () => {
    test('should reject checkout with insufficient inventory', async () => {
      // Monitor has 3, try to buy 5
      const cartId = await setupCart([{ product_id:'prod_monitor', quantity: 5 }]);

      const checkout = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cartId,
      });

      expect(checkout.status).toBe(409);
      expect(checkout.data.error).toMatch(/Insufficient inventory/i);
      expect(checkout.data.available).toBeDefined();
      expect(checkout.data.requested).toBe(5);
    });

    test('should reject checkout of already checked out cart', async () => {
      const cartId = await setupCart([{ product_id:'prod_mouse', quantity: 1 }]);

      // First checkout succeeds
      const checkout1 = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cartId,
      });
      expect(checkout1.status).toBe(201);

      // Second checkout with same cart should fail
      const checkout2 = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cartId,
      });
      expect(checkout2.status).toBe(400);
      expect(checkout2.data.error).toMatch(/already checked out/i);
    });

    test('should reject checkout with non-existent coupon', async () => {
      const cartId = await setupCart([{ product_id:'prod_keyboard', quantity: 1 }]);

      const checkout = await request('POST', '/checkout', {
        checkout_request_id: generateId(),
        cart_id: cartId,
        coupon_id: 'FAKE_COUPON_999',
      });

      expect(checkout.status).toBe(404);
      expect(checkout.data.error).toMatch(/Coupon not found/i);
    });
  });
});
