import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { getLastKnownLocation } from "./agents/safetyAgent.js";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

const DEMENTIA_SYSTEM_PROMPT = `
You are a warm, gentle, reassuring voice companion for a person living with dementia or memory loss.
Your name is Engram. 

Guidelines:
1. Speak in short, clear, soothing sentences (1 to 2 sentences max).
2. Never patronize, argue, or quiz the person's memory.
3. Validate their feelings. If they seem confused or anxious, offer gentle grounding and comfort.
4. If the camera/video frame is active, observe the environment and include meaningful visual details in the stored memory description.
5. If ONLY audio is provided (no camera/visual frame), DO NOT pretend to see them.
6. Never assume details that were not spoken or seen. If someone says "I went for a walk", do not invent "London Bridge".
7. If they ask about the past, check the provided stored memories and answer specifically and accurately based only on what was actually recorded.
8. CRITICAL SAFETY RULES:
   - If they ask about medicine dosages or pill schedules: DO NOT give dosage instructions. Reassure them gently and mention you will notify their caregiver. Set "dose_question": true.
   - If they report an injury, fall, or severe pain: Reassure them and set "emergency": true.
   - If they express severe distress, panic, or fear: Set "distress": true.

Always return a JSON object with:
{
  "user_transcript": "the words spoken by the user",
  "spoken_response": "1-2 gentle sentences to say aloud to the patient",
  "extracted_memory": {
    "who": ["people explicitly mentioned, or empty"],
    "what": "exact summary of what was stated, without fabricated places or people",
    "where": "location explicitly mentioned, or null",
    "when": "time explicitly mentioned, or null"
  },
  "flags": {
    "emergency": boolean,
    "dose_question": boolean,
    "distress": boolean
  }
}
`;

