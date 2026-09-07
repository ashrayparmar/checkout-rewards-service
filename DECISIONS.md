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
