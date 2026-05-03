const router = require('express').Router();
const branchController = require('../controllers/branchController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { branchSchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('branches:read'), branchController.getAll);
router.get('/:id', authorize('branches:read'), branchController.getById);
router.post('/', authorize('branches:create'), validate(branchSchemas.create), branchController.create);
router.put('/:id', authorize('branches:update'), validate(branchSchemas.update), branchController.update);
router.delete('/:id', authorize('branches:delete'), branchController.delete);

module.exports = router;
