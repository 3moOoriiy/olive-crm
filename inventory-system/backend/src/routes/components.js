const router = require('express').Router();
const componentController = require('../controllers/componentController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get('/overview', authorize('products:read'), componentController.getProductsWithComponents);
router.get('/:productId', authorize('products:read'), componentController.getComponents);
router.put('/:productId', authorize('products:update'), componentController.setComponents);

module.exports = router;