// Guardrail checks for safety and medical / dosage questions
export function checkSafetyGuardrails(queryText) {
  const q = (queryText || "").toLowerCase().trim();

  // 1. Medication / Dosage / Treatment guardrail (Strict non-clinical advice)
  if (/\b(pill|pills|dose|dosage|medicine|medication|aspirin|tablet|tablets|capsule|capsules|prescription|prescribed|insulin|inhaler|drops|antibiotic|antibiotics|statin|statins|take my pills|how many pills|should i take|missed a dose|mg|milligram|milligrams)\b/i.test(q)) {
    return {
      triggered: true,
      result: {
        user_transcript: queryText,
        spoken_response: "I've made a note of your medication question Rhea. I cannot advise on doses, but I will alert your caregiver right away to assist you.",
        extracted_memory: null,
        flags: { emergency: false, dose_question: true, distress: false },
      },
    };
  }

  // 2. Physical Emergency / Falls / Trauma / Symptoms guardrail
  if (/\b(hurt|hurts|hurting|fall|fell|fallen|slip|slipped|pain|bleeding|blood|burn|burned|dizzy|dizziness|faint|fainted|collapse|collapsed|chest pain|short of breath|can't breathe|cannot breathe|headache|choking|emergency|call 911|call an ambulance|help me)\b/i.test(q)) {
    return {
      triggered: true,
      result: {
        user_transcript: queryText,
        spoken_response: "Please stay still and rest Rhea. I am notifying your caregiver and emergency contacts immediately.",
        extracted_memory: null,
        flags: { emergency: true, dose_question: false, distress: false },
      },
    };
  }

  // 3. Acute Distress / Severe Disorientation / Delusion guardrail
  if (/\b(scared|terrified|panic|panicking|frightened|lost|where am i|who am i|intruder|someone is here|hearing voices|take me home|i want to go home|i don't know where i am|abandoned)\b/i.test(q)) {
    return {
      triggered: true,
      result: {
        user_transcript: queryText,
        spoken_response: "You are completely safe Rhea, right in your home. I am here with you, and your caregiver is aware.",
        extracted_memory: null,
        flags: { emergency: false, dose_question: false, distress: true },
      },
    };
  }

  return { triggered: false };
}

// Memory / Personal database search
export function searchPatientMemories(queryText, memories = []) {
  const q = (queryText || "").toLowerCase().trim();

  // Question Intent Detection
  const isQuestion =
    q.startsWith("what") ||
    q.startsWith("where") ||
    q.startsWith("who") ||
    q.startsWith("when") ||
    q.startsWith("did i") ||
    q.startsWith("have i") ||
    q.startsWith("do i") ||
    q.includes("?");

  if (!isQuestion) return null;

  // Meal / food question
  if (/\b(lunch|eat|ate|food|breakfast|dinner|pasta|soup|meal|snack|tea|coffee|drink)\b/i.test(q)) {
    const foodMemory = memories.find(m => /lunch|pasta|eat|ate|dinner|breakfast|food|soup|meal|tea|coffee|drink/i.test(m.what));
    if (foodMemory) {
      return {
        user_transcript: queryText,
        spoken_response: `You had ${foodMemory.what.replace(/^(i had|had|ate)\s+/i, "")} Rhea.`,
        extracted_memory: null,
        flags: { emergency: false, dose_question: false, distress: false },
      };
    }
    return { found: false, topic: "food" };
  }

  // Activity / walk / location question
  if (/\b(walk|went|go|going|outing|park|garden|outside|visit)\b/i.test(q)) {
    const walkMemory = memories.find(m => /walk|went|garden|outing|park|outside/i.test(m.what));
    if (walkMemory) {
      return {
        user_transcript: queryText,
        spoken_response: `You mentioned: "${walkMemory.what}".`,
        extracted_memory: null,
        flags: { emergency: false, dose_question: false, distress: false },
      };
    }
    return { found: false, topic: "activity" };
  }

  // People / visitor question
  if (/\b(who|see|visit|visited|visitor|came|call|called|spoke)\b/i.test(q)) {
    const visitMemory = memories.find(m => m.who && m.who.length > 0);
    if (visitMemory) {
      return {
        user_transcript: queryText,
        spoken_response: `${visitMemory.who.join(", ")} visited you Rhea.`,
        extracted_memory: null,
        flags: { emergency: false, dose_question: false, distress: false },
      };
    }
    return { found: false, topic: "people" };
  }

  return null;
}

// Search nearby places (restaurants, stores, supermarkets, gas stations, cafes, pharmacies)
export async function searchNearbyPlaces(category, areaName) {
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(category + " near " + areaName)}&format=json&limit=5`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "AnchorCareDemo/1.0" },
    });
    const data = await searchRes.json();
    if (Array.isArray(data) && data.length > 0) {
      return data
        .map((p) => p.display_name.split(",")[0].trim())
        .filter((name) => name && !/^\d+$/.test(name))
        .slice(0, 4);
    }
    return [];
  } catch (err) {
    console.warn("Search nearby places error:", err.message);
    return [];
  }
}

// Reverse geocode GPS coordinates into human-readable area & surroundings
export async function getSurroundingsContext(latitude, longitude) {
  try {
    const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
    const geoRes = await fetch(geoUrl, {
      headers: { "User-Agent": "AnchorCareDemo/1.0" },
    });
    const geoData = await geoRes.json();

    const road = geoData.address?.road || "";
    const suburb = geoData.address?.suburb || geoData.address?.neighbourhood || "";
    const city = geoData.address?.city || geoData.address?.town || geoData.address?.county || "";
    const areaName = [road, suburb, city].filter(Boolean).join(", ");

    // Search for prominent nearby landmarks/amenities around this area
    let landmarks = [];
    try {
      const searchUrl = `https://nominatim.openstreetmap.org/search?q=landmark+near+${encodeURIComponent(areaName)}&format=json&limit=4`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "AnchorCareDemo/1.0" },
      });
      const searchData = await searchRes.json();
      landmarks = searchData.map((p) => p.display_name.split(",")[0]).slice(0, 3);
    } catch (_) {}

    return {
      areaName,
      road,
      suburb,
      city,
      landmarks,
      fullAddress: geoData.display_name || areaName,
    };
  } catch (err) {
    console.warn("Geocoding surroundings error:", err.message);
    return null;
  }
}

