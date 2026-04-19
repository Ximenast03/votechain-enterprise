// ─────────────────────────────────────────────────────────────────────────────
// db.js  —  Almacén en memoria con soporte para roles granulares
// ─────────────────────────────────────────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ── Usuarios ──────────────────────────────────────────────────────────────────
const users = [
  {
    id:         uuidv4(),
    name:       'Admin VoteChain',
    email:      'admin@votechain.com',
    password:   bcrypt.hashSync('Admin123!', 12),
    role:       'admin',
    department: 'TI',
    active:     true,
    lastLogin:  null,
    createdAt:  new Date().toISOString(),
  },
  {
    id:         uuidv4(),
    name:       'María González',
    email:      'maria@votechain.com',
    password:   bcrypt.hashSync('Employee123!', 12),
    role:       'employee',
    department: 'RRHH',
    active:     true,
    lastLogin:  null,
    createdAt:  new Date().toISOString(),
  },
  {
    id:         uuidv4(),
    name:       'Carlos Ruiz',
    email:      'carlos@votechain.com',
    password:   bcrypt.hashSync('Employee123!', 12),
    role:       'employee',
    department: 'Operaciones',
    active:     true,
    lastLogin:  null,
    createdAt:  new Date().toISOString(),
  },
  {
    id:         uuidv4(),
    name:       'Laura Auditor',
    email:      'laura@votechain.com',
    password:   bcrypt.hashSync('Auditor123!', 12),
    role:       'auditor',
    department: 'Cumplimiento',
    active:     true,
    lastLogin:  null,
    createdAt:  new Date().toISOString(),
  },
  {
    id:         uuidv4(),
    name:       'Pedro Manager',
    email:      'pedro@votechain.com',
    password:   bcrypt.hashSync('Manager123!', 12),
    role:       'manager',
    department: 'Dirección',
    active:     true,
    lastLogin:  null,
    createdAt:  new Date().toISOString(),
  },
];

// ── Votaciones ────────────────────────────────────────────────────────────────
const votes = [
  {
    id:               uuidv4(),
    title:            'Beneficios de trabajo remoto 2025',
    description:      '¿Estás de acuerdo con adoptar modelo híbrido 3 días en oficina?',
    options: [
      { id: uuidv4(), text: 'Totalmente de acuerdo', votes: 0 },
      { id: uuidv4(), text: 'De acuerdo',            votes: 0 },
      { id: uuidv4(), text: 'En desacuerdo',          votes: 0 },
      { id: uuidv4(), text: 'Totalmente en desacuerdo', votes: 0 },
    ],
    status:            'active',
    anonymous:         true,
    blockchainEnabled: true,
    createdBy:         users[0].id,
    startDate:         new Date().toISOString(),
    endDate:           new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    participants:      [],
    totalVotes:        0,
    chainVoteId:       null,
    deployTxHash:      null,
    createdAt:         new Date().toISOString(),
  },
];

// ── Log de auditoría blockchain ───────────────────────────────────────────────
const auditLog = [];

module.exports = { users, votes, auditLog };
