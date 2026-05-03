const router = require('express').Router();
const productController = require('../controllers/productController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { productSchemas } = require('../validators');
const upload = require('../middleware/upload');

router.use(authenticate);

router.get('/', authorize('products:read'), productController.getAll);
router.get('/low-stock', authorize('products:read'), productController.getLowStock);
router.get('/barcode/:code', authorize('products:read'), productController.getByBarcode);
router.get('/:id', authorize('products:read'), productController.getById);
router.get('/:id/qrcode', authorize('products:read'), productController.getQRCode);
router.post('/', authorize('products:create'), upload.single('image'), validate(productSchemas.create), productController.create);
router.put('/:id', authorize('products:update'), upload.single('image'), validate(productSchemas.update), productController.update);
router.delete('/:id', authorize('products:delete'), productController.delete);

module.exports = router;