// Fallback LLM layer for generic queries with double-layer safety validation
export async function answerGenericWithGemini(queryText, memories = [], history = []) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const genericSystemPrompt = `
You are Engram, a calm, reassuring companion for Rhea, an individual living with memory loss.
You are responding to a generic conversation or factual query (e.g., date, general knowledge, time, weather, gentle greeting).

STRICT PATIENT SAFETY GUARD RAILS:
1. Speak in at most 1 to 2 clear, warm sentences.
2. Under NO circumstances provide medical, medication, prescription, or clinical dosage information.
3. Under NO circumstances fabricate or guess personal events, family members, appointments, or medical history for Rhea.
4. If the question asks for advice on physical symptoms, instruct Rhea gently to consult her doctor or caregiver.
5. If the query asks about a personal event not recorded in notes, say: "I do not have a record of that yet Rhea."
6. If the patient asks for her name, remind her gently that her name is Rhea.
`;

  try {
    const prompt = `Current Time: ${new Date().toLocaleTimeString()}
Patient Query: "${queryText}"`;

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: genericSystemPrompt,
        temperature: 0.1,
      },
    });

    let rawAnswer = response.text?.trim() || "I am right here with you Rhea.";

    // Post-generation guardrail filter: verify LLM didn't hallucinate medications or clinical instructions
    const postCheck = (rawAnswer || "").toLowerCase();
    if (/\b(take \d+|take two|dosage of|prescribe|milligram|tablets daily|doctor told you to take)\b/i.test(postCheck)) {
      rawAnswer = "I've noted that question Rhea, and I will alert your caregiver so they can check your care plan.";
    }

    return {
      user_transcript: queryText,
      spoken_response: rawAnswer,
      extracted_memory: null,
      flags: { emergency: false, dose_question: false, distress: false },
    };
  } catch (err) {
    console.warn("Generic Gemini LLM fallback error:", err.message);
    return {
      user_transcript: queryText,
      spoken_response: "I am here with you Rhea. How can I help you today?",
      extracted_memory: null,
      flags: { emergency: false, dose_question: false, distress: false },
    };
  }
}

