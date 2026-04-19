const express = require('express');
const router  = express.Router();
const { auditLog } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');

// ── GET /api/audit  —  Log completo de bloques (solo admin) ──────────────────
router.get('/', authenticate, authorize('admin'), (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;

  const paginated = [...auditLog].reverse().slice(start, start + limit);

  res.json({
    total:       auditLog.length,
    page,
    totalPages:  Math.ceil(auditLog.length / limit),
    blocks:      paginated,
  });
});

// ── GET /api/audit/verify/:txHash  —  Verificar transacción por hash ─────────
router.get('/verify/:txHash', authenticate, (req, res) => {
  const entry = auditLog.find(e => e.transactionHash === req.params.txHash);
  if (!entry) return res.status(404).json({ error: 'Transacción no encontrada en la cadena' });

  res.json({
    verified: true,
    block: entry,
    message: 'Transacción verificada en la cadena de bloques',
  });
});

// ── GET /api/audit/vote/:voteId  —  Bloques de una votación específica ────────
router.get('/vote/:voteId', authenticate, authorize('admin'), (req, res) => {
  const entries = auditLog.filter(e => e.data.voteId === req.params.voteId);
  res.json({ voteId: req.params.voteId, totalBlocks: entries.length, blocks: entries });
});

module.exports = router;
