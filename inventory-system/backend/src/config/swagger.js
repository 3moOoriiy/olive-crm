const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'نظام إدارة المخزون والمبيعات - API',
      version: '1.0.0',
      description: 'API Documentation for Inventory & Sales Management System\n\nتوثيق واجهة برمجة التطبيقات لنظام إدارة المخزون والمبيعات',
      contact: {
        name: 'AmrAlaa',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'أدخل رمز JWT للمصادقة',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'رسالة الخطأ' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@inventory.com' },
            password: { type: 'string', example: 'admin123' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'JWT Access Token' },
            refreshToken: { type: 'string', description: 'Refresh Token' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { type: 'string', enum: ['ADMIN', 'MANAGER', 'CASHIER', 'WAREHOUSE', 'VIEWER'] },
                branchId: { type: 'string', format: 'uuid', nullable: true },
              },
            },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            sku: { type: 'string' },
            barcode: { type: 'string', nullable: true },
            qrCode: { type: 'string', nullable: true },
            price: { type: 'number' },
            cost: { type: 'number', nullable: true },
            image: { type: 'string', nullable: true },
            categoryId: { type: 'string', format: 'uuid', nullable: true },
            unit: { type: 'string', default: 'piece' },
            alertQuantity: { type: 'integer', default: 10 },
            taxRate: { type: 'number', default: 0 },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Branch: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            address: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
          },
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            invoiceNumber: { type: 'string' },
            type: { type: 'string', enum: ['SALE', 'REFUND'] },
            status: { type: 'string', enum: ['COMPLETED', 'CANCELLED', 'REFUNDED'] },
            subtotal: { type: 'number' },
            taxAmount: { type: 'number' },
            discount: { type: 'number' },
            total: { type: 'number' },
            paymentMethod: { type: 'string', enum: ['CASH', 'CARD', 'TRANSFER', 'MIXED'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
          },
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            phone: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'المصادقة وتسجيل الدخول' },
      { name: 'Branches', description: 'إدارة الفروع' },
      { name: 'Categories', description: 'إدارة التصنيفات' },
      { name: 'Products', description: 'إدارة المنتجات' },
      { name: 'Invoices', description: 'الفواتير والمبيعات' },
      { name: 'Inventory', description: 'إدارة المخزون' },
      { name: 'Transfers', description: 'تحويلات المخزون' },
      { name: 'Reports', description: 'التقارير' },
      { name: 'Users', description: 'إدارة المستخدمين' },
      { name: 'Customers', description: 'إدارة العملاء' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
