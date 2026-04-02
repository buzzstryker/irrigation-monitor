/**
 * sms/handler.js — Inbound Twilio SMS webhook handler
 *
 * Validates the Twilio request signature, identifies the sender,
 * parses the message body, routes to the appropriate command handler,
 * and returns an empty TwiML response.
 */

const twilio = require('twilio');
const { getDb } = require('../db');
const { sendSMS } = require('./sender');
const {
  handleStatus,
  handleTank,
  handleSuspend,
  handleResume,
  handleSkipToday,
  handleDitchCheck,
} = require('./commands');

/**
 * Validate that the request came from Twilio.
 * In development (no auth token configured), skip validation.
 */
function validateTwilioRequest(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || authToken === 'your_twilio_auth_token') {
    return true; // Skip validation in dev
  }

  const signature = req.headers['x-twilio-signature'] || '';
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body);
}

/**
 * Log inbound SMS to sms_log table.
 */
function logInbound(from, body, parsedCommand, zoneId) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO sms_log (direction, from_number, to_number, body, parsed_command, zone_id)
       VALUES ('inbound', ?, ?, ?, ?, ?)`
    ).run(from, process.env.TWILIO_PHONE_NUMBER || '', body, parsedCommand, zoneId);
  } catch (err) {
    console.error('[SMS] Failed to log inbound:', err.message);
  }
}

/**
 * Look up a user by phone number.
 */
function identifySender(phone) {
  const db = getDb();
  return db.prepare('SELECT * FROM user_preferences WHERE phone_number = ?').get(phone) || null;
}

/**
 * Parse the message body and return a structured command.
 */
function parseMessage(body) {
  const text = (body || '').trim().toUpperCase();

  // Observation replies
  if (/^GOOD$/i.test(text)) return { command: 'GOOD' };
  if (/^LOW$/i.test(text)) return { command: 'LOW' };
  if (/^HIGH$/i.test(text)) return { command: 'HIGH' };
  if (/^SKIP$/i.test(text)) return { command: 'SKIP' };

  // Manual commands
  if (/^STATUS$/i.test(text)) return { command: 'STATUS' };
  if (/^TANK$/i.test(text)) return { command: 'TANK' };
  if (/^RESUME$/i.test(text)) return { command: 'RESUME' };
  if (/^SKIP\s+TODAY$/i.test(text)) return { command: 'SKIP_TODAY' };
  if (/^DITCH\s+CHECK$/i.test(text)) return { command: 'DITCH_CHECK' };

  // SUSPEND with optional days
  const suspendMatch = text.match(/^SUSPEND\s*(\d+)?$/i);
  if (suspendMatch) {
    return { command: 'SUSPEND', days: suspendMatch[1] || '3' };
  }

  // Zone-specific observation: ZONE PE-Z4 HIGH
  const zoneMatch = text.match(/^ZONE\s+([\w-]+)\s+(GOOD|LOW|HIGH|SKIP)$/i);
  if (zoneMatch) {
    return { command: 'ZONE_OBSERVATION', zoneId: zoneMatch[1], rating: zoneMatch[2].toUpperCase() };
  }

  return { command: 'UNKNOWN', raw: text };
}

/**
 * Generate an empty TwiML response to prevent Twilio auto-replies.
 */
function emptyTwiml() {
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const resp = new MessagingResponse();
  return resp.toString();
}

/**
 * Main inbound SMS handler — Express route handler.
 */
async function handleInboundSMS(req, res) {
  // Validate request
  if (!validateTwilioRequest(req)) {
    console.warn('[SMS] Invalid Twilio signature — rejecting request');
    return res.status(403).send('Forbidden');
  }

  const from = req.body.From || '';
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0', 10);

  console.log(`[SMS] Inbound from ${from}: "${body}" (${numMedia} media)`);

  // Parse the message
  const parsed = parseMessage(body);

  // Log inbound
  logInbound(from, body, parsed.command, parsed.zoneId || null);

  // Identify sender
  const user = identifySender(from);
  if (!user) {
    console.warn(`[SMS] Unknown sender: ${from}`);
    // Still respond with empty TwiML to avoid error
    res.type('text/xml');
    return res.send(emptyTwiml());
  }

  console.log(`[SMS] Identified sender: ${user.user_name} (${user.role})`);

  // Route to handler
  try {
    switch (parsed.command) {
      case 'STATUS':
        await handleStatus(from);
        break;
      case 'TANK':
        await handleTank(from);
        break;
      case 'SUSPEND':
        await handleSuspend(from, parsed.days);
        break;
      case 'RESUME':
        await handleResume(from);
        break;
      case 'SKIP_TODAY':
        await handleSkipToday(from);
        break;
      case 'DITCH_CHECK':
        await handleDitchCheck(from);
        break;
      case 'GOOD':
      case 'LOW':
      case 'HIGH':
      case 'SKIP':
        // Phase 5 — observation reply handling (stub)
        await sendSMS(from,
          `Got your "${parsed.command}" reply. Observation processing will be active in Phase 5.`);
        break;
      case 'ZONE_OBSERVATION':
        // Phase 5 — zone-specific observation (stub)
        await sendSMS(from,
          `Got "${parsed.rating}" for zone ${parsed.zoneId}. Zone observation processing will be active in Phase 5.`);
        break;
      default:
        await sendSMS(from,
          'Unrecognized command. Try: STATUS, TANK, SUSPEND [days], RESUME, SKIP TODAY, or DITCH CHECK');
    }
  } catch (err) {
    console.error(`[SMS] Handler error for "${parsed.command}":`, err.message);
  }

  // Always return empty TwiML
  res.type('text/xml');
  res.send(emptyTwiml());
}

module.exports = { handleInboundSMS, parseMessage, validateTwilioRequest };
