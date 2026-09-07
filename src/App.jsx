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
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [order, setOrder] = useState(null);
  const [report, setReport] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    await loadProducts();
    await loadAvailableCoupons();
    await createCart();
  };

  const loadAvailableCoupons = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/coupons/available`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAvailableCoupons(data);
      } else {
        console.error('Invalid coupon data:', data);
        setAvailableCoupons([]);
      }
    } catch (e) {
      console.error('Failed to load coupons:', e);
      setAvailableCoupons([]);
    }
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
        alert(`❌ ${err.error}`);
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

    setIsCheckingOut(true);
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
        setIsCheckingOut(false);
        alert(`❌ ${data.error || 'Checkout failed'}`);
        return;
      }

      setOrder(data.order);
    } catch (e) {
      setIsCheckingOut(false);
      alert(`❌ Checkout failed: ${e.message}`);
    }
  };

  const closeOrderModal = async () => {
    setOrder(null);
    setIsCheckingOut(false);
    setCouponCode('');
    setCartItems([]);
    await createCart();
    await loadAvailableCoupons();
    await loadProducts();
  };

  const loadReport = async () => {
    try {
      const res = await fetch(`${API_URL}/admin/reports/summary`);
      const data = await res.json();
      if (!res.ok) {
        alert(`❌ Failed to load report: ${data.error}`);
        return;
      }
      setReport(data);
      showAlert('Report loaded', 'success');
    } catch (e) {
      alert(`❌ Failed to load report: ${e.message}`);
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
                <select
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #bdc3c7',
                    borderRadius: '4px',
                    fontSize: '14px',
                    backgroundColor: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">-- Select a coupon --</option>
                  {availableCoupons.length === 0 ? (
                    <option disabled>No coupons available</option>
                  ) : (
                    availableCoupons.map(coupon => (
                      <option key={coupon.id} value={coupon.code}>
                        {coupon.code} (10% off)
                      </option>
                    ))
                  )}
                </select>
              </div>

              {couponCode && (
                (() => {
                  const selectedCoupon = availableCoupons.find(c => c.code === couponCode);
                  if (selectedCoupon && selectedCoupon.discount_percent !== undefined && selectedCoupon.discount_percent !== null) {
                    const discountPercent = parseInt(selectedCoupon.discount_percent, 10);
                    const discountAmount = Math.floor((subtotalCents * discountPercent) / 100);
                    const newTotal = Math.max(0, subtotalCents - discountAmount);

                    return (
                      <div style={{
                        backgroundColor: '#e8f5e9',
                        padding: '12px',
                        borderRadius: '4px',
                        marginBottom: '12px',
                        border: '1px solid #81c784'
                      }}>
                        <div style={{ fontSize: '13px', color: '#2e7d32', marginBottom: '6px' }}>
                          <strong>✅ Coupon Applied ({discountPercent}% off)</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: '#558b2f', marginBottom: '4px' }}>
                          Subtotal: ${(subtotalCents / 100).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#558b2f', marginBottom: '8px' }}>
                          Discount: <strong style={{ color: '#2e7d32' }}>-${(discountAmount / 100).toFixed(2)}</strong>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1b5e20' }}>
                          Total: ${(newTotal / 100).toFixed(2)}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()
              )}

              <button
                className="btn btn-success btn-full"
                onClick={checkout}
                disabled={isCheckingOut}
                style={{ opacity: isCheckingOut ? 0.6 : 1, cursor: isCheckingOut ? 'not-allowed' : 'pointer' }}
              >
                {isCheckingOut ? '⏳ Processing...' : 'Checkout'}
              </button>
            </div>
          </div>
        </div>

        {/* Order Confirmation Modal */}
        {order && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '40px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
              animation: 'slideIn 0.3s ease-out'
            }}>
              <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <div style={{ fontSize: '60px', marginBottom: '15px' }}>✅</div>
                <h2 style={{ color: '#27ae60', margin: '0 0 10px 0', fontSize: '28px' }}>Order Confirmed!</h2>
                <p style={{ color: '#7f8c8d', margin: 0 }}>Thank you for your purchase</p>
              </div>

              <div style={{
                backgroundColor: '#f9f9f9',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '25px'
              }}>
                <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
                  <div style={{ fontSize: '12px', color: '#7f8c8d', marginBottom: '5px' }}>Order ID</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#2c3e50', wordBreak: 'break-all' }}>
                    {order.id}
                  </div>
                </div>

                <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: '#7f8c8d' }}>Subtotal:</span>
                    <span style={{ fontWeight: '600', color: '#2c3e50' }}>${(order.subtotal_cents / 100).toFixed(2)}</span>
                  </div>
                  {order.discount_cents > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#27ae60' }}>Discount:</span>
                      <span style={{ fontWeight: '600', color: '#27ae60' }}>-${(order.discount_cents / 100).toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#2c3e50' }}>Total:</span>
                  <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#27ae60' }}>
                    ${(order.total_cents / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                onClick={closeOrderModal}
                style={{
                  width: '100%',
                  padding: '14px',
                  backgroundColor: '#27ae60',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#229954'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#27ae60'}
              >
                Continue Shopping
              </button>
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
