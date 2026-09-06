# Checkout & Rewards Service

Ecommerce backend with shopping carts, checkout, and a coupon rewards system.

## Phase 0: Project Setup ✓

**What's here:**
- Node.js + Express server
- SQLite database with schema
- Initial product seed data

**Key design decisions in Phase 0:**
1. **Database choice**: SQLite with better-sqlite3 for synchronous, transactional access
2. **WAL mode**: Enables better concurrency (multiple reads + one writer)
3. **Schema design**: Shows the invariants:
   - `carts.is_checked_out` - prevents a cart from being checked out twice
   - `checkout_request_id` UNIQUE on orders - prevents duplicate orders from retries
   - `coupons.is_redeemed` - prevents coupon double-spending
   - Foreign keys enabled - maintain referential integrity

**How to run:**
```bash
npm install
npm start
```

## Phases Ahead

- Phase 1: Products API + Cart endpoints
- Phase 2: Checkout (the hard part - transactions, concurrency)
- Phase 3: Coupon system + ordering logic
- Phase 4: Admin endpoints (coupon generation, reporting)
- Phase 5: Tests (concurrent scenarios, retries)
