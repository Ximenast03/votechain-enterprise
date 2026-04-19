# VoteChain — Guía de Instalación en XAMPP
# ═══════════════════════════════════════════════════════════

## ARQUITECTURA CON XAMPP

```
XAMPP (Apache)          Node.js (Backend)       Hardhat (Blockchain)
   :80                     :3001                     :8545
   │                         │                         │
   ├── index.html            ├── /api/auth             ├── VoteChain.sol
   ├── proxy.php  ──────────►├── /api/voting           └── (en memoria)
   └── (archivos estáticos)  ├── /api/results
                             └── /api/audit
```

## PASO 1 — Estructura de carpetas en XAMPP

Crea esta estructura en:  C:\xampp\htdocs\votechain\

```
votechain\
├── index.html           ← copia de frontend/index.html
├── api\
│   └── proxy.php        ← copia de xampp/proxy.php
└── assets\              ← (opcional, para imágenes futuras)
```

Comandos rápidos (CMD como administrador):
```
mkdir C:\xampp\htdocs\votechain
mkdir C:\xampp\htdocs\votechain\api
copy [ruta]\frontend\index.html C:\xampp\htdocs\votechain\index.html
copy [ruta]\xampp\proxy.php     C:\xampp\htdocs\votechain\api\proxy.php
```

## PASO 2 — Habilitar extensión cURL en PHP (requerida para el proxy)

1. Abre  C:\xampp\php\php.ini
2. Busca:  ;extension=curl
3. Cambia a:  extension=curl
4. Guarda y reinicia Apache desde el panel de XAMPP

## PASO 3 — Iniciar los 3 servidores (en este orden)

### Terminal 1 — Blockchain Hardhat
```bash
cd C:\Users\ximena vega\Downloads\votechain-blockchain
npx hardhat node
```
Deja esta terminal abierta. Copia la dirección del contrato si lo redespliegas.

### Terminal 2 — Desplegar contrato (solo la primera vez)
```bash
cd C:\Users\ximena vega\Downloads\votechain-blockchain
npx hardhat run scripts/deploy.js --network localhost
```
⚠️  Anota la dirección que aparece. Si cambia, actualiza CONTRACT_ADDRESS en .env

### Terminal 3 — Backend Node.js
```bash
cd C:\Users\ximena vega\Downloads\votechain-backend
npm start
```
Verifica: http://localhost:3001/api/health → debe mostrar {"status":"ok"}

### Panel XAMPP — Apache
Abre el panel de XAMPP y presiona "Start" en Apache.

## PASO 4 — Abrir la app

- **Via XAMPP (proxy):**  http://localhost/votechain/
- **Directo a Node.js:**  Abre index.html con Live Server en VS Code

El frontend detecta automáticamente cuál ruta usar según la URL.

## PASO 5 — Archivo .env del backend

Crea  C:\Users\ximena vega\Downloads\votechain-backend\.env  con:

```
PORT=3001
FRONTEND_URL=http://localhost
JWT_SECRET=VoteChain_S3cr3t_2025_Cambia_Esto!
JWT_EXPIRES=8h
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
RPC_URL=http://127.0.0.1:8545
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

⚠️  IMPORTANTE: La DEPLOYER_KEY es la cuenta #0 de Hardhat (solo para desarrollo local).
    NUNCA uses esta clave en producción o en una red real.

## ARCHIVOS ACTUALIZADOS

| Archivo | Qué cambió |
|---------|-----------|
| backend/src/routes/voting.js | Ahora llama `castVoteOnChain` real + `createVoteOnChain` al crear |
| backend/src/routes/results.js | Expone `chainVoteId`, `chainResults`, `votosEnCadena` en KPIs |
| frontend/index.html | Conexión blockchain real, gráficas de detalle, auditoría mejorada |
| xampp/proxy.php | Proxy PHP para XAMPP → Node.js |

## FLUJO DE UN VOTO (con blockchain activo)

1. Admin crea votación → backend llama `contract.createVote(...)` → Hardhat mina el bloque
2. Empleado vota → backend llama `contract.castVote(chainVoteId, optionIndex)` → transacción real
3. Frontend muestra "⛓️ On-chain #bloque"
4. Estadísticas: botón "Leer desde blockchain" llama `contract.getResults()`
5. Auditoría: cada bloque muestra si es "on-chain" o "hash local"

## DEGRADACIÓN ELEGANTE

Si Hardhat no está corriendo, el sistema NO falla:
- Los votos se guardan en memoria del backend
- Se genera un hash SHA-256 local
- El frontend muestra advertencia "⚠️ blockchain no disponible"
- Al reiniciar Hardhat, los nuevos votos vuelven a la cadena

## SEGURIDAD — PENDIENTES PARA PRODUCCIÓN

| Problema actual | Solución para producción |
|-----------------|--------------------------|
| Datos en RAM | Migrar a PostgreSQL / MongoDB |
| JWT secret débil | Variable de entorno segura (min 32 chars) |
| Private key en .env | Hardware wallet / AWS KMS / Vault |
| CORS abierto (*) | Restringir a dominio específico |
| Sin rate limiting | Agregar express-rate-limit |
| Sin HTTPS | Configurar SSL en Apache/Nginx |
| Hardhat local | Desplegar en Sepolia testnet o red privada |
