const logger = require('../utils/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });

  if (err.name === 'ValidationError' || err.isJoi) {
    return res.status(400).json({
      message: 'خطأ في البيانات المدخلة',
      errors: err.details ? err.details.map((d) => d.message) : [err.message],
    });
  }

  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'field';
    return res.status(409).json({ message: `القيمة موجودة مسبقاً: ${field}` });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ message: 'العنصر غير موجود' });
  }

  res.status(err.statusCode || 500).json({
    message: err.message || 'خطأ في الخادم',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({ message: `المسار غير موجود: ${req.originalUrl}` });
};

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, notFound, AppError };
