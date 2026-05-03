const router = require('express').Router();
const customerController = require('../controllers/customerController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { customerSchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('customers:read'), customerController.getAll);
router.get('/:id', authorize('customers:read'), customerController.getById);
router.post('/', authorize('customers:create'), validate(customerSchemas.create), customerController.create);
router.put('/:id', authorize('customers:update'), validate(customerSchemas.update), customerController.update);
router.delete('/:id', authorize('customers:delete'), customerController.delete);

module.exports = router;
