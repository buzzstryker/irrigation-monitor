/**
 * tuya.js — Minimal Tuya Cloud OpenAPI client.
 *
 * Hand-rolled HMAC-SHA256 signer + thin wrappers around the two endpoints
 * we actually need:
 *   - POST /v1.0/token  (obtain access_token)
 *   - GET  /v1.0/devices/{device_id}/status  (read DPs)
 *
 * No SDK, no extra deps — just Node built-in `crypto` + the global `fetch`
 * available in Node 18+.
 *
 * Required env vars (NOT created here — caller must ensure they're set):
 *   TUYA_ACCESS_ID       client_id from iot.tuya.com -> Cloud project
 *   TUYA_ACCESS_SECRET   client_secret from same project
 *   TUYA_DEVICE_ID       the ME201W's device ID, copied from the IoT console
 *   TUYA_REGION          'us' | 'eu' | 'cn' | 'in' (selects the base URL)
 *
 * Token cache: access tokens expire ~2h. We cache and refresh 5 min before
 * expiry to avoid edge-of-window failures.
 *
 * Signing reference (Tuya v1.0 signature, "non-token" vs "with-token" paths):
 *   https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g
 */

'use strict';

const crypto = require('crypto');

// --- Region routing --------------------------------------------------
const REGION_BASE_URLS = {
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
};

function baseUrl() {
  const region = (process.env.TUYA_REGION || 'us').toLowerCase();
  const url = REGION_BASE_URLS[region];
  if (!url) {
    throw new Error(`tuya: unknown TUYA_REGION=${region}. Expected one of: ${Object.keys(REGION_BASE_URLS).join(', ')}`);
  }
  return url;
}

function requireEnv() {
  const id = process.env.TUYA_ACCESS_ID;
  const secret = process.env.TUYA_ACCESS_SECRET;
  if (!id || !secret) {
    throw new Error('tuya: TUYA_ACCESS_ID and TUYA_ACCESS_SECRET must be set in .env');
  }
  return { id, secret };
}

// --- Signing ---------------------------------------------------------

/**
 * Tuya v1.0 signature:
 *   stringToSign = HTTPMethod + '\n' + SHA256(body) + '\n' + headerStr + '\n' + url
 *   signStr      = client_id + [access_token] + timestamp + [nonce] + stringToSign
 *   sign         = HMAC-SHA256(signStr, secret).toUpperCase()
 *
 * `headerStr` is empty when there are no signature headers (we don't use any).
 * `url` is the path + sorted query string.
 * `access_token` is omitted when fetching the token itself (`/v1.0/token`).
 */
function sign({ method, path, body, accessToken, timestamp, clientId, secret }) {
  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = `${method}\n${bodyHash}\n\n${path}`;
  const signStr = `${clientId}${accessToken || ''}${timestamp}${stringToSign}`;
  return crypto
    .createHmac('sha256', secret)
    .update(signStr)
    .digest('hex')
    .toUpperCase();
}

// --- Token cache -----------------------------------------------------

let _token = null;
let _tokenExpiresAt = 0; // epoch ms

async function getAccessToken() {
  const now = Date.now();
  // Refresh 5 minutes before expiry to dodge clock skew + edge timing.
  if (_token && now < _tokenExpiresAt - 5 * 60 * 1000) return _token;

  const { id, secret } = requireEnv();
  const path = '/v1.0/token?grant_type=1';
  const timestamp = String(now);
  const signature = sign({
    method: 'GET',
    path,
    body: '',
    accessToken: '',
    timestamp,
    clientId: id,
    secret,
  });

  const res = await fetch(baseUrl() + path, {
    method: 'GET',
    headers: {
      client_id: id,
      sign: signature,
      t: timestamp,
      sign_method: 'HMAC-SHA256',
    },
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(`tuya: token request failed (code=${json.code}): ${json.msg}`);
  }

  _token = json.result.access_token;
  // expire_time is seconds-from-now per Tuya docs.
  _tokenExpiresAt = now + json.result.expire_time * 1000;
  return _token;
}

// --- Device status ---------------------------------------------------

/**
 * Fetch the raw datapoint list for the device.
 * Returns the array Tuya returns: `[{ code, value }, ...]`.
 *
 * DOES NOT pick out a specific DP or convert units — that's the caller's job
 * after you've inspected the raw output once and confirmed which `code` field
 * carries liquid level depth and what its unit is (mm / cm / m / scaled int).
 */
async function getDeviceStatus(deviceId) {
  const { id, secret } = requireEnv();
  const target = deviceId || process.env.TUYA_DEVICE_ID;
  if (!target) {
    throw new Error('tuya: TUYA_DEVICE_ID not set and no deviceId arg supplied');
  }

  const accessToken = await getAccessToken();
  const path = `/v1.0/devices/${target}/status`;
  const timestamp = String(Date.now());
  const signature = sign({
    method: 'GET',
    path,
    body: '',
    accessToken,
    timestamp,
    clientId: id,
    secret,
  });

  const res = await fetch(baseUrl() + path, {
    method: 'GET',
    headers: {
      client_id: id,
      access_token: accessToken,
      sign: signature,
      t: timestamp,
      sign_method: 'HMAC-SHA256',
    },
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(`tuya: device status request failed (code=${json.code}): ${json.msg}`);
  }
  return json.result; // [{ code, value }, ...]
}

/**
 * Optional: fetch device info, useful for confirming device model and
 * "last seen / online" status during the discovery checkpoint.
 */
async function getDeviceInfo(deviceId) {
  const { id, secret } = requireEnv();
  const target = deviceId || process.env.TUYA_DEVICE_ID;
  const accessToken = await getAccessToken();
  const path = `/v1.0/devices/${target}`;
  const timestamp = String(Date.now());
  const signature = sign({
    method: 'GET',
    path,
    body: '',
    accessToken,
    timestamp,
    clientId: id,
    secret,
  });

  const res = await fetch(baseUrl() + path, {
    method: 'GET',
    headers: {
      client_id: id,
      access_token: accessToken,
      sign: signature,
      t: timestamp,
      sign_method: 'HMAC-SHA256',
    },
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(`tuya: device info request failed (code=${json.code}): ${json.msg}`);
  }
  return json.result;
}

module.exports = {
  getAccessToken,
  getDeviceStatus,
  getDeviceInfo,
};
