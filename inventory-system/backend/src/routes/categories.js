const router = require('express').Router();
const categoryController = require('../controllers/categoryController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { categorySchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('categories:read'), categoryController.getAll);
router.get('/:id', authorize('categories:read'), categoryController.getById);
router.post('/', authorize('categories:create'), validate(categorySchemas.create), categoryController.create);
router.put('/:id', authorize('categories:update'), validate(categorySchemas.update), categoryController.update);
router.delete('/:id', authorize('categories:delete'), categoryController.delete);

module.exports = router;
