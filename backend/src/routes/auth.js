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
      expiresIn:    7200,
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        department:  user.department,
        avatar:      user.avatar || null,
        permissions: PERMISSIONS[user.role] || [],
        lastLogin:   user.lastLogin,
      },
    });
  }
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', authenticateRefresh, (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshTokenStore.has(refreshToken)) {
    return res.status(403).json({ error: 'Refresh token no válido o ya usado', code: 'REFRESH_REVOKED' });
  }

  const user = users.find(u => u.id === req.user.id);
  if (!user || user.active === false) {
    return res.status(403).json({ error: 'Usuario no encontrado o desactivado' });
  }

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
      .isLength({ min: 6 }).withMessage('Mínimo 6 caracteres'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, department = 'General', role = 'employee', curp } = req.body;

    if (users.find(u => u.email === email)) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const safeRole = ['employee', 'auditor'].includes(role) ? role : 'employee';

    const newUser = {
      id:         uuidv4(),
      name,
      email,
      password:   bcrypt.hashSync(password, 12),
      role:       safeRole,
      department,
      curp:       curp || null,
      avatar:     null,
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

// ── PATCH /api/auth/users/:id  —  Editar datos de usuario (admin o propio) ───
router.patch('/users/:id',
  authenticate,
  (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Solo admin puede editar a otros; cualquiera puede editar su propio perfil
    const isSelf  = user.id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Sin permiso para editar este usuario' });
    }

    const { name, email, department } = req.body;

    // Validar email único si cambia
    if (email && email !== user.email) {
      if (users.find(u => u.email === email && u.id !== user.id)) {
        return res.status(409).json({ error: 'El email ya está en uso por otro usuario' });
      }
      user.email = email;
    }

    if (name)       user.name       = name;
    if (department) user.department = department;
    user.updatedAt = new Date().toISOString();

    syncUser(user); // Persistir en MongoDB
    logActivity(req.user.id, 'USER_EDITED', { targetUser: user.id });

    const { password, ...safeUser } = user;
    res.json({ message: 'Usuario actualizado', user: safeUser });
  }
);

// ── PATCH /api/auth/users/:id/avatar  —  Subir foto de perfil (base64) ───────
router.patch('/users/:id/avatar',
  authenticate,
  (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isSelf  = user.id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Sin permiso' });
    }

    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'No se recibió imagen' });

    // Validar que sea base64 de imagen (data:image/...)
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Formato inválido. Debe ser una imagen base64' });
    }

    // Limitar tamaño: ~500KB en base64 ≈ ~375KB real
    if (avatar.length > 700000) {
      return res.status(400).json({ error: 'Imagen demasiado grande. Máximo ~500KB' });
    }

    user.avatar    = avatar;
    user.updatedAt = new Date().toISOString();

    syncUser(user); // Persistir en MongoDB
    logActivity(req.user.id, 'AVATAR_UPDATED', { targetUser: user.id });

    res.json({ message: 'Foto de perfil actualizada', avatar: user.avatar });
  }
);

// ── DELETE /api/auth/users/:id  —  Eliminar usuario (solo admin) ──────────────
router.delete('/users/:id',
  authenticate,
  authorize('admin'),
  (req, res) => {
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = users[idx];

    // No puede eliminarse a sí mismo
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    users.splice(idx, 1);

    // Eliminar de MongoDB si está disponible
    const { deleteVoteFromDB } = require('../models/db');
    // Nota: reutilizamos syncUser con un flag especial o simplemente omitimos
    // Para usuarios eliminados, marcamos como inactivo en la DB es más seguro,
    // pero aquí eliminamos del array en memoria. Si MongoDB está activo:
    try {
      const db = require('../models/db');
      if (db.usingMongo && db.db) {
        db.db.collection('users').deleteOne({ id: user.id }).catch(() => {});
      }
    } catch {}

    logActivity(req.user.id, 'USER_DELETED', { deletedUser: user.id, email: user.email });

    res.json({ message: `Usuario ${user.name} eliminado correctamente` });
  }
);

// ── PATCH /api/auth/users/:id/role ────────────────────────────────────────────
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

// ── PATCH /api/auth/users/:id/status ─────────────────────────────────────────
router.patch('/users/:id/status',
  authenticate,
  authorize('admin'),
  (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });

    user.active = req.body.active !== false;
    syncUser(user); // Persistir en MongoDB
    logActivity(req.user.id, user.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', { targetUser: user.id });

    res.json({ message: `Usuario ${user.active ? 'activado' : 'desactivado'}`, userId: user.id, active: user.active });
  }
);

// ── GET /api/auth/users ───────────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin', 'manager'), (req, res) => {
  const safeUsers = users.map(({ password, ...u }) => ({
    ...u,
    permissions: PERMISSIONS[u.role] || [],
  }));
  res.json({ total: safeUsers.length, users: safeUsers });
});

// ── GET /api/auth/activity ────────────────────────────────────────────────────
router.get('/activity', authenticate, authorize('admin'), (req, res) => {
  const limit  = parseInt(req.query.limit) || 50;
  const recent = [...activityLog].reverse().slice(0, limit);
  res.json({ total: activityLog.length, log: recent });
});

// ── PATCH /api/auth/me/password ───────────────────────────────────────────────
router.patch('/me/password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    body('newPassword')
      .isLength({ min: 6 }).withMessage('Mínimo 6 caracteres'),
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
