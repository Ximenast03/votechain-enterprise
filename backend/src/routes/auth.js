const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { users, syncUser } = require('../models/db');
const { authenticate, authenticateRefresh, authorize, can, generateTokens, PERMISSIONS } = require('../middleware/auth');

// Almacén en memoria de refresh tokens (en producción: Redis o DB)
const refreshTokenStore = new Set();

// Log de actividad
const activityLog = [];
function logActivity(userId, action, meta = {}) {
  activityLog.push({
    id:        uuidv4(),
    userId,
    action,
    meta,
    timestamp: new Date().toISOString(),
    ip:        meta.ip || 'unknown',
  });
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = users.find(u => u.email === email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      logActivity(null, 'LOGIN_FAILED', { email, ip: req.ip });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    refreshTokenStore.add(refreshToken);

    // Actualizar último login
    user.lastLogin = new Date().toISOString();
    syncUser(user); // Persistir en MongoDB
    logActivity(user.id, 'LOGIN_SUCCESS', { ip: req.ip });

    res.json({
      message:      'Inicio de sesión exitoso',
      accessToken,
      refreshToken,
      expiresIn:    7200, // 2h en segundos
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        department:  user.department,
        permissions: PERMISSIONS[user.role] || [],
        lastLogin:   user.lastLogin,
      },
    });
  }
);

// ── POST /api/auth/refresh  —  Renovar access token ──────────────────────────
router.post('/refresh', authenticateRefresh, (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshTokenStore.has(refreshToken)) {
    return res.status(403).json({ error: 'Refresh token no válido o ya usado', code: 'REFRESH_REVOKED' });
  }

  const user = users.find(u => u.id === req.user.id);
  if (!user || user.active === false) {
    return res.status(403).json({ error: 'Usuario no encontrado o desactivado' });
  }

  // Rotar refresh token (invalidar el anterior, emitir uno nuevo)
  refreshTokenStore.delete(refreshToken);
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
  refreshTokenStore.add(newRefreshToken);

  logActivity(user.id, 'TOKEN_REFRESHED', { ip: req.ip });

  res.json({
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 7200,
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) refreshTokenStore.delete(refreshToken);

  logActivity(req.user.id, 'LOGOUT', { ip: req.ip });
  res.json({ message: 'Sesión cerrada exitosamente' });
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register',
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('email').isEmail().withMessage('Email inválido'),
    body('password')
      .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
      .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula')
      .matches(/[0-9]/).withMessage('Debe contener al menos un número'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, department = 'General', role = 'employee' } = req.body;

    if (users.find(u => u.email === email)) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    // Solo admins pueden crear otros admins o managers
    const safeRole = ['employee', 'auditor'].includes(role) ? role : 'employee';

    const newUser = {
      id:         uuidv4(),
      name,
      email,
      password:   bcrypt.hashSync(password, 12),
      role:       safeRole,
      department,
      active:     true,
      createdAt:  new Date().toISOString(),
      lastLogin:  null,
    };

    users.push(newUser);
    syncUser(newUser); // Persistir en MongoDB
    logActivity(newUser.id, 'USER_REGISTERED', { email, department });

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, department: newUser.department },
    });
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { password, ...safeUser } = user;
  res.json({
    ...safeUser,
    permissions: PERMISSIONS[user.role] || [],
  });
});

// ── GET /api/auth/permissions ─────────────────────────────────────────────────
router.get('/permissions', authenticate, (req, res) => {
  res.json({
    role:        req.user.role,
    permissions: PERMISSIONS[req.user.role] || [],
    allRoles:    Object.keys(PERMISSIONS),
  });
});

// ── PATCH /api/auth/users/:id/role  —  Cambiar rol (solo admin) ───────────────
router.patch('/users/:id/role',
  authenticate,
  authorize('admin'),
  (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const validRoles = Object.keys(PERMISSIONS);
    if (!validRoles.includes(req.body.role)) {
      return res.status(400).json({ error: `Rol inválido. Usa: ${validRoles.join(', ')}` });
    }

    // No puede cambiar su propio rol
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }

    const oldRole = user.role;
    user.role = req.body.role;
    syncUser(user); // Persistir en MongoDB
    logActivity(req.user.id, 'ROLE_CHANGED', { targetUser: user.id, oldRole, newRole: req.body.role });

    res.json({
      message: `Rol actualizado: ${oldRole} → ${req.body.role}`,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }
);

// ── PATCH /api/auth/users/:id/status  —  Activar/Desactivar (solo admin) ──────
router.patch('/users/:id/status',
  authenticate,
  authorize('admin'),
  (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });

    user.active = req.body.active !== false;
    logActivity(req.user.id, user.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', { targetUser: user.id });

    res.json({ message: `Usuario ${user.active ? 'activado' : 'desactivado'}`, userId: user.id, active: user.active });
  }
);

// ── GET /api/auth/users  —  Listar usuarios (admin / manager) ─────────────────
router.get('/users', authenticate, authorize('admin', 'manager'), (req, res) => {
  const safeUsers = users.map(({ password, ...u }) => ({
    ...u,
    permissions: PERMISSIONS[u.role] || [],
  }));
  res.json({ total: safeUsers.length, users: safeUsers });
});

// ── GET /api/auth/activity  —  Log de actividad (solo admin) ──────────────────
router.get('/activity', authenticate, authorize('admin'), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const recent = [...activityLog].reverse().slice(0, limit);
  res.json({ total: activityLog.length, log: recent });
});

// ── PATCH /api/auth/me/password  —  Cambiar contraseña propia ─────────────────
router.patch('/me/password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
      .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula')
      .matches(/[0-9]/).withMessage('Debe contener al menos un número'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const user = users.find(u => u.id === req.user.id);
    if (!bcrypt.compareSync(req.body.currentPassword, user.password)) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    user.password = bcrypt.hashSync(req.body.newPassword, 12);
    syncUser(user); // Persistir en MongoDB
    logActivity(user.id, 'PASSWORD_CHANGED', { ip: req.ip });

    res.json({ message: 'Contraseña actualizada exitosamente' });
  }
);

module.exports = router;

