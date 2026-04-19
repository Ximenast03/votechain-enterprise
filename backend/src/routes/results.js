const express = require('express');
const router  = express.Router();
const { votes, auditLog } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { getResultsFromChain } = require('../utils/blockchain');

// ── GET /api/results/:id  —  Resultados de una votación ──────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const vote = votes.find(v => v.id === req.params.id);
  if (!vote) return res.status(404).json({ error: 'Votación no encontrada' });

  const total = vote.totalVotes;

  // Resultados del backend (fuente primaria)
  const results = vote.options.map(opt => ({
    id:         opt.id,
    text:       opt.text,
    votes:      opt.votes,
    percentage: total > 0 ? parseFloat(((opt.votes / total) * 100).toFixed(1)) : 0,
  }));

  const winner = results.reduce((a, b) => a.votes > b.votes ? a : b, results[0]);

  // Datos blockchain adicionales (si están disponibles)
  let chainResults = null;
  if (vote.blockchainEnabled && vote.chainVoteId) {
    chainResults = await getResultsFromChain(vote.chainVoteId);
  }

  // KPIs de auditoría de este voto
  const voteAuditEntries = auditLog.filter(e => e.data.voteId === vote.id);
  const onChainCount     = voteAuditEntries.filter(e => e.onChain).length;

  res.json({
    voteId:      vote.id,
    chainVoteId: vote.chainVoteId || null,
    title:       vote.title,
    description: vote.description,
    status:      vote.status,
    anonymous:   vote.anonymous,
    blockchainEnabled: vote.blockchainEnabled,
    totalVotes:  total,
    results,
    chainResults,               // Resultados directos desde el smart contract
    onChainVotes: onChainCount, // Cuántos votos están verificados en cadena
    winner:      total > 0 ? winner : null,
    participation: {
      voted:     vote.participants.length,
      startDate: vote.startDate,
      endDate:   vote.endDate,
    },
  });
});

// ── GET /api/results  —  Dashboard KPIs globales ──────────────────────────────
router.get('/', authenticate, (req, res) => {
  const totalVotaciones = votes.length;
  const activas  = votes.filter(v => v.status === 'active').length;
  const cerradas = votes.filter(v => v.status === 'closed').length;
  const totalVotos = votes.reduce((sum, v) => sum + v.totalVotes, 0);
  const totalBloques = auditLog.length;
  const votosEnCadena = auditLog.filter(e => e.onChain).length;

  const votosPorVotacion = votes.map(v => ({
    id:              v.id,
    title:           v.title,
    description:     v.description,
    status:          v.status,
    totalVotes:      v.totalVotes,
    participantCount: v.participants.length,
    endDate:         v.endDate,
    blockchainEnabled: v.blockchainEnabled,
    chainVoteId:     v.chainVoteId || null,
    options:         v.options,
  }));

  res.json({
    kpis: {
      totalVotaciones,
      activas,
      cerradas,
      totalVotos,
      totalBloques,
      votosEnCadena,
    },
    votosPorVotacion,
  });
});

module.exports = router;
