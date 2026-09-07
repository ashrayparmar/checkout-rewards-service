import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = 'http://localhost:3000';

export default function App() {
  const [products, setProducts] = useState([]);
  const [cartId, setCartId] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [alert, setAlert] = useState({ message: '', type: '' });
  const [customerId, setCustomerId] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [order, setOrder] = useState(null);
  const [report, setReport] = useState(null);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    await loadProducts();
    await createCart();
  };

  const loadProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/products`);
      const data = await res.json();
      setProducts(data);
    } catch (e) {
      showAlert('Failed to load products', 'error');
    }
  };

  const createCart = async () => {
    try {
      const res = await fetch(`${API_URL}/carts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId || null })
      });
      const cart = await res.json();
      setCartId(cart.id);
      setCartItems([]);
      setOrder(null);
    } catch (e) {
      showAlert('Failed to create cart', 'error');
    }
  };

  const addToCart = async (productId, productName, priceCents) => {
    if (!cartId) {
      showAlert('No cart created', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/carts/${cartId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity: 1 })
      });

      if (!res.ok) {
        const err = await res.json();
        showAlert(err.error, 'error');
        return;
      }

      const item = await res.json();
      const existing = cartItems.find(i => i.product_id === productId);

      if (existing) {
        setCartItems(cartItems.map(i =>
          i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i
        ));
      } else {
        setCartItems([...cartItems, { ...item, product_id: productId }]);
      }

      showAlert(`${productName} added to cart`, 'success');
    } catch (e) {
      showAlert('Failed to add item', 'error');
    }
  };

  const removeFromCart = async (productId) => {
    if (!cartId) return;

    try {
      await fetch(`${API_URL}/carts/${cartId}/items/${productId}`, {
        method: 'DELETE'
      });
      setCartItems(cartItems.filter(i => i.product_id !== productId));
      showAlert('Item removed', 'success');
    } catch (e) {
      showAlert('Failed to remove item', 'error');
    }
  };

  const checkout = async () => {
    if (cartItems.length === 0) {
      showAlert('Cart is empty', 'error');
      return;
    }

    const checkoutId = `req_${Date.now()}`;

    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkout_request_id: checkoutId,
          cart_id: cartId,
          coupon_id: couponCode || null
        })
      });

      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || 'Checkout failed', 'error');
        return;
      }

      setOrder(data.order);
      showAlert('✅ Checkout successful!', 'success');

      // Reset for next order
      setTimeout(() => {
        createCart();
        loadProducts();
      }, 1500);
    } catch (e) {
      showAlert('Checkout failed: ' + e.message, 'error');
    }
  };

  const loadReport = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/reports/summary`);
      const data = await res.json();
      setReport(data);
      showAlert('Report loaded', 'success');
    } catch (e) {
      showAlert('Failed to load report', 'error');
    }
  };

  const generateCoupon = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/coupons/generate`, {
        method: 'POST'
      });
      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || 'Failed to generate coupon', 'error');
        return;
      }

      showAlert(`✅ Coupon generated: ${data.code}`, 'success');
      loadReport();
    } catch (e) {
      showAlert('Failed to generate coupon', 'error');
    }
  };

  const showAlert = (message, type) => {
    setAlert({ message, type });
    setTimeout(() => setAlert({ message: '', type: '' }), 4000);
  };

  const subtotalCents = cartItems.reduce((sum, i) => sum + (i.price_cents * i.quantity), 0);
  const discountCents = order?.discount_cents || 0;
  const totalCents = subtotalCents - discountCents;

  return (
    <div className="app">
      <header className="header">
        <h1>🛒 Checkout & Rewards Store</h1>
      </header>

      <div className="container">
        {/* Alert */}
        {alert.message && (
          <div className={`alert alert-${alert.type}`}>
            {alert.message}
          </div>
        )}

        {/* Main Grid */}
        <div className="grid">
          {/* Products */}
          <div className="card">
            <h2>Products</h2>
            <div className="products">
              {products.map(p => (
                <div key={p.id} className="product">
                  <div className="product-name">{p.name}</div>
                  <div className="product-price">${(p.price_cents / 100).toFixed(2)}</div>
                  <div className="product-inventory">Stock: {p.available_inventory}</div>
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => addToCart(p.id, p.name, p.price_cents)}
                  >
                    Add to Cart
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Cart */}
          <div className="card">
            <h2>Shopping Cart</h2>
            <div className="cart-items">
              {cartItems.length === 0 ? (
                <div className="cart-empty">Cart is empty</div>
              ) : (
                cartItems.map(item => (
                  <div key={item.product_id} className="cart-item">
                    <div className="cart-item-details">
                      <div className="cart-item-name">{item.name}</div>
                      <div className="cart-item-price">
                        {item.quantity}x ${(item.price_cents / 100).toFixed(2)}
                      </div>
                    </div>
                    <div className="cart-item-actions">
                      <div>${(item.price_cents * item.quantity / 100).toFixed(2)}</div>
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => removeFromCart(item.product_id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="summary">
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>${(subtotalCents / 100).toFixed(2)}</span>
              </div>
              {discountCents > 0 && (
                <div className="summary-row">
                  <span>Discount:</span>
                  <span style={{ color: '#27ae60' }}>-${(discountCents / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="summary-row summary-total">
                <span>Total:</span>
                <span>${(totalCents / 100).toFixed(2)}</span>
              </div>
            </div>

            <div className="checkout-section">
              <div className="form-group">
                <label>Customer ID (optional):</label>
                <input
                  type="text"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="cust_123"
                />
              </div>

              <div className="form-group">
                <label>Coupon Code (optional):</label>
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="MILESTONE_5"
                />
              </div>

              <button className="btn btn-success btn-full" onClick={checkout}>
                Checkout
              </button>
            </div>
          </div>
        </div>

        {/* Order Result */}
        {order && (
          <div className="order-details">
            <h3>✅ Order Placed!</h3>
            <div className="order-item">
              <strong>Order ID:</strong> {order.id}
            </div>
            <div className="order-item">
              <strong>Subtotal:</strong> ${(order.subtotal_cents / 100).toFixed(2)}
            </div>
            {order.discount_cents > 0 && (
              <div className="order-item">
                <strong>Discount:</strong> -${(order.discount_cents / 100).toFixed(2)}
              </div>
            )}
            <div className="order-item">
              <strong>Total:</strong> ${(order.total_cents / 100).toFixed(2)}
            </div>
          </div>
        )}

        {/* Admin Section */}
        <div className="admin-section">
          <div className="card">
            <h2>📊 Admin Dashboard</h2>
            <div style={{ marginBottom: '15px' }}>
              <button className="btn btn-primary" onClick={loadReport}>
                Load Report
              </button>
              <button
                className="btn btn-primary"
                style={{ marginLeft: '10px' }}
                onClick={generateCoupon}
              >
                Generate Coupon
              </button>
            </div>

            {report && (
              <div>
                <div className="stats">
                  <div className="stat-card">
                    <div className="stat-label">Total Orders</div>
                    <div className="stat-value">{report.orders.total_placed}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Gross Revenue</div>
                    <div className="stat-value">${report.revenue.gross_dollars}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Net Revenue</div>
                    <div className="stat-value">${report.revenue.net_dollars}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Coupons Generated</div>
                    <div className="stat-value">{report.coupons.total_generated}</div>
                  </div>
                </div>

                <div className="report-details">
                  <p>
                    <strong>Reconciliation:</strong>{' '}
                    {report.reconciliation.reconciles ? '✅ Reconciles' : '❌ Mismatch'}
                  </p>
                  <p>
                    <strong>Available Coupons:</strong> {report.coupons.available}
                  </p>
                  <p>
                    <strong>Redeemed Coupons:</strong> {report.coupons.redeemed}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
