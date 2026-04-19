const jwt = require('jsonwebtoken');

const JWT_SECRET         = process.env.JWT_SECRET         || 'votechain_super_secret_2025';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'votechain_refresh_secret_2025';

// ─────────────────────────────────────────────────────────────────────────────
// Permisos granulares por rol
// ─────────────────────────────────────────────────────────────────────────────
const PERMISSIONS = {
  admin: [
    'vote:read', 'vote:create', 'vote:close', 'vote:delete',
    'vote:cast',
    'results:read',
    'audit:read',
    'users:read', 'users:create', 'users:edit', 'users:deactivate',
    'roles:assign',
    'export:csv',
  ],
  manager: [
    'vote:read', 'vote:create', 'vote:close',
    'vote:cast',
    'results:read',
    'audit:read',
    'users:read',
    'export:csv',
  ],
  employee: [
    'vote:read',
    'vote:cast',
    'results:read',
  ],
  auditor: [
    'vote:read',
    'results:read',
    'audit:read',
    'export:csv',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Verifica Access Token
// ─────────────────────────────────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido', code: 'NO_TOKEN' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Adjuntar permisos al request
    decoded.permissions = PERMISSIONS[decoded.role] || [];
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(403).json({ error: 'Token inválido', code: 'TOKEN_INVALID' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Verifica Refresh Token
// ─────────────────────────────────────────────────────────────────────────────
const authenticateRefresh = (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token requerido', code: 'NO_REFRESH_TOKEN' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Refresh token inválido o expirado', code: 'REFRESH_INVALID' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Verifica roles
// ─────────────────────────────────────────────────────────────────────────────
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'No tienes permisos para esta acción',
      code:  'FORBIDDEN',
      required: roles,
      current:  req.user.role,
    });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Verifica permisos granulares
// ─────────────────────────────────────────────────────────────────────────────
const can = (permission) => (req, res, next) => {
  const perms = PERMISSIONS[req.user.role] || [];
  if (!perms.includes(permission)) {
    return res.status(403).json({
      error:      `Permiso requerido: ${permission}`,
      code:       'PERMISSION_DENIED',
      permission,
    });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Generar par de tokens
// ─────────────────────────────────────────────────────────────────────────────
const generateTokens = (user) => {
  const payload = {
    id:         user.id,
    email:      user.email,
    name:       user.name,
    role:       user.role,
    department: user.department,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || '2h',
  });

  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );

  return { accessToken, refreshToken };
};

module.exports = { authenticate, authenticateRefresh, authorize, can, generateTokens, PERMISSIONS };
