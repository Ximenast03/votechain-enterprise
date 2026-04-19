const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { votes, auditLog, syncVote, syncAuditEntry, deleteVoteFromDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { createVoteOnChain, castVoteOnChain, closeVoteOnChain } = require('../utils/blockchain');

// ── GET /api/voting  —  Listar todas las votaciones ───────────────────────────
router.get('/', authenticate, (req, res) => {
  const { status } = req.query;
  const list = status ? votes.filter(v => v.status === status) : votes;

  const safe = list.map(({ participants, ...rest }) => ({
    ...rest,
    hasVoted: participants.includes(req.user.id),
    participantCount: participants.length,
  }));

  res.json({ total: safe.length, votes: safe });
});

// ── GET /api/voting/:id  —  Detalle de una votación ───────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const vote = votes.find(v => v.id === req.params.id);
  if (!vote) return res.status(404).json({ error: 'Votación no encontrada' });

  const { participants, ...rest } = vote;
  res.json({ ...rest, hasVoted: participants.includes(req.user.id), participantCount: participants.length });
});

// ── POST /api/voting  —  Crear votación (solo admin) ─────────────────────────
router.post('/',
  authenticate,
  authorize('admin'),
  [
    body('title').notEmpty().withMessage('Título requerido'),
    body('options').isArray({ min: 2 }).withMessage('Mínimo 2 opciones'),
    body('endDate').isISO8601().withMessage('Fecha de cierre inválida'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, description = '', options, endDate, anonymous = true, blockchainEnabled = true } = req.body;

    const newVote = {
      id: uuidv4(),
      title,
      description,
      options: options.map(text => ({ id: uuidv4(), text, votes: 0 })),
      status: 'active',
      anonymous,
      blockchainEnabled,
      createdBy: req.user.id,
      startDate: new Date().toISOString(),
      endDate,
      participants: [],
      totalVotes: 0,
      chainVoteId: null,       // ID en el smart contract (se llena abajo)
      deployTxHash: null,
      createdAt: new Date().toISOString(),
    };

    votes.push(newVote);
    syncVote(newVote); // Persistir en MongoDB

    // ── Registrar en blockchain real si está habilitado ───────────────────────
    if (blockchainEnabled) {
      const startTs  = Math.floor(Date.now() / 1000);
      const endTs    = Math.floor(new Date(endDate).getTime() / 1000);
      const durationHours = Math.max(1, Math.ceil((endTs - startTs) / 3600));

      const chainResult = await createVoteOnChain({
        title,
        description,
        options,
        durationInHours: durationHours,
        isAnonymous: anonymous,
      });

      if (chainResult.success) {
        newVote.chainVoteId   = chainResult.chainVoteId;
        newVote.deployTxHash  = chainResult.transactionHash;
        syncVote(newVote); // Actualizar en MongoDB con chainVoteId
        console.log(`⛓️  Votación creada en blockchain. Chain ID: ${chainResult.chainVoteId} | Tx: ${chainResult.transactionHash}`);
      } else {
        console.warn('⚠️  Blockchain no disponible, votación guardada solo en memoria:', chainResult.error);
      }
    }

    res.status(201).json({ message: 'Votación creada', vote: newVote });
  }
);