export async function searchMemoriesAndRespond(queryText, memories = [], hasVisualFrame = false, history = []) {
  const q = (queryText || "").toLowerCase().trim();

  // 1. Critical Pre-Flight Guardrails (Dosage, Emergency, Severe Distress)
  const guard = checkSafetyGuardrails(queryText);
  if (guard.triggered) {
    return guard.result;
  }

  // 2. Patient Identity Query ("What is my name?")
  if (/\b(what is my name|who am i|what's my name|is my name)\b/i.test(q)) {
    return {
      user_transcript: queryText,
      spoken_response: "Your name is Rhea. I am Engram, and I am right here with you.",
      extracted_memory: null,
      flags: { emergency: false, dose_question: false, distress: false },
    };
  }

  // 3. Surroundings & Nearby Location Questions ("What is near me?", "Where am I right now?", "What are my surroundings?")
  if (
    /\b(near me|nearby|surroundings|around me|what place is this|where are we|what is around|where am i right now|which area am i in|restaurant|restaurants|cafe|cafes|food place|store|stores|shop|shops|supermarket|supermarkets|gas station|petrol station|grocery|groceries|bakery|pharmacy)\b/i.test(q)
  ) {
    const loc = getLastKnownLocation();
    if (loc && loc.latitude && loc.longitude) {
      const geo = await getSurroundingsContext(loc.latitude, loc.longitude);
      if (geo && geo.areaName) {
        // Detect specific category requested
        let category = null;
        if (/\b(restaurant|restaurants|food|places to eat|dinner|lunch)\b/i.test(q)) category = "restaurant";
        else if (/\b(cafe|cafes|coffee)\b/i.test(q)) category = "cafe";
        else if (/\b(gas station|petrol station|fuel)\b/i.test(q)) category = "gas station";
        else if (/\b(supermarket|supermarkets|grocery|groceries)\b/i.test(q)) category = "supermarket";
        else if (/\b(store|stores|shop|shops)\b/i.test(q)) category = "store";
        else if (/\b(pharmacy|chemist)\b/i.test(q)) category = "pharmacy";

        if (category) {
          const places = await searchNearbyPlaces(category, geo.areaName);
          if (places.length > 0) {
            return {
              user_transcript: queryText,
              spoken_response: `Near you around ${geo.road || geo.areaName}, you have ${places.join(", ")}.`,
              extracted_memory: null,
              flags: { emergency: false, dose_question: false, distress: false },
            };
          }
        }

        let answer = `You are currently near ${geo.areaName}.`;
        if (geo.landmarks && geo.landmarks.length > 0) {
          answer += ` Nearby you have ${geo.landmarks.join(", ")}.`;
        }
        return {
          user_transcript: queryText,
          spoken_response: answer,
          extracted_memory: null,
          flags: { emergency: false, dose_question: false, distress: false },
        };
      }
    }
    return {
      user_transcript: queryText,
      spoken_response: "You are currently in your comfortable local area Rhea. I am keeping track of your location for you.",
      extracted_memory: null,
      flags: { emergency: false, dose_question: false, distress: false },
    };
  }

  // 4. Personal Memory Database Lookup
  const memoryResult = searchPatientMemories(queryText, memories);
  if (memoryResult) {
    if (memoryResult.spoken_response) {
      return memoryResult;
    }
    // Strict Anti-Hallucination: If the question is about personal life (meals, walks, visitors)
    // and no entry is found in DB, DO NOT delegate to LLM.
    return {
      user_transcript: queryText,
      spoken_response: "I do not have a record of that yet Rhea.",
      extracted_memory: null,
      flags: { emergency: false, dose_question: false, distress: false },
    };
  }

  // 4. Question check: If it is a generic question (e.g., "what is the capital of France?", "what day is it?", "how are you?")
  const isQuestion =
    q.startsWith("what") ||
    q.startsWith("where") ||
    q.startsWith("who") ||
    q.startsWith("when") ||
    q.startsWith("how") ||
    q.startsWith("why") ||
    q.startsWith("is ") ||
    q.startsWith("can you") ||
    q.includes("?");

  if (isQuestion) {
    // Check if query is asking for personal memories without matching keywords
    const isPersonalQuery = /\b(i|my|mine|me|we|our|did i|have i|do i|am i)\b/i.test(q);
    if (isPersonalQuery) {
      return {
        user_transcript: queryText,
        spoken_response: "I do not have a record of that yet Rhea.",
        extracted_memory: null,
        flags: { emergency: false, dose_question: false, distress: false },
      };
    }

    // Generic non-personal query: Safe to call Gemini LLM layer
    return await answerGenericWithGemini(queryText, memories, history);
  }

  // 5. Statement / Sharing a Memory (Extract & save to database)
  let extractedWhere = null;
  let extractedWho = [];

  // Only extract explicitly stated locations
  if (q.includes("london bridge")) extractedWhere = "London Bridge";
  else if (q.includes("garden")) extractedWhere = "Garden";
  else if (q.includes("kitchen")) extractedWhere = "Kitchen";

  // Only extract explicitly stated people
  if (q.includes("sarah")) extractedWho.push("Sarah");
  if (q.includes("david")) extractedWho.push("David");

  let memoryDescription = queryText || "Recorded memory";
  let acknowledge = `I've saved that note for you Rhea: "${queryText}".`;

  if (hasVisualFrame) {
    extractedWhere = extractedWhere || "Room (Camera Active)";
    memoryDescription = `${queryText} [Camera feed active]`;
    acknowledge = `I've saved what you shared along with the camera view Rhea.`;
  }

  return {
    user_transcript: queryText,
    spoken_response: acknowledge,
    extracted_memory: {
      who: extractedWho,
      what: memoryDescription,
      where: extractedWhere,
      when: new Date().toISOString(), // Valid ISO event timestamp for clean ingestion
    },
    flags: { emergency: false, dose_question: false, distress: false },
  };
}

export async function processPatientAudio(audioBase64, mimeType, history = [], memories = [], text = null, imageBase64 = null) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  const contextPrompt = `
Current Time: ${new Date().toLocaleTimeString()}
Known memories:
${memories.length > 0 ? memories.map(m => `- [${m.when || "Recorded"}] ${m.what} (with: ${m.who?.join(", ") || "none"}) at ${m.where || "unspecified"}`).join("\n") : "No previous memories recorded."}

Recent conversation:
${history.map(h => `${h.role === "user" ? "Patient" : "Companion"}: ${h.content}`).join("\n")}
`;

  try {
    const parts = [{ text: contextPrompt }];
    if (text) {
      parts.push({ text: `Patient message: "${text}"` });
    }
    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || "audio/wav",
          data: audioBase64,
        },
      });
    }
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      });
    }

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: DEMENTIA_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text);
    return parsed;
  } catch (error) {
    return await searchMemoriesAndRespond(text, memories, !!imageBase64, history);
  }
}
