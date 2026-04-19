<?php
/**
 * VoteChain — Proxy PHP para XAMPP
 * 
 * Coloca este archivo en:   C:\xampp\htdocs\votechain\api\proxy.php
 * El frontend usa:           http://localhost/votechain/api/proxy.php?path=...
 * Este proxy redirige a:     http://localhost:3001/api/...
 *
 * Así XAMPP sirve el HTML estático y Node.js maneja la lógica.
 */

// ── CORS para desarrollo local ─────────────────────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Construir URL destino ──────────────────────────────────────────────────────
$nodePath = isset($_GET['path']) ? trim($_GET['path'], '/') : '';
$query    = '';

// Reenviar query string excepto 'path'
$params = $_GET;
unset($params['path']);
if (!empty($params)) {
    $query = '?' . http_build_query($params);
}

$targetUrl = "http://localhost:3001/api/{$nodePath}{$query}";

// ── Leer body entrante ─────────────────────────────────────────────────────────
$body        = file_get_contents('php://input');
$method      = $_SERVER['REQUEST_METHOD'];
$contentType = $_SERVER['CONTENT_TYPE'] ?? 'application/json';

// Reenviar Authorization header si existe
$headers = ["Content-Type: {$contentType}"];
if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $headers[] = "Authorization: {$_SERVER['HTTP_AUTHORIZATION']}";
} elseif (!empty($_SERVER['HTTP_BEARER'])) {
    $headers[] = "Authorization: Bearer {$_SERVER['HTTP_BEARER']}";
}

// ── cURL hacia el backend Node.js ──────────────────────────────────────────────
$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_FOLLOWLOCATION => false,
]);

if (in_array($method, ['POST', 'PUT', 'PATCH']) && $body) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

// ── Responder ──────────────────────────────────────────────────────────────────
if ($response === false) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode([
        'error'  => 'No se puede conectar al servidor VoteChain',
        'detail' => $curlErr,
        'hint'   => 'Asegúrate de que Node.js esté corriendo: npm start en votechain-backend'
    ]);
    exit;
}

http_response_code($httpCode);
header('Content-Type: application/json');
echo $response;
