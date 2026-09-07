# Checkout & Rewards Service

A transaction-safe ecommerce checkout system with atomic coupon redemption, inventory management, and automatic milestone-based rewards.

## Features

- **Atomic Checkout**: Transaction-based checkout with row-level locking to prevent inventory overselling
- **Idempotent Requests**: Safe retry logic using unique `checkout_request_id` — same request processed once
- **Coupon System**: Atomic redemption prevents double-spending, auto-generates milestone coupons every 5th order
- **Inventory Safety**: Concurrent checkout requests handled safely with database-level locking
- **Admin Dashboard**: View revenue reports, available coupons, and trigger milestone generation

## Prerequisites

- Node.js (v14 or higher)
- npm
- PostgreSQL database (or Supabase cloud instance)

## Setup

### 1. Clone & Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env` file in the project root:

```
PORT=3000
DATABASE_URL=postgresql://username:password@host:port/database
NODE_ENV=development
```

For Supabase, get your connection string from:
- Log in to Supabase → Project Settings → Database → Connection string (URI)
- Copy the connection string and update the password

### 3. Start the Backend

```bash
npm start
```

The backend will:
- Initialize the database schema (creates tables if they don't exist)
- Seed 5 products (Laptop, Mouse, Keyboard, Monitor, HDMI Cable)
- Start the Express server on `http://localhost:3000`

You should see:
```
Products seeded
Server running on http://localhost:3000
```

### 4. Start the Frontend (in a new terminal)

```bash
npm run dev
```

This starts the Vite development server on `http://localhost:5173`

Open your browser to `http://localhost:5173`

## Testing the System

### Scenario 1: Basic Checkout
1. Browse products on the home page
2. Add items to cart (e.g., 2x Monitor)
3. Click "Checkout"
4. Fill in Customer ID (optional)
5. Leave coupon blank
6. Click "Complete Checkout"
7. See order confirmation modal with details

**Expected**: Order created, inventory decremented, modal shows order ID and items

### Scenario 2: Checkout with Coupon
1. Click "Load Available Coupons" (to see unredeemed coupons)
2. Add items to cart
3. In checkout form, select a coupon from the dropdown
4. See discount preview below (shows original total and discounted total)
5. Click "Complete Checkout"

**Expected**: Order created with discount applied, coupon marked as redeemed

### Scenario 3: Insufficient Inventory
1. Add 5x Monitor (only 3 available) to cart
2. Try to checkout

**Expected**: Alert popup saying "Insufficient inventory"

### Scenario 4: Double-Spend Prevention
1. Checkout successfully with a coupon (e.g., MILESTONE_5)
2. Create a new cart
3. Try to checkout with the same coupon code

**Expected**: Alert saying "Coupon already redeemed"

### Scenario 5: Milestone Generation
1. In the admin section (bottom of page), click "Load Report"
2. Note the total orders
3. Place orders until you reach a multiple of 5
4. After the 5th order, click "Load Report" again
5. Click "Generate Coupon for Next Milestone"

**Expected**: New MILESTONE_X coupon generated automatically after 5th, 10th, 15th orders

### Scenario 6: Cart Already Checked Out
1. Checkout with a cart successfully
2. Try to checkout again with the same cart ID

**Expected**: Alert saying "Cart already checked out"

### Scenario 7: Idempotency (Retry Safety)
1. Open browser DevTools → Network tab
2. Add items to cart and start checkout
3. Before the response completes, refresh the page
4. The order may or may not have gone through, but:
   - If you retry the checkout with the same `checkout_request_id`, you'll get the same order back
   - No duplicate order created

**Expected**: Same order returned, quantity 1, not duplicated

## API Endpoints

### Products
```
GET /products
```
Returns list of all products with price and inventory

### Cart Management
```
POST /carts
GET /carts/:id
POST /carts/:id/items
DELETE /carts/:id/items/:productId
```

### Checkout
```
POST /checkout
Body: {
  "checkout_request_id": "unique-id",
  "cart_id": "cart-123",
  "coupon_id": "COUPON_CODE" (optional)
}
```

### Admin
```
GET /admin/coupons/available
POST /admin/coupons/generate
GET /admin/reports/summary
```

## Project Structure

```
src/
├── db.js                    # PostgreSQL pool setup & schema
├── server.js                # Express app & middleware
├── helpers.js               # Utility functions (generateId)
├── routes/
│   ├── index.js            # Route registration
│   ├── products.js         # Product endpoints
│   ├── carts.js            # Cart endpoints
│   ├── checkout.js         # Checkout with transactions
│   └── admin.js            # Admin reports & coupon generation
├── App.jsx                 # React main component
├── App.css                 # Styling
└── main.jsx                # React entry point

index.html                   # HTML entry point
package.json                 # Dependencies
.env                        # Environment variables (not committed)
DECISIONS.md                # Design rationale & trade-offs
```

## Key Design Decisions

See [DECISIONS.md](DECISIONS.md) for:
- Why PostgreSQL with row-level locking
- How idempotency works via `checkout_request_id`
- Coupon redemption atomicity
- Milestone generation strategy
- And more...

## Common Issues

**"relation coupons does not exist"**
- The database schema hasn't been created. Make sure `npm start` runs without errors and you see "Products seeded"

**"failed to connect to localhost:5432"**
- Check your DATABASE_URL is correct in .env
- Ensure your PostgreSQL/Supabase instance is accessible

**Checkout fails with "Coupon not found"**
- Click "Load Available Coupons" first to see valid coupon codes
- Use the exact coupon code from the dropdown

**Alert not showing for errors**
- Make sure browser didn't cache old code. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

## Testing Notes

- All scenarios have been manually tested and validated
- The system handles concurrent checkouts safely
- Coupon double-spend is prevented at database level
- Inventory cannot be oversold due to row-level locking
