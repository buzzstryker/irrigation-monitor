/**
 * sms/sender.js — Outbound SMS/MMS via Twilio
 */

const twilio = require('twilio');
const { getDb } = require('../db');

let _client = null;

function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || sid === 'your_twilio_account_sid') {
    console.warn('[SMS] Twilio credentials not configured — outbound SMS disabled');
    return null;
  }
  _client = twilio(sid, token);
  return _client;
}

function logOutbound(to, body, mediaUrl) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO sms_log (direction, from_number, to_number, body, media_url)
       VALUES ('outbound', ?, ?, ?, ?)`
    ).run(process.env.TWILIO_PHONE_NUMBER || '', to, body, mediaUrl || null);
  } catch (err) {
    console.error('[SMS] Failed to log outbound SMS:', err.message);
  }
}

/**
 * Send a plain text SMS.
 */
async function sendSMS(to, body) {
  const client = getClient();
  if (!client) {
    console.log(`[SMS] (dry run) To: ${to} | Body: ${body}`);
    logOutbound(to, body, null);
    return null;
  }

  try {
    const message = await client.messages.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      body,
    });
    console.log(`[SMS] Sent to ${to} | SID: ${message.sid}`);
    logOutbound(to, body, null);
    return message;
  } catch (err) {
    console.error(`[SMS] Failed to send to ${to}:`, err.message);
    logOutbound(to, `[FAILED] ${body}`, null);
    throw err;
  }
}

/**
 * Send an MMS with image attachment.
 */
async function sendMMS(to, body, mediaUrl) {
  const client = getClient();
  if (!client) {
    console.log(`[SMS] (dry run MMS) To: ${to} | Body: ${body} | Media: ${mediaUrl}`);
    logOutbound(to, body, mediaUrl);
    return null;
  }

  try {
    const message = await client.messages.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      body,
      mediaUrl: [mediaUrl],
    });
    console.log(`[SMS] MMS sent to ${to} | SID: ${message.sid}`);
    logOutbound(to, body, mediaUrl);
    return message;
  } catch (err) {
    console.error(`[SMS] MMS failed to ${to}:`, err.message);
    logOutbound(to, `[FAILED] ${body}`, mediaUrl);
    throw err;
  }
}

/**
 * Broadcast a message to multiple recipients.
 */
async function broadcast(recipients, body, mediaUrl) {
  const results = [];
  for (const to of recipients) {
    try {
      const msg = mediaUrl
        ? await sendMMS(to, body, mediaUrl)
        : await sendSMS(to, body);
      results.push({ to, success: true, sid: msg?.sid });
    } catch (err) {
      results.push({ to, success: false, error: err.message });
    }
  }
  return results;
}

module.exports = { sendSMS, sendMMS, broadcast };
