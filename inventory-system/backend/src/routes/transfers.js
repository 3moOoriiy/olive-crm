const router = require('express').Router();
const transferController = require('../controllers/transferController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { transferSchemas } = require('../validators');

router.use(authenticate);

router.get('/', authorize('transfers:read'), transferController.getAll);
router.get('/:id', authorize('transfers:read'), transferController.getById);
router.post('/', authorize('transfers:create'), validate(transferSchemas.create), transferController.create);
router.put('/:id/approve', authorize('transfers:approve'), transferController.approve);

module.exports = router;
