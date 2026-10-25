# Engram Demo (AnchorCare Multimodal Companion)

An AI-powered voice, visual, and memory companion tailored for individuals living with dementia and memory loss (configured for patient **Rhea**), complete with proactive caregiver alerts, Telegram sentinel bot integration, and live GPS map pinning.

---

## 🌟 Key Architecture & Capabilities

### 1. Multimodal Real-Time Interface
- **Audio & Voice Interaction:** Continuous speech capture with browser Web Audio API analyzer; patient pauses do not reset the transcript buffer.
- **Visual Context Capture:** Real-time webcam frame snapshots transmitted to the backend alongside voice input.
- **Low-Latency Streaming:** Direct WebSocket pipeline via Socket.IO for immediate transcription, grounding, and synthesized text-to-speech (TTS) responses.

### 2. Tiered Safety Guardrails & Anti-Hallucination Engine
- **Stage 1 (Clinical & Safety Guardrails):**
  - **Medication & Dosage Inquiries:** Strictly prevents clinical advice. Politely informs the patient that their caregiver has been alerted to review their care plan.
  - **Physical Emergencies & Falls:** Immediate de-escalation instructions with high-priority caregiver notification.
  - **Acute Distress & Disorientation:** Grounding and comforting responses tailored for memory loss patients.
- **Stage 2 (Database Memory Recall Priority):**
  - Evaluates queries against persistent MongoDB Atlas records (`engram.memories`, `engram.episodes`, `engram.conversations`).
  - Strict anti-hallucination barrier: If a personal activity (meals, walks, visitors) is missing from the database, the model will **never fabricate an answer** and responds: `"I do not have a record of that yet Rhea."`
- **Stage 3 (Generic Gemini LLM Layer):**
  - Safe everyday conversational queries (time, date, general knowledge) routed through Gemini (temperature 0.1) with clinical post-generation safety checks.

### 3. Caregiver Telegram Sentinel (`@Anchorcarebot`)
- **Automated Alerts:** Dispatches real-time markdown notifications directly to the caregiver's Telegram for falls, distress, or medication questions.
- **GPS Map Pinning:** Attaches clickable Google Maps links and native Telegram interactive map cards to emergency notices.
- **On-Demand Location Querying:** Caregivers can query live GPS coordinates at any time by sending `"where is rhea"` or `"location"` to the bot.
- **On-Demand Privacy Toggles:** Location sharing can be enabled/disabled at any time via Telegram commands (`enable location` / `disable location`).

### 4. Surroundings & Nearby Venue Discovery
- Patient queries like *"What is near me?"*, *"Can you find restaurants nearby?"*, or *"Are there stores or gas stations around?"* use live GPS coordinates and OpenStreetMap geocoding to return exact nearby businesses and streets.

---

## 📁 Repository Structure

```
├── backend/
│   ├── agents/
│   │   ├── safetyAgent.js      # Emergency detection, GPS pinning, and Telegram alert dispatcher
│   │   ├── telegramAgent.js    # Telegram long-polling bot listener for @Anchorcarebot
│   │   └── caregiverAgent.js   # Caregiver summary and timeline generator
│   ├── gemini.js               # Multi-tiered guardrail engine, geocoding & factual memory search
│   ├── models.js               # Mongoose schemas for MongoDB Atlas 'engram' database
│   ├── server.js               # Express + Socket.IO multimodal backend server (port 5000)
│   ├── tts.js                  # Speech synthesis layer
│   └── test_guardrails.js      # Automated guardrail test suite
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # Voice, video, and text companion interface for Rhea
│   │   ├── CaregiverPortal.jsx # Live caregiver review portal with alert badges & timeline
│   │   └── services/socket.js  # Socket.IO client configuration
│   └── vite.config.js
├── adapter/                    # AnchorCare ingestion adapter & unit test suite
└── team-handoff/               # Contracts, API specifications, and schemas
```

---

## 🚀 Quick Start & Setup

### Prerequisites
- Node.js (v20+ recommended)
- A MongoDB Atlas cluster (targeting the `engram` database)
- Gemini API Key
- Telegram Bot Token (e.g., from `@BotFather`)

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/Rheacoutinho/enegram-demo.git
cd enegram-demo
```

---

### Step 2: Configure Environment Variables

Create a `.env` file inside the `backend/` directory:
```bash
# backend/.env
PORT=5000
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/engram?retryWrites=true&w=majority
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CAREGIVER_CHAT_ID=your_chat_id_or_leave_empty_to_autolink
```

---

### Step 3: Start the Backend Server

```bash
cd backend
npm install
npm run dev
# or: node server.js
```
The backend will connect to MongoDB Atlas and start listening on **`http://localhost:5000`** while launching the Telegram bot listener.

---

### Step 4: Start the Frontend Companion

Open a second terminal window:
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 🧪 Testing the Guardrails

To verify that the medical and emergency guardrails are working properly without starting the web app, run:

```bash
cd backend
node test_guardrails.js
```

This runs automated test cases checking:
1. **Medication dosage inquiry refusal** (`dose_question: true`).
2. **Fall / trauma emergency trigger** (`emergency: true`).
3. **Severe distress de-escalation** (`distress: true`).
4. **Missing personal memory anti-hallucination barrier**.
5. **Database-grounded meal recall**.
6. **Generic general knowledge resolution**.

---

## 📱 Telegram Caregiver Commands

Send any of the following to your Telegram Bot:

| Command | Action |
| :--- | :--- |
| `/start` | Links your chat as the active caregiver recipient and shows status. |
| `location` or `where is rhea` | Sends Rhea's current GPS coordinates with a Google Maps link and native map card. |
| `enable location` | Turns on GPS map pinning for distress alerts. |
| `disable location` | Turns off GPS map pinning. |
| `summary` | Generates a daily summary of Rhea's recorded activities and meals. |
| `alerts` | Lists recent safety and medication warnings. |

---

## 🔒 Safety and Medical Notice

Engram is an assistive companion designed for reassurance, memory orientation, and caregiver notification. It does not replace medical supervision, and under no circumstances provides prescription advice or clinical instructions.
