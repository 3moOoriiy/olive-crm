const router = require('express').Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get('/dashboard', reportController.getDashboard);
router.get('/sales', authorize('reports:read'), reportController.getSalesReport);
router.get('/profit', authorize('reports:read'), reportController.getProfitReport);
router.get('/top-products', authorize('reports:read'), reportController.getTopProducts);
router.get('/low-stock', authorize('reports:read'), reportController.getLowStock);
router.get('/branches', authorize('reports:read'), reportController.getBranchReport);

module.exports = router;
