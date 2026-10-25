import https from "https";
import dotenv from "dotenv";
import { handleCaregiverQuery } from "./caregiverAgent.js";
import {
  evaluateSafetyAndAlert,
  sendTelegramNotification,
  sendTelegramLocation,
  registerCaregiverChatId,
  setLocationTracking,
  isLocationTrackingEnabled,
  getLastKnownLocation,
} from "./safetyAgent.js";
import { processPatientAudio } from "../gemini.js";
import { Memory, Conversation } from "../models.js";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8949953938:AAGIm0QfkeSgqJHLgoNtNBM-Cxo3_Ox-A4Q";
let lastUpdateId = 0;
let isPolling = false;

/**
 * Long-polling worker for Telegram Bot updates (No tunnel or public URL required for testing!)
 */
export async function startTelegramBotPolling(patientId = "rhea_01") {
  if (isPolling) return;
  isPolling = true;
  console.log(`🤖 [Telegram Agent] Connected to @Anchorcarebot. Long-polling for messages...`);

  async function poll() {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;

          const msg = update.message;
          if (!msg || !msg.text) continue;

          const chatId = msg.chat.id;
          const userText = msg.text.trim();
          console.log(`[Telegram Msg from ${msg.from?.first_name || chatId}]: "${userText}"`);

          // Automatically link this chat ID so distress and emergency alerts push straight to it
          registerCaregiverChatId(chatId);

          // 1. Evaluate Safety Sentinel first (e.g. emergency, falls, medication questions)
          const safetyResult = await evaluateSafetyAndAlert(patientId, userText);

          // 2. Route between Caregiver command vs Memory conversation
          const lower = userText.toLowerCase();
          if (lower === "/start" || lower === "help") {
            const trackingStatus = isLocationTrackingEnabled() ? "🟢 ENABLED" : "🔴 DISABLED (Caregiver Request Required)";
            const welcome = `Hello ${msg.from?.first_name || "there"}! 👋\n\nI am the *AnchorCare Multi-Agent Companion*.\n\n🔔 *Caregiver Alerts Activated:* This chat is linked for Rhea.\n📍 *Location Feature:* ${trackingStatus}\n\n*Caregiver Commands:*\n• *enable location* — Turn on GPS map pin for distress alerts\n• *disable location* — Turn off location sharing\n• *location* — Request Rhea's current GPS location on the map now\n• *summary* — Get Rhea's daily activity & memory feed\n• *alerts* — Check recent safety or dosage warnings`;
            await sendTelegramNotification(welcome, chatId);
          } else if (lower.includes("enable location") || lower.includes("start location") || lower.includes("track location")) {
            setLocationTracking(true);
            const statusMsg = `📍 *Location Sharing Enabled!*\n\nFrom now on, whenever Rhea reports distress or an emergency, an exact Google Maps link and a pinned location will be dispatched to this chat.`;
            await sendTelegramNotification(statusMsg, chatId);
          } else if (lower.includes("disable location") || lower.includes("stop location")) {
            setLocationTracking(false);
            const statusMsg = `🔒 *Location Sharing Disabled!*\n\nPatient distress alerts will no longer include GPS pins until you request it again with *enable location*.`;
            await sendTelegramNotification(statusMsg, chatId);
          } else if (
            lower.includes("location") ||
            lower.includes("where is rhea") ||
            lower.includes("where's rhea") ||
            lower.includes("where is she") ||
            lower.includes("find rhea") ||
            lower.includes("track rhea") ||
            lower.includes("gps") ||
            lower.includes("map")
          ) {
            const loc = getLastKnownLocation();
            if (loc) {
              const updatedTime = loc.updatedAt ? new Date(loc.updatedAt).toLocaleTimeString() : "Just now";
              const mapMsg = `📍 *Rhea's Current Location:*\n• Status: Active GPS Lock\n• Time: ${updatedTime}\n• Coordinates: \`${loc.latitude}, ${loc.longitude}\`\n\n🗺️ *Open on Google Maps:*\nhttps://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
              await sendTelegramNotification(mapMsg, chatId);
              await sendTelegramLocation(loc.latitude, loc.longitude, chatId);
            } else {
              await sendTelegramNotification(`📍 Waiting for GPS fix from Rhea's device. Please keep the companion web app open to acquire satellite / network coordinates.`, chatId);
            }
          } else if (lower.includes("summary") || lower.includes("status") || lower.includes("alert")) {
            // Caregiver Agent
            const report = await handleCaregiverQuery(patientId, userText);
            await sendTelegramNotification(report, chatId);
          } else {
            // Patient Memory / Recall Agent
            const history = await Conversation.find({ patientId }).sort({ timestamp: -1 }).limit(6).lean();
            const memories = await Memory.find({ patientId }).sort({ createdAt: -1 }).limit(10).lean();

            const result = await processPatientAudio(null, null, history.reverse(), memories, userText, null);

            // Persist conversation & memory
            const now = new Date();
            await Conversation.create({
              householdId: "anchorcare-demo",
              subjectId: "demo-person-001",
              patientId,
              role: "user",
              content: userText,
              timestamp: now,
            });

            await Conversation.create({
              householdId: "anchorcare-demo",
              subjectId: "demo-person-001",
              patientId,
              role: "assistant",
              content: result.spoken_response,
              timestamp: new Date(),
            });

            if (result.extracted_memory && result.extracted_memory.what) {
              await Memory.create({
                householdId: "anchorcare-demo",
                subjectId: "demo-person-001",
                patientId,
                who: result.extracted_memory.who || [],
                what: result.extracted_memory.what,
                where: result.extracted_memory.where || null,
                when: result.extracted_memory.when || now.toISOString(),
                createdAt: now,
              });
            }

            // Reply on Telegram
            await sendTelegramNotification(result.spoken_response, chatId);
          }
        }
      }
    } catch (err) {
      // Bounded retry on network glip
      await new Promise((r) => setTimeout(r, 4000));
    }

    if (isPolling) {
      setTimeout(poll, 1000);
    }
  }

  poll();
}
