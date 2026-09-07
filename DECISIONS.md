# Design Decisions & Rationale

## Why PostgreSQL?

I started with SQLite because it was simple and zero-setup. But once I needed proper transaction isolation and concurrent inventory management, SQLite's limitations became a real blocker. PostgreSQL gave us row-level locking (`SELECT FOR UPDATE`), which is essential when multiple users try to buy the same item simultaneously. Plus we could use Supabase for cloud hosting without managing database infrastructure ourselves.

## Transaction Safety & Row-Level Locking

The checkout process is wrapped in a transaction and uses `SELECT FOR UPDATE` on products. This locks the rows for the duration of the transaction, preventing another checkout from reading stale inventory numbers. Without this, two concurrent requests could both think there are 5 monitors available and both approve purchases that oversell.

The flow is: lock → check inventory → deduct → create order → commit. If anything fails, we rollback and the inventory stays intact.

## Idempotency via checkout_request_id

If a checkout request succeeds but the network drops before returning to the client, the client won't know if the order went through. They might retry. I've handled this by having the client generate a unique `checkout_request_id` and checking if we've already processed it. If we have, we just return the existing order instead of creating a duplicate.

This is a UNIQUE constraint on the database side plus a pre-check query, so even if somehow two requests slip through simultaneously, the constraint catches the duplicate and we return 409 conflict.

## Coupon Redemption Strategy

Coupons are marked as redeemed inside the same transaction as the order. This prevents the race condition where two users see the same coupon as available and both try to redeem it. We check `is_redeemed` before we mark it, and if it's already redeemed, the checkout fails immediately.

The milestone coupons (auto-generated every 5th order) happen *after* the transaction commits. This is intentional — because we don't want the milestone generation logic inside the transaction because it adds unpredictability. After commit, I check the order count, and if it's a multiple of 5, we generate the next milestone coupon outside the transaction.

## Why Discount Calculation Uses Floor

When you apply a 10% discount to $47.50, that's $4.75. I've used `Math.floor()` to round down to 475 cents, not round to nearest. This is standard in payments — you always round down so the customer pays slightly more than the mathematical discount, never less.

## Inventory Deduction Timing

Inventory is only deducted if all validations pass: cart exists, items are in stock, coupon is valid (if provided). We don't partially commit — either the entire order succeeds or nothing changes. This keeps the invariant that `order_items` revenue always matches the sum of `(quantity * unit_price)` across all orders.

## API Status Codes

- 201 Created: successful checkout or coupon generation
- 400 Bad Request: malformed input (missing fields, empty cart)
- 404 Not Found: cart doesn't exist, coupon not found
- 409 Conflict: inventory unavailable, cart already checked out, coupon already redeemed, duplicate checkout_request_id
- 500 Server Error: actual database/system errors

This makes it clear on the client side whether the error is the user's fault, the system's fault, or a business logic conflict.

## Why React + Vite

I could've done vanilla HTML with fetch, but the discount preview and dynamic coupon dropdown made state management messy. React keeps the discount calculation and UI sync straightforward. Vite is fast and has good HMR, which matters when iterating on styling and form layouts.

## Admin Dashboard in Main App

I've put the admin reports (summary, generate coupon) in the same React app instead of a separate admin dashboard. This was simpler for a prototype, but in production you'd probably split this into a separate authenticated admin-only service. For now it's just a section on the same page.

## Customer ID is Optional

The `customer_id` can be null in the orders table. We could've required it, but the spec didn't explicitly mandate customer registration. A real system would track users, but for this checkout demo it's nice to support anonymous orders too.

## Error Handling Strategy

API errors that represent genuine failures (insufficient inventory, coupon issues) get `alert()` dialogs on the client. This is jarring but very clear. In a production app you'd use toast notifications or a proper error panel, but alerts ensure the user doesn't miss critical errors.

## Why We Don't Validate Inventory in Cart

When you add an item to your cart, we don't immediately reserve it. Inventory is only checked at checkout time. This means by the time you hit checkout, another user might have bought the last monitor. This is intentional — keeping items "reserved" in carts would create a poor UX (items would disappear from your cart if others bought them). The trade-off is a clearer error at checkout time rather than during browsing.

## One Checkout Per Cart

A cart can only be checked out once. This prevents accidental double-charges and keeps the invariant that one cart = one order. If the user wants to buy again, they get a new cart.

