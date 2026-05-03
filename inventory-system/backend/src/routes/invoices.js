const router = require('express').Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { invoiceSchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('invoices:read'), invoiceController.getAll);
router.get('/:id', authorize('invoices:read'), invoiceController.getById);
router.post('/', authorize('invoices:create'), validate(invoiceSchemas.create), invoiceController.create);
router.post('/:id/refund', authorize('invoices:refund'), invoiceController.refund);
router.delete('/:id', authorize('invoices:delete'), invoiceController.delete);

module.exports = router;
