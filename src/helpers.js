const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { generateId };
