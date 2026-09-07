const productsRouter = require('./products');
const cartsRouter = require('./carts');
const checkoutRouter = require('./checkout');

function attachRoutes(app) {
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/products', productsRouter);
  app.use('/carts', cartsRouter);
  app.use('/checkout', checkoutRouter);
}

module.exports = { attachRoutes };