// ── POST /api/voting/:id/cast  —  Emitir un voto ─────────────────────────────
router.post('/:id/cast',
  authenticate,
  [body('optionId').notEmpty().withMessage('Opción requerida')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const vote = votes.find(v => v.id === req.params.id);
    if (!vote)                    return res.status(404).json({ error: 'Votación no encontrada' });
    if (vote.status !== 'active') return res.status(400).json({ error: 'La votación no está activa' });
    if (vote.participants.includes(req.user.id)) {
      return res.status(409).json({ error: 'Ya emitiste tu voto en esta votación' });
    }

    const option = vote.options.find(o => o.id === req.body.optionId);
    if (!option) return res.status(400).json({ error: 'Opción no válida' });

    // Registrar voto en memoria
    option.votes      += 1;
    vote.totalVotes   += 1;
    vote.participants.push(req.user.id);

    let txHash      = null;
    let blockNumber = null;
    let chainError  = null;

    // ── Enviar transacción REAL al smart contract ─────────────────────────────
    if (vote.blockchainEnabled && vote.chainVoteId) {
      const optionIndex = vote.options.findIndex(o => o.id === option.id);
      const chainResult = await castVoteOnChain({
        chainVoteId: vote.chainVoteId,
        optionId: optionIndex,
        voterPrivateKey: null,  // usa el signer del backend (cuenta del deployer)
      });

      if (chainResult.success) {
        txHash      = chainResult.transactionHash;
        blockNumber = chainResult.blockNumber;
        console.log(`⛓️  Voto registrado en blockchain. Tx: ${txHash} | Bloque: ${blockNumber}`);
      } else {
        chainError = chainResult.error;
        console.warn('⚠️  Blockchain no disponible, voto guardado solo en memoria:', chainError);
      }
    }

    syncVote(vote); // Persistir voto actualizado en MongoDB

    // ── Agregar a audit log local ─────────────────────────────────────────────
    const crypto = require('crypto');
    const prevHash = auditLog.length > 0
      ? auditLog[auditLog.length - 1].blockHash
      : '0000000000000000000000000000000000000000000000000000000000000000';

    const entry = {
      blockNumber:     auditLog.length + 1,
      timestamp:       new Date().toISOString(),
      transactionHash: txHash || crypto.createHash('sha256').update(JSON.stringify({ voteId: vote.id, optionId: option.id, t: Date.now() })).digest('hex'),
      previousHash:    prevHash,
      onChain:         !!txHash,
      ethBlockNumber:  blockNumber,
      data: {
        voteId:   vote.id,
        optionId: option.id,
        voterId:  vote.anonymous
          ? `anon_${crypto.createHash('md5').update(req.user.id).digest('hex').slice(0, 8)}`
          : req.user.id,
      },
      status: 'confirmed',
    };
    entry.blockHash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    auditLog.push(entry);
    syncAuditEntry(entry); // Persistir en MongoDB

    res.json({
      message:         '¡Voto registrado exitosamente!',
      transactionHash: entry.transactionHash,
      blockNumber:     entry.blockNumber,
      onChain:         entry.onChain,
      ethBlockNumber:  blockNumber,
      chainWarning:    chainError || null,
    });
  }
);

// ── PATCH /api/voting/:id/status  —  Cerrar / pausar votación ─────────────────
router.patch('/:id/status', authenticate, authorize('admin'), async (req, res) => {
  const vote = votes.find(v => v.id === req.params.id);
  if (!vote) return res.status(404).json({ error: 'Votación no encontrada' });

  const allowed = ['active', 'paused', 'closed'];
  if (!allowed.includes(req.body.status)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${allowed.join(', ')}` });
  }

  vote.status = req.body.status;
  syncVote(vote); // Persistir en MongoDB

  // Cerrar también en blockchain
  if (req.body.status === 'closed' && vote.blockchainEnabled && vote.chainVoteId) {
    const chainResult = await closeVoteOnChain(vote.chainVoteId);
    if (!chainResult.success) {
      console.warn('⚠️  No se pudo cerrar en blockchain:', chainResult.error);
    }
  }

  res.json({ message: 'Estado actualizado', voteId: vote.id, status: vote.status });
});

// ── DELETE /api/voting/:id  —  Eliminar votación (admin) ─────────────────────
router.delete('/:id', authenticate, authorize('admin'), (req, res) => {
  const idx = votes.findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Votación no encontrada' });

  const deletedId = votes[idx].id;
  votes.splice(idx, 1);
  deleteVoteFromDB(deletedId); // Eliminar de MongoDB
  res.json({ message: 'Votación eliminada' });
});

module.exports = router;

