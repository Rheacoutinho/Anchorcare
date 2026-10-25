import https from "https";
import dotenv from "dotenv";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8949953938:AAGIm0QfkeSgqJHLgoNtNBM-Cxo3_Ox-A4Q";
let CAREGIVER_CHAT_ID = process.env.TELEGRAM_CAREGIVER_CHAT_ID || "";
let LOCATION_TRACKING_ENABLED = true; // Enabled by default for caregiver safety, toggleable via Telegram
let LAST_KNOWN_LOCATION = null;

// Fallback coordinate placeholder (e.g. London / Home base) if device GPS is completely blocked
const DEFAULT_FALLBACK_COORDS = {
  latitude: 51.5074,
  longitude: -0.1278,
  isDefault: true,
};

/**
 * Register a chat ID as an active caregiver recipient
 */
export function registerCaregiverChatId(chatId) {
  if (chatId) {
    CAREGIVER_CHAT_ID = String(chatId);
    console.log(`✓ [Telegram Sentinel] Registered Caregiver Chat ID: ${CAREGIVER_CHAT_ID}`);
  }
}

/**
 * Enable or disable location sharing based on caregiver's explicit request
 */
export function setLocationTracking(enabled) {
  LOCATION_TRACKING_ENABLED = !!enabled;
  console.log(`✓ [Telegram Sentinel] Location Tracking set to: ${LOCATION_TRACKING_ENABLED}`);
  return LOCATION_TRACKING_ENABLED;
}

export function isLocationTrackingEnabled() {
  return LOCATION_TRACKING_ENABLED;
}

/**
 * Update the patient's last known GPS/location
 */
export function updatePatientLocation(coords) {
  if (coords && coords.latitude && coords.longitude) {
    LAST_KNOWN_LOCATION = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy || null,
      city: coords.city || null,
      updatedAt: new Date(),
    };
    console.log(`📍 [Location Engine] Updated GPS: ${coords.latitude}, ${coords.longitude} (City: ${coords.city || "Exact GPS"})`);
  }
}

export function getLastKnownLocation() {
  return LAST_KNOWN_LOCATION || DEFAULT_FALLBACK_COORDS;
}

/**
 * Send an alert or message to a specific Telegram chat (or the default caregiver)
 */
export async function sendTelegramNotification(text, chatId = null) {
  const targetChatId = chatId || CAREGIVER_CHAT_ID;
  if (!targetChatId) {
    console.warn("[Telegram Sentinel] No caregiver chat registered yet. Send '/start' to @Anchorcarebot on Telegram to link this chat!");
    return false;
  }

  const payload = JSON.stringify({
    chat_id: targetChatId,
    text: text,
    parse_mode: "Markdown",
  });

  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 8000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`✓ [Telegram Sentinel] Alert delivered to chat ${targetChatId}`);
            resolve(true);
          } else {
            console.warn(`! [Telegram Sentinel] Delivery failed (HTTP ${res.statusCode}): ${body}`);
            resolve(false);
          }
        });
      }
    );

    req.on("error", (e) => {
      console.warn(`! [Telegram Sentinel] Network error: ${e.message}`);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send a native pinned location on the Telegram map
 */
export async function sendTelegramLocation(latitude, longitude, chatId = null) {
  const targetChatId = chatId || CAREGIVER_CHAT_ID;
  if (!targetChatId) return false;

  const payload = JSON.stringify({
    chat_id: targetChatId,
    latitude,
    longitude,
  });

  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendLocation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 8000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`📍 [Telegram Sentinel] Map pin delivered to chat ${targetChatId}`);
            resolve(true);
          } else {
            console.warn(`! [Telegram Sentinel] sendLocation failed: ${body}`);
            resolve(false);
          }
        });
      }
    );

    req.on("error", (e) => {
      console.warn(`! [Telegram Sentinel] sendLocation error: ${e.message}`);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Safety Sentinel: evaluates text and fires push notification if safety triggers
 */
export async function evaluateSafetyAndAlert(patientId, text, flags = {}) {
  const t = (text || "").toLowerCase();
  let alertType = null;
  let alertMessage = null;

  if (flags.emergency || /fall|fell|hurt|injured|bleeding|emergency|ambulance|999|help/i.test(t)) {
    alertType = "EMERGENCY_INJURY";
    alertMessage = `🚨 *CRITICAL EMERGENCY ALERT for ${patientId}*\n\nPatient reported physical injury or fall:\n_"${text}"_\n\nPlease check on them immediately!`;
  } else if (flags.dose_question || /dose|pill|pills|medicine|medication|tablet|how many/i.test(t)) {
    alertType = "MEDICATION_DOSAGE_QUERY";
    alertMessage = `⚠️ *MEDICATION SAFETY ALERT for ${patientId}*\n\nPatient inquired about medication dosage:\n_"${text}"_\n\nEngram safely withheld dosage advice. Please review their schedule.`;
  } else if (flags.distress || /scared|afraid|lost|confused|where am i|who are you/i.test(t)) {
    alertType = "PATIENT_DISTRESS";
    alertMessage = `🟡 *PATIENT DISTRESS NOTICE for ${patientId}*\n\nPatient expressed fear, anxiety, or disorientation:\n_"${text}"_\n\nReassurance was provided by Engram.`;
  }

  if (alertType) {
    const loc = getLastKnownLocation();
    // If location tracking is enabled by caregiver, append exact map link to the message
    if (LOCATION_TRACKING_ENABLED && loc) {
      const lat = loc.latitude;
      const lon = loc.longitude;
      const locLabel = loc.city ? ` (${loc.city})` : "";
      alertMessage += `\n\n📍 *Exact Pinned Location${locLabel}:*\nhttps://maps.google.com/?q=${lat},${lon}`;
    } else if (!LOCATION_TRACKING_ENABLED) {
      alertMessage += `\n\n🔒 _Location sharing is currently disabled by caregiver. Type 'enable location' to receive live GPS map pins._`;
    }

    // Deliver push alert directly to Telegram
    await sendTelegramNotification(alertMessage);

    // Also send native Telegram map pin if enabled
    if (LOCATION_TRACKING_ENABLED && loc) {
      await sendTelegramLocation(loc.latitude, loc.longitude);
    }

    return { flagged: true, type: alertType, message: alertMessage };
  }

  return { flagged: false };
}
