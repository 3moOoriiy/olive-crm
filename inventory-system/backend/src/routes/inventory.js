const router = require('express').Router();
const inventoryController = require('../controllers/inventoryController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { inventorySchemas } = require('../validators');

router.use(authenticate);

router.get('/movements', authorize('inventory:read'), inventoryController.getMovements);
router.get('/stock/:branchId', authorize('inventory:read'), inventoryController.getBranchStock);
router.post('/adjust', authorize('inventory:adjust'), validate(inventorySchemas.adjust), inventoryController.adjustStock);
router.get('/counts', authorize('inventory:count'), inventoryController.getCounts);
router.post('/counts', authorize('inventory:count'), validate(inventorySchemas.count), inventoryController.createCount);
router.put('/counts/:id/complete', authorize('inventory:count'), inventoryController.completeCount);

module.exports = router;
