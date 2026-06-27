# Swades Voice Agent

A conversational voice agent with live monitoring and warm transfer, built with LiveKit, OpenRouter, Deepgram, ElevenLabs, and Twilio. Runs entirely in Docker.

## Features

- **Voice appointment management** — book, look up, cancel, and reschedule appointments by voice
- **Slot conflict detection** — agent checks availability before confirming and offers alternatives if taken
- **Live monitoring dashboard** — real-time transcript, agent state, and collected caller data streamed to `/monitor`
- **Supervisor take-over** — mute the AI and speak directly to the caller without disconnecting
- **Warm transfer** — calls the human agent via Twilio, briefs them verbally, and detects when they pick up
- **Post-call summary** — LLM-generated summary saved to the database and shown on the ended-call screen
- **Multilingual** — detects the caller's language on the first message and responds in kind throughout the call
- **Barge-in tracking** — caller can interrupt the agent mid-sentence; monitor displays the interrupt count

## Architecture

```
┌──────────────────────────────────────────────┐
│  Next.js Frontend                            │
│  /               → Caller page (WebRTC)      │
│  /monitor        → Supervisor dashboard      │
│  /appointments   → Appointments list         │
│  /api/token      → LiveKit JWT generation    │
└────────────────────┬─────────────────────────┘
                     │ LiveKit Room (WebRTC + data channels)
┌────────────────────▼─────────────────────────┐
│  Python Backend                              │
│  agent.py  → LiveKit Agent (STT→LLM→TTS)    │
│  server.py → FastAPI (tokens, REST API)      │
│  db.py     → SQLite (appointments+summaries) │
│  tools.py  → LLM function tools             │
└──────────────────────────────────────────────┘
```

## Third-Party Services

| Service | Purpose | Free Tier |
|---|---|---|
| [LiveKit Cloud](https://cloud.livekit.io) | WebRTC room infrastructure | Yes |
| [OpenRouter](https://openrouter.ai) | LLM — GPT-4o-mini | Pay-per-token |
| [Deepgram](https://deepgram.com) | Speech-to-text (nova-2) | $200 credit |
| [ElevenLabs](https://elevenlabs.io) | Text-to-speech (Sarah voice) | 10k chars/month |
| [Twilio](https://twilio.com) | Outbound call for warm transfer | $15 trial credit |

## Quick Start (Docker)

### 1. Configure environment variables

**`backend/.env`**

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

OPENROUTER_API_KEY=your_openrouter_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key

ELEVEN_API_KEY=your_elevenlabs_api_key
ELEVEN_VOICE_ID=EXAVITQu4vr4xnSDxMaL   # Sarah (premade, free tier)

TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx        # your Twilio number
HUMAN_AGENT_PHONE=+1xxxxxxxxxx          # phone to call on warm transfer
```

**`frontend/.env.local`**

```env
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 2. Run with Make

```bash
make up                              # start on default ports (3000 / 8000)
make up FRONTEND_PORT=4000           # custom frontend port
make up FRONTEND_PORT=4000 BACKEND_PORT=9000  # custom both ports
```

| Command | Description |
|---|---|
| `make up` | Build and start all services |
| `make down` | Stop all services |
| `make restart` | Stop, rebuild, and start |
| `make logs` | Follow logs from all services |
| `make logs-api` | API logs only |
| `make logs-agent` | Agent logs only |
| `make logs-frontend` | Frontend logs only |
| `make status` | Show container status |
| `make clean` | Stop and wipe the database volume |
| `make help` | Show all commands and current config |

Once running:

| URL | Description |
|---|---|
| `http://localhost:3000` | Caller UI |
| `http://localhost:3000/monitor?room=<room>` | Supervisor monitoring dashboard |
| `http://localhost:3000/appointments` | Appointments list (filter by status) |
| `http://localhost:8000` | FastAPI backend |

## Call Flows

### Booking a new appointment

1. Caller opens `http://localhost:3000` and clicks **Start Call**.
2. Browser connects to a LiveKit room; the agent (Alex) joins automatically.
3. Agent greets the caller and collects: name, reason, date, time, phone number.
4. Each confirmed detail appears live on the monitoring dashboard.
5. Agent calls `check_slot_availability` — if taken, tells the caller and asks for another time.
6. Agent calls `confirm_booking` and reads the confirmation aloud.

### Look up / Cancel / Reschedule

- Caller says "I want to cancel my appointment" or "Can I move my booking to Thursday?"
- Agent looks up the appointment by name or phone, reads the details back to confirm, then cancels or reschedules.
- All changes are persisted in SQLite immediately.

### Live monitoring

1. Open `http://localhost:3000/monitor?room=<room-name>` in another tab.
2. Dashboard shows: live transcript, agent state badge (listening / thinking / speaking / processing), collected booking data, and interrupt count.

### Supervisor take-over

1. On the monitor page, click **Take Over**.
2. Agent is interrupted and its microphone input is disabled. Supervisor's mic goes live.
3. Caller hears the supervisor directly. Click **Release Control** to hand back to the agent.

### Warm transfer (Twilio)

1. Caller mentions billing, complaints, or asks to speak to a person.
2. Agent calls `request_human_transfer`, says "Please hold while I connect you."
3. Backend dials `HUMAN_AGENT_PHONE` via Twilio and plays a spoken briefing (reason + recent transcript).
4. Backend polls the Twilio call status:
   - `in-progress` (human picked up) → agent says "I'm connecting you now. Goodbye!"
   - `no-answer / busy / failed` → agent apologises and offers to continue helping.

### Post-call summary

When the caller disconnects, the agent sends the full transcript to GPT-4o-mini and generates a 3–4 sentence summary covering what the caller needed, any booking made, and the outcome. The summary is saved to SQLite and displayed on the ended-call screen. The supervisor dashboard also shows it when the call ends.

## Project Structure

```
swades-voice-agent/
├── backend/
│   ├── agent.py       # LiveKit voice agent — pipeline, monitoring events, warm transfer
│   ├── tools.py       # LLM function tools (book, look up, cancel, reschedule, transfer)
│   ├── db.py          # SQLite schema and async queries
│   ├── server.py      # FastAPI (token gen, appointments API, summary API)
│   └── pyproject.toml # uv-managed Python dependencies
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Caller UI + monitor panel
│   │   ├── monitor/page.tsx        # Standalone supervisor dashboard
│   │   ├── appointments/page.tsx   # Appointments list with status filter
│   │   └── api/token/route.ts      # LiveKit token endpoint (server-side)
│   └── components/
│       ├── AgentStatePanel.tsx     # State badge, collected data, interrupt count
│       ├── LiveTranscript.tsx      # Real-time chat-style transcript
│       └── TakeOverButton.tsx
├── docker-compose.yml
├── Makefile               # Docker shortcuts with configurable ports
└── .env.example
```

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check (used by Docker healthcheck) |
| `GET` | `/api/token?room=&identity=` | Issue a LiveKit JWT |
| `GET` | `/api/appointments` | List all appointments (all statuses) |
| `GET` | `/api/summary/{room_name}` | Fetch post-call summary for a room |

## Local Development (without Docker)

```bash
# Backend
cd backend
uv sync
uv run python db.py           # initialise SQLite
uv run python server.py       # FastAPI on :8000
uv run python agent.py start  # LiveKit worker

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # Next.js on :3000
```
