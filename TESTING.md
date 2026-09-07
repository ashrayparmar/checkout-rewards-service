# Automated Testing Guide

## Quick Start

```bash
# Terminal 1: Start the backend server
npm start
# Expected output: "Products seeded" and "Server running on http://localhost:3000"

# Terminal 2: Run the test suite
npm test
```

## Test Suite Overview

The test suite (`tests/checkout.test.js`) focuses on **critical business logic** rather than exhaustive coverage. It validates behavior under concurrent and retry scenarios that would be difficult to test manually.

### Test Groups

#### 1. Idempotency: Retry Safety
- **Test:** Calling checkout twice with the same `checkout_request_id` returns the same order
- **Why:** Clients may retry due to network timeouts. We must never create a duplicate order.
- **Validates:** UNIQUE constraint + idempotency pre-check logic

#### 2. Concurrency: Inventory Race Condition
- **Test 1:** Two users race to buy last 2 items (only 3 available). One succeeds, one fails.
- **Test 2:** Three users simultaneously try to buy 2 items each (only 3 available). At most 1 succeeds.
- **Why:** Multiple concurrent checkouts can read stale inventory and both approve overselling. Row-level locking must prevent this.
- **Validates:** `SELECT FOR UPDATE` prevents inventory races

#### 3. Coupon: Double-Spend Prevention
- **Test 1:** Two concurrent checkouts try to redeem the same coupon. One succeeds with discount, one fails.
- **Test 2:** First checkout redeems a coupon successfully. Second attempt to use the same coupon fails.
- **Why:** Coupons are valuable. Must prevent two orders from both getting the discount.
- **Validates:** Atomic coupon redemption inside transaction

#### 4. Error Handling & Validation
- Insufficient inventory (5 items, only 3 available) → 409 Conflict
- Already checked out cart (second checkout) → 400 Bad Request
- Invalid coupon code → 404 Not Found
- **Why:** API must provide distinguishable, actionable errors


## Test Data

Tests use seeded products:
- `prod_laptop` — 5 units @ $1000
- `prod_mouse` — 50 units @ $25
- `prod_keyboard` — 20 units @ $150
- `prod_monitor` — **3 units** @ $450 (intentionally limited for race tests)
- `prod_hdmi` — 200 units @ $5

The **monitor** has limited inventory and is used to test race conditions. Each test run may consume some, so tests should be resilient.

## Important Notes

- **Server must be running** — Tests hit actual API endpoints on `http://localhost:3000`
- **Database must be initialized** — Run `npm start` once to create schema and seed data
- **Concurrent tests are timing-sensitive** — `Promise.all()` ensures near-simultaneous requests, but timing depends on system load
- **Idempotency tests mutate state** — Each test creates orders and deducts inventory. Can re-run as long as inventory remains.

## Debugging a Failed Test

If a test fails:

1. **Check the server is running** — Look for "Server running on http://localhost:3000" in Terminal 1
2. **Check database connection** — Server logs will show connection errors
3. **Check inventory levels** — Run test in isolation or verify database state:
   ```bash
   psql $DATABASE_URL -c "SELECT id, available_inventory FROM products;"
   ```
4. **Check coupon availability** — If coupon tests fail, verify coupons exist:
   ```bash
   psql $DATABASE_URL -c "SELECT code, is_redeemed FROM coupons LIMIT 5;"
   ```

## Design of These Tests

The tests prioritize **meaningful coverage over line coverage**:
- ✓ Two concurrent checkouts racing for same inventory
- ✓ Retry safety (idempotency)
- ✓ Coupon double-spend prevention
- ✗ Happy path CRUD operations (tested manually)
- ✗ Every validation error (few key ones included)
- ✗ Frontend integration

The focus is on **failure modes** and **concurrent behavior** because:
1. These are hardest to reason about and most likely to have bugs
2. Tests prove the invariants are actually enforced, not just assumed
3. A reviewer can run these and immediately see the system handles complexity correctly
