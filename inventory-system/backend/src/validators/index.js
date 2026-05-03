const Joi = require('joi');

const authSchemas = {
  login: Joi.object({
    email: Joi.string().email().required().messages({ 'any.required': 'البريد الإلكتروني مطلوب' }),
    password: Joi.string().min(6).required().messages({ 'any.required': 'كلمة المرور مطلوبة' }),
  }),
  register: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().allow('', null),
    role: Joi.string().valid('ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'WAREHOUSE', 'VIEWER').default('VIEWER'),
    branchId: Joi.string().uuid().allow(null),
  }),
};

const branchSchemas = {
  create: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    address: Joi.string().allow('', null),
    phone: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
  }),
  update: Joi.object({
    name: Joi.string().min(2).max(100),
    address: Joi.string().allow('', null),
    phone: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    isActive: Joi.boolean(),
  }),
};

const productSchemas = {
  create: Joi.object({
    name: Joi.string().min(2).max(200).required(),
    description: Joi.string().allow('', null),
    sku: Joi.string().required(),
    barcode: Joi.string().allow('', null),
    price: Joi.number().min(0).required(),
    cost: Joi.number().min(0).default(0),
    categoryId: Joi.string().uuid().allow(null),
    unit: Joi.string().default('piece'),
    alertQuantity: Joi.number().integer().min(0).default(10),
    taxRate: Joi.number().min(0).max(100).default(0),
  }),
  update: Joi.object({
    name: Joi.string().min(2).max(200),
    description: Joi.string().allow('', null),
    barcode: Joi.string().allow('', null),
    price: Joi.number().min(0),
    cost: Joi.number().min(0),
    categoryId: Joi.string().uuid().allow(null),
    unit: Joi.string(),
    alertQuantity: Joi.number().integer().min(0),
    taxRate: Joi.number().min(0).max(100),
    isActive: Joi.boolean(),
  }),
};

const invoiceSchemas = {
  create: Joi.object({
    branchId: Joi.string().uuid().required(),
    customerId: Joi.string().uuid().allow(null),
    discount: Joi.number().min(0).default(0),
    paymentMethod: Joi.string().valid('CASH', 'CARD', 'TRANSFER', 'MIXED').default('CASH'),
    notes: Joi.string().allow('', null),
    items: Joi.array().items(
      Joi.object({
        productId: Joi.string().uuid().required(),
        quantity: Joi.number().integer().min(1).required(),
        price: Joi.number().min(0).required(),
        discount: Joi.number().min(0).default(0),
      })
    ).min(1).required(),
  }),
};

const transferSchemas = {
  create: Joi.object({
    fromBranchId: Joi.string().uuid().required(),
    toBranchId: Joi.string().uuid().required(),
    notes: Joi.string().allow('', null),
    items: Joi.array().items(
      Joi.object({
        productId: Joi.string().uuid().required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    ).min(1).required(),
  }),
};

const inventorySchemas = {
  adjust: Joi.object({
    branchId: Joi.string().uuid().required(),
    productId: Joi.string().uuid().required(),
    quantity: Joi.number().integer().required(),
    type: Joi.string().valid('IN', 'OUT', 'ADJUSTMENT').required(),
    notes: Joi.string().allow('', null),
  }),
  count: Joi.object({
    branchId: Joi.string().uuid().required(),
    notes: Joi.string().allow('', null),
    items: Joi.array().items(
      Joi.object({
        productId: Joi.string().uuid().required(),
        actualQuantity: Joi.number().integer().min(0).required(),
      })
    ).min(1).required(),
  }),
};

const userSchemas = {
  update: Joi.object({
    name: Joi.string().min(2).max(100),
    email: Joi.string().email(),
    phone: Joi.string().allow('', null),
    role: Joi.string().valid('ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'WAREHOUSE', 'VIEWER'),
    branchId: Joi.string().uuid().allow(null),
    isActive: Joi.boolean(),
    password: Joi.string().min(6),
  }),
};

const categorySchemas = {
  create: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().allow('', null),
  }),
  update: Joi.object({
    name: Joi.string().min(2).max(100),
    description: Joi.string().allow('', null),
  }),
};

const customerSchemas = {
  create: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    phone: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    address: Joi.string().allow('', null),
  }),
  update: Joi.object({
    name: Joi.string().min(2).max(100),
    phone: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    address: Joi.string().allow('', null),
  }),
};

module.exports = {
  authSchemas,
  branchSchemas,
  productSchemas,
  invoiceSchemas,
  transferSchemas,
  inventorySchemas,
  userSchemas,
  categorySchemas,
  customerSchemas,
};