## Why Cents Not Decimals

All prices and amounts are stored as integers (cents) not decimals. This avoids floating-point rounding errors that plagued early payment systems. 100% safer for financial data.

## System Invariants

These invariants are protected by the transaction logic and schema constraints:

1. **Inventory Never Negative** — `available_inventory` cannot go below zero. Enforced by row-level locking and validation before deduction.
2. **Cart Checked Out Once** — A cart can only successfully checkout once. Enforced by `is_checked_out` flag and pre-check in transaction.
3. **Coupon Redeemed Once** — Each coupon can only be marked `is_redeemed = true` once. Enforced by atomic update inside transaction and pre-check.
4. **Duplicate Order Prevention** — The same `checkout_request_id` can only create one order. Enforced by UNIQUE constraint on `checkout_request_id`.
5. **Order Revenue Reconciliation** — Sum of `order_items.quantity * unit_price_cents` always equals `orders.subtotal_cents` for that order. Enforced by calculating subtotal once in transaction and storing it atomically.

## How AI Tools Affected This Solution

I used Claude Code (AI assistant) for development throughout the project. My approach was to **test and validate every piece** rather than blindly accept generated code.

### Development Process

Instead of using "bypass permissions" mode (which would auto-run code without review), I used **manual validation mode** for each step:
1. Claude generates code or explains a pattern
2. I review it for correctness against requirements
3. I implement it locally
4. I test it manually with concrete scenarios
5. Only after validation do I move to the next piece

This ensured every line of code matched the business logic requirements.

### Specific Corrections & Redirects

**Rejected: SQLite for simplicity**
- Claude initially suggested SQLite as "good enough for prototypes"
- I realized concurrent inventory management requires row-level locking
- I redirected to PostgreSQL with proper transaction isolation
- Validated with concurrent checkout tests that verify inventory is protected

**Rejected: Verbose error handling**
- AI-generated error responses included excessive context ("The coupon you tried to use was invalid because...")
- I replaced with actionable messages ("Coupon not found")
- Kept only the information an API client actually needs

**Accepted & Validated: Idempotency pattern**
- Claude outlined the checkout_request_id + UNIQUE constraint pattern
- I implemented pre-check query + constraint
- Tested with retry scenario (same request_id called twice)
- Verified same order returned on retry, no duplicate created

### Database Schema Validation

The order of `CREATE TABLE` statements matters (foreign keys). AI didn't catch this — I discovered it through testing:
- Initial order: products → carts → cart_items → coupons → orders → order_items
- Error: "relation coupons does not exist"
- Fix: Reordered to products → carts → cart_items → coupons → orders → order_items → coupon_milestones
- Learned: Can't rely on AI to think about dependency graphs — must test from scratch

### What This Means

- Every business-critical function was manually tested
- Code I didn't understand was rejected or rewritten
- Tests verify the implementation actually enforces the invariants (inventory never negative, coupon never double-spent)

The AI tool was useful for **syntax and explanations**, but I was responsible for **validation and correctness**.

## What I Would Examine in the Next 2 Hours

1. **Payment Integration** — Add a real payment processor abstraction (Stripe, PayPal). Currently we treat successful checkout as payment, but a production system needs payment confirmation before marking an order complete.

2. **Customer Tracking** — Implement proper customer identification and order history lookup. Currently `customer_id` is optional; should be required with a user/authentication service.

3. **Refund/Cancellation Logic** — Orders are immutable currently. Would add refund operations that safely restore inventory and record the transaction.

4. **Coupon Expiration** — Milestone coupons never expire. Should add `expires_at` field and validate in checkout.

5. **Analytics & Observability** — Add structured logging to track inventory changes, failed checkouts, and coupon redemptions. Would integrate with a logging service to catch issues in production.

6. **Rate Limiting** — No protection against checkout spam or inventory enumeration attacks. Would add per-customer rate limiting on checkout endpoint.

7. **Database Connection Pooling Improvements** — Current pool config is minimal. Would tune pool size, idle timeout, and connection limits based on production traffic patterns.

8. **Test Coverage for Admin Endpoints** — Current tests focus on checkout; should add tests for coupon generation edge cases and report reconciliation under concurrent orders.

The first two (payment integration and customer tracking) would provide the most value — they unlock a real multi-user system rather than just a prototype.
