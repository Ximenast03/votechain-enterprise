const { ethers } = require('ethers');
const VoteChainABI = require('./VoteChain.json');

// ─────────────────────────────────────────────────────────────────────────────
// blockchain.js — Conexión real con Smart Contract VoteChain
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const RPC_URL          = process.env.RPC_URL          || 'http://127.0.0.1:8545';
const PRIVATE_KEY      = process.env.DEPLOYER_KEY     || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Proveedor y signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);

// Instancia del contrato
const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  VoteChainABI.abi,
  signer
);

// ── Crear votación en blockchain ──────────────────────────────────────────────
async function createVoteOnChain({ title, description, options, durationInHours, isAnonymous }) {
  try {
    const tx = await contract.createVote(
      title,
      description,
      options,
      durationInHours,
      isAnonymous
    );
    const receipt = await tx.wait();
    const voteCounter = await contract.voteCounter();

    return {
      success:         true,
      transactionHash: receipt.hash,
      blockNumber:     receipt.blockNumber,
      chainVoteId:     voteCounter.toString(),
    };
  } catch (err) {
    console.error('Error creando voto en blockchain:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Emitir voto en blockchain ─────────────────────────────────────────────────
async function castVoteOnChain({ chainVoteId, optionId, voterPrivateKey }) {
  try {
    // Usar la clave del votante si se provee, si no usar el signer por defecto
    const voterSigner = voterPrivateKey
      ? new ethers.Wallet(voterPrivateKey, provider)
      : signer;

    const voterContract = contract.connect(voterSigner);
    const tx = await voterContract.castVote(chainVoteId, optionId);
    const receipt = await tx.wait();

    return {
      success:         true,
      transactionHash: receipt.hash,
      blockNumber:     receipt.blockNumber,
    };
  } catch (err) {
    console.error('Error emitiendo voto en blockchain:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Obtener resultados desde blockchain ───────────────────────────────────────
async function getResultsFromChain(chainVoteId) {
  try {
    const options = await contract.getResults(chainVoteId);
    return options.map(opt => ({
      id:        opt.id.toString(),
      text:      opt.text,
      voteCount: opt.voteCount.toString(),
    }));
  } catch (err) {
    console.error('Error obteniendo resultados:', err.message);
    return [];
  }
}

// ── Cerrar votación en blockchain ─────────────────────────────────────────────
async function closeVoteOnChain(chainVoteId) {
  try {
    const tx = await contract.closeVote(chainVoteId);
    const receipt = await tx.wait();
    return { success: true, transactionHash: receipt.hash };
  } catch (err) {
    console.error('Error cerrando votación:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Verificar si ya votó ──────────────────────────────────────────────────────
async function checkDidVote(chainVoteId, voterAddress) {
  try {
    return await contract.didVote(chainVoteId, voterAddress);
  } catch (err) {
    return false;
  }
}

// ── Hash simulado para auditoría ──────────────────────────────────────────────
const crypto = require('crypto');

function generateBlockHash(data) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data) + Date.now())
    .digest('hex');
}

function registerVoteOnChain(auditLog, { voteId, optionId, voterId, isAnonymous }) {
  const blockNumber  = auditLog.length + 1;
  const previousHash = auditLog.length > 0
    ? auditLog[auditLog.length - 1].blockHash
    : '0000000000000000000000000000000000000000000000000000000000000000';

  const entry = {
    blockNumber,
    timestamp: new Date().toISOString(),
    transactionHash: generateBlockHash({ voteId, optionId, blockNumber }),
    previousHash,
    blockHash: '',
    data: {
      voteId,
      optionId,
      voterId: isAnonymous
        ? `anon_${crypto.createHash('md5').update(voterId).digest('hex').slice(0, 8)}`
        : voterId,
    },
    status: 'confirmed',
  };

  entry.blockHash = generateBlockHash(entry);
  auditLog.push(entry);
  return entry;
}

module.exports = {
  contract,
  createVoteOnChain,
  castVoteOnChain,
  getResultsFromChain,
  closeVoteOnChain,
  checkDidVote,
  generateBlockHash,
  registerVoteOnChain,
};
