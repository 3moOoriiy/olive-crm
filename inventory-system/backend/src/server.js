// Fix BigInt JSON serialization for SQLite
BigInt.prototype.toJSON = function () { return Number(this); };

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const prisma = require('./config/database');
const fs = require('fs');
const path = require('path');

// Ensure required directories exist
['uploads', 'logs'].forEach((dir) => {
  const dirPath = process.env.ELECTRON_USER_DATA
    ? path.join(process.env.ELECTRON_USER_DATA, dir)
    : path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

const start = async () => {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
      console.log(`\n  🚀 Server: http://localhost:${config.port}`);
      console.log(`  📊 Health: http://localhost:${config.port}/api/health\n`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
});

start();
