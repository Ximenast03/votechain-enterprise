require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes    = require('./routes/auth');
const votingRoutes  = require('./routes/voting');
const resultsRoutes = require('./routes/results');
const auditRoutes   = require('./routes/audit');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(morgan('dev'));

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
