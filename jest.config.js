module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/App.jsx', '!src/main.jsx'],
  testTimeout: 30000,
  verbose: true,
  maxWorkers: 1, // Run tests sequentially to avoid port conflicts
};
