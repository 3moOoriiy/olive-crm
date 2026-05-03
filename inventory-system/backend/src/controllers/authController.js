const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const config = require('../config');
const { logActivity } = require('../utils/helpers');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ userId, tokenId: uuidv4() }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
  return { accessToken, refreshToken };
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email }, include: { branch: true } });
    if (!user) return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    if (!user.isActive) return res.status(403).json({ message: 'الحساب معطل' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });

    const { accessToken, refreshToken } = generateTokens(user.id);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });

    await logActivity(user.id, 'LOGIN', 'User', user.id, null, req.ip);

    const { password: _, ...userData } = user;
    res.json({ user: userData, accessToken, refreshToken });
  } catch (error) {
    next(error);
  }
};

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, role, branchId } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, phone, role, branchId },
      include: { branch: true },
    });

    await logActivity(req.user?.id || user.id, 'CREATE', 'User', user.id, { name, email, role }, req.ip);

    const { password: _, ...userData } = user;
    res.status(201).json({ user: userData });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Refresh token مطلوب' });

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
      return res.status(401).json({ message: 'Refresh token غير صالح أو منتهي' });
    }

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const tokens = generateTokens(decoded.userId);

    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.refreshToken.create({ data: { token: tokens.refreshToken, userId: decoded.userId, expiresAt } });

    res.json(tokens);
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    await logActivity(req.user.id, 'LOGOUT', 'User', req.user.id, null, req.ip);
    res.json({ message: 'تم تسجيل الخروج بنجاح' });
  } catch (error) {
    next(error);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { branch: true },
      omit: { password: true },
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور الجديدة مطلوبين' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await logActivity(req.user.id, 'RESET_PASSWORD', 'User', user.id, { email }, req.ip);
    res.json({ message: 'تم إعادة تعيين كلمة المرور بنجاح' });
  } catch (error) { next(error); }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور الجديدة مطلوبين' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: 'البريد الإلكتروني غير مسجل في النظام' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    res.json({ message: 'تم إعادة تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' });
  } catch (error) { next(error); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashedPassword } });

    await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    await logActivity(req.user.id, 'CHANGE_PASSWORD', 'User', req.user.id, null, req.ip);

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    next(error);
  }
};
