const router = require('express').Router();
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { userSchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('users:read'), userController.getAll);
router.get('/activity-logs', authorize('activity:read'), userController.getActivityLogs);
router.get('/:id', authorize('users:read'), userController.getById);
router.put('/:id', authorize('users:update'), validate(userSchemas.update), userController.update);
router.delete('/:id', authorize('users:delete'), userController.delete);

module.exports = router;
