require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const authRoutes    = require('./routes/auth');
const votingRoutes  = require('./routes/voting');
const resultsRoutes = require('./routes/results');
const auditRoutes   = require('./routes/audit');

const app = express();

// ── CORS abierto para producción pública ─────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());
app.use(morgan('dev'));

// ── Rate Limiting simple (sin dependencias externas) ─────────────────────────
// Protege el login contra ataques de fuerza bruta
const loginAttempts = new Map();

function rateLimitLogin(req, res, next) {
  const ip  = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const key = `login_${ip}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minuto
  const maxAttempts = 10;     // máximo 10 intentos por minuto por IP

  const record = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };

  // Reiniciar ventana si ya expiró
  if (now > record.resetAt) {
    record.count   = 0;
    record.resetAt = now + windowMs;
  }

  record.count++;
  loginAttempts.set(key, record);

  // Limpiar entradas viejas cada 5 minutos para no llenar la memoria
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts.entries()) {
      if (now > v.resetAt) loginAttempts.delete(k);
    }
  }

  if (record.count > maxAttempts) {
    const waitSeconds = Math.ceil((record.resetAt - now) / 1000);
    return res.status(429).json({
      error: `Demasiados intentos de login. Espera ${waitSeconds} segundos.`,
      code:  'RATE_LIMIT_EXCEEDED',
      retryAfter: waitSeconds,
    });
  }

  next();
}

// Aplicar rate limit solo al endpoint de login
app.use('/api/auth/login', rateLimitLogin);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/voting',  votingRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/audit',   auditRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor', detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🗳️  VoteChain API corriendo en http://localhost:${PORT}`);
  console.log(`📋  Health check: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
