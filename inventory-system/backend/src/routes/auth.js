const router = require('express').Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authSchemas } = require('../validators');

router.post('/login', validate(authSchemas.login), authController.login);
router.post('/register', authenticate, validate(authSchemas.register), authController.register);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.get('/profile', authenticate, authController.getProfile);
router.put('/change-password', authenticate, authController.changePassword);
router.post('/reset-password', authenticate, authController.resetPassword);
router.post('/forgot-password', authController.forgotPassword);

module.exports = router;
