const { join } = require('path');

/**
 * Puppeteer configuration for Render deployment
 * Stores Chrome binary inside the project so it persists in Render's build cache
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
