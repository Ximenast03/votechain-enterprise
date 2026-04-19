// ─────────────────────────────────────────────────────────────────────────────
// db.js  —  Conexión a MongoDB Atlas con fallback a memoria RAM
// ─────────────────────────────────────────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ── Datos iniciales (usuarios de prueba) ─────────────────────────────────────
const defaultUsers = [
  { id: uuidv4(), name: 'Admin VoteChain',  email: 'admin@votechain.com',  password: bcrypt.hashSync('Admin123!',      12), role: 'admin',    department: 'TI',           active: true, lastLogin: null, createdAt: new Date().toISOString() },
  { id: uuidv4(), name: 'María González',   email: 'maria@votechain.com',  password: bcrypt.hashSync('Employee123!',   12), role: 'employee', department: 'RRHH',         active: true, lastLogin: null, createdAt: new Date().toISOString() },
  { id: uuidv4(), name: 'Carlos Ruiz',      email: 'carlos@votechain.com', password: bcrypt.hashSync('Employee123!',   12), role: 'employee', department: 'Operaciones',  active: true, lastLogin: null, createdAt: new Date().toISOString() },
  { id: uuidv4(), name: 'Laura Auditor',    email: 'laura@votechain.com',  password: bcrypt.hashSync('Auditor123!',    12), role: 'auditor',  department: 'Cumplimiento', active: true, lastLogin: null, createdAt: new Date().toISOString() },
  { id: uuidv4(), name: 'Pedro Manager',    email: 'pedro@votechain.com',  password: bcrypt.hashSync('Manager123!',    12), role: 'manager',  department: 'Dirección',    active: true, lastLogin: null, createdAt: new Date().toISOString() },
];

// ── Almacenes en memoria (siempre disponibles como fallback) ─────────────────
let users    = [...defaultUsers];
let votes    = [];
let auditLog = [];

// ── Conectar a MongoDB si MONGODB_URI está configurado ───────────────────────
let mongoClient = null;
let db          = null;
let usingMongo  = false;

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('ℹ️  MONGODB_URI no configurado — usando almacén en memoria');
    return false;
  }

  try {
    const { MongoClient } = require('mongodb');
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('votechain');

    // Crear índices únicos
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('votes').createIndex({ id: 1 },    { unique: true });

    // Sembrar usuarios iniciales si la colección está vacía
    const count = await db.collection('users').countDocuments();
    if (count === 0) {
      await db.collection('users').insertMany(defaultUsers);
      console.log('🌱  Usuarios iniciales sembrados en MongoDB');
    }

    // Cargar datos en memoria desde MongoDB
    users    = await db.collection('users').find({}).toArray();
    votes    = await db.collection('votes').find({}).toArray();
    auditLog = await db.collection('auditLog').find({}).toArray();

    usingMongo = true;
    console.log(`✅  Conectado a MongoDB Atlas — ${users.length} usuarios, ${votes.length} votaciones`);
    return true;
  } catch (err) {
    console.error('⚠️  No se pudo conectar a MongoDB, usando memoria RAM:', err.message);
    usingMongo = false;
    return false;
  }
}

// ── Sincronizar con MongoDB cuando cambian los datos ─────────────────────────
async function syncUser(user) {
  if (!usingMongo || !db) return;
  try {
    await db.collection('users').replaceOne({ id: user.id }, user, { upsert: true });
  } catch (err) {
    console.error('Error sync user:', err.message);
  }
}

async function syncVote(vote) {
  if (!usingMongo || !db) return;
  try {
    await db.collection('votes').replaceOne({ id: vote.id }, vote, { upsert: true });
  } catch (err) {
    console.error('Error sync vote:', err.message);
  }
}

async function syncAuditEntry(entry) {
  if (!usingMongo || !db) return;
  try {
    await db.collection('auditLog').insertOne(entry);
  } catch (err) {
    console.error('Error sync audit:', err.message);
  }
}

async function deleteVoteFromDB(voteId) {
  if (!usingMongo || !db) return;
  try {
    await db.collection('votes').deleteOne({ id: voteId });
  } catch (err) {
    console.error('Error delete vote:', err.message);
  }
}

// Iniciar conexión
connectMongo();

module.exports = {
  get users()    { return users; },
  get votes()    { return votes; },
  get auditLog() { return auditLog; },
  get usingMongo() { return usingMongo; },
  syncUser,
  syncVote,
  syncAuditEntry,
  deleteVoteFromDB,
};

