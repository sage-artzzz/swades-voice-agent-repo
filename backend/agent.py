import asyncio
import logging
import os
import json
from dataclasses import dataclass, field

from dotenv import load_dotenv
from openai import AsyncOpenAI
from livekit import rtc
from livekit.agents import (
    AgentSession,
    Agent,
    JobContext,
    WorkerOptions,
    cli,
    RoomInputOptions,
    function_tool,
    RunContext,
    AgentStateChangedEvent,
    UserInputTranscribedEvent,
    ConversationItemAddedEvent,
)
from livekit.plugins import deepgram, elevenlabs, openai as lk_openai
from twilio.rest import Client as TwilioClient

from db import init_db, save_call_summary
from tools import (
    check_slot_availability,
    confirm_booking,
    look_up_appointment,
    cancel_appointment,
    reschedule_appointment,
    note_caller_info,
    request_human_transfer,
)

load_dotenv()
logger = logging.getLogger("voice-agent")

SYSTEM_PROMPT = """You are a friendly and professional appointment assistant for a service business. Your name is Alex.

LANGUAGE RULE: Detect the language the caller speaks in their very first message and respond in that same language for the entire call. If they speak Hindi, respond in Hindi. Spanish → Spanish. English → English. Never switch languages unless the caller does.

YOUR CAPABILITIES:
1. Book a new appointment
2. Look up an existing appointment (by name or phone)
3. Cancel an appointment
4. Reschedule an appointment
5. Transfer to a human agent

BOOKING WORKFLOW:
- Collect: full name, reason, preferred date, preferred time, contact phone number.
- After the caller CONFIRMS each piece of info, call note_caller_info immediately (one call per field).
- Call check_slot_availability before confirming.
- Call confirm_booking to finalize.

LOOKUP / CANCEL / RESCHEDULE WORKFLOW:
- Call look_up_appointment first to find the appointment and its ID.
- Read the appointment details back to the caller to confirm you have the right one.
- Then call cancel_appointment or reschedule_appointment as requested.
- For reschedule: check availability of the new slot first if in doubt.

RULES:
- Keep responses concise and natural — you are speaking, not writing.
- Never mention tool names, booking IDs, or internal processes to the caller.
- Convert all dates/times to YYYY-MM-DD and HH:MM (24h) before calling tools.
- If the caller mentions billing, complaints, or wants a human, use request_human_transfer immediately.
"""


@dataclass
class CallState:
    transfer_requested: bool = False
    transfer_reason: str = ""
    transcript: list[dict] = field(default_factory=list)


class VoiceAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=SYSTEM_PROMPT,
            tools=[
                note_caller_info,
                check_slot_availability,
                confirm_booking,
                look_up_appointment,
                cancel_appointment,
                reschedule_appointment,
                request_human_transfer,
            ],
        )

    async def on_enter(self):
        await self.session.say(
            "Hello! Thank you for calling. I'm Alex, your virtual assistant. How can I help you today?"
        )


async def _publish(room: rtc.Room, payload: dict):
    """Publish a JSON monitoring event to all participants in the room."""
    try:
        await room.local_participant.publish_data(
            json.dumps(payload).encode(),
            reliable=True,
            topic="monitoring",
        )
    except Exception as e:
        logger.debug("publish failed: %s", e)


async def _do_warm_transfer(ctx: JobContext, state: CallState, session: AgentSession):
    """Dial the human agent via Twilio, speak call summary, handle accept/decline."""
    room = ctx.room
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_PHONE_NUMBER", "")
    to_number = os.environ.get("HUMAN_AGENT_PHONE", "")

    if not all([account_sid, auth_token, from_number, to_number]):
        logger.warning("Twilio credentials not configured — skipping transfer")
        await session.say(
            "I'm sorry, our transfer system is unavailable right now. Is there anything else I can help you with?"
        )
        return

    await _publish(room, {"type": "agent_state", "state": "transferring", "reason": state.transfer_reason})
    await session.say(
        f"Please hold while I connect you with a team member regarding {state.transfer_reason}."
    )

    recent = "\n".join(f"{t['role']}: {t['text']}" for t in state.transcript[-8:])
    summary_for_human = (
        f"Incoming transfer. Caller needs help with: {state.transfer_reason}. "
        f"Recent context: {recent[:400]}"
    )

    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Say>Incoming warm transfer from Alex, the AI assistant.</Say>"
        f"<Say>{summary_for_human}</Say>"
        "<Say>Please hold. The caller is being connected.</Say>"
        "<Pause length=\"30\"/>"
        "</Response>"
    )

    try:
        twilio = TwilioClient(account_sid, auth_token)
        call = twilio.calls.create(twiml=twiml, to=to_number, from_=from_number)
        logger.info("Twilio call SID: %s", call.sid)

        accepted = await _wait_for_transfer_response(twilio, call.sid)

        if accepted:
            await session.say("I'm connecting you now. Have a great conversation. Goodbye!")
            await _publish(room, {"type": "agent_state", "state": "transferred"})
        else:
            await session.say(
                "I'm sorry, our team isn't available right now. Can I help you with anything else?"
            )
            await _publish(room, {"type": "agent_state", "state": "transfer_declined"})

    except Exception as e:
        logger.error("Twilio transfer error: %s", e)
        await session.say("I'm sorry, I was unable to connect you. Please call back shortly.")


async def _wait_for_transfer_response(twilio_client: TwilioClient, call_sid: str, timeout: int = 35) -> bool:
    """Poll until the human agent picks up (in-progress) or the call fails."""
    for _ in range(timeout):
        await asyncio.sleep(1)
        try:
            call = twilio_client.calls(call_sid).fetch()
            if call.status == "in-progress":
                return True   # human picked up
            if call.status in ("no-answer", "busy", "failed", "canceled", "completed"):
                return False  # unreachable or hung up before answering
        except Exception:
            return False
    return False


async def _generate_summary(room: rtc.Room, state: CallState, room_name: str):
    if not state.transcript:
        return

    transcript_text = "\n".join(
        f"{t['role'].upper()}: {t['text']}" for t in state.transcript
    )

    client = AsyncOpenAI(
        api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        base_url="https://openrouter.ai/api/v1",
    )

    try:
        resp = await client.chat.completions.create(
            model="openai/gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": (
                    "Summarize this customer service call in 3-4 sentences. Include "
                    "what the caller needed, any appointment booked, and the outcome.\n\n"
                    f"Transcript:\n{transcript_text}"
                ),
            }],
        )
        summary = resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error("Summary generation failed: %s", e)
        summary = "Call summary unavailable."

    outcome = "transferred" if state.transfer_requested else "completed"
    await save_call_summary(room_name, transcript_text, summary, outcome)
    await _publish(room, {"type": "call_summary", "summary": summary, "outcome": outcome})
    logger.info("Post-call summary generated")


async def entrypoint(ctx: JobContext):
    await init_db()
    await ctx.connect()

    room = ctx.room
    state = CallState()
    takeover_active = False

    # userdata dict is shared with tool functions via context.userdata
    userdata: dict = {
        "transfer_requested": False,
        "transfer_reason": "",
        "room": room,   # gives tools access to publish collected_data events
        "collected": {},
    }

    session = AgentSession(
        userdata=userdata,
        stt=deepgram.STT(model="nova-2"),
        llm=lk_openai.LLM(
            model="openai/gpt-4o-mini",
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        ),
        tts=elevenlabs.TTS(
            voice_id=os.environ.get("ELEVEN_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
            model="eleven_turbo_v2",
        ),
    )

    agent = VoiceAgent()

    @session.on("user_input_transcribed")
    def on_user_transcribed(event: UserInputTranscribedEvent):
        if not event.is_final or takeover_active:
            return
        state.transcript.append({"role": "caller", "text": event.transcript})
        asyncio.create_task(
            _publish(room, {"type": "transcript", "role": "caller", "text": event.transcript})
        )

    @session.on("conversation_item_added")
    def on_conversation_item(event: ConversationItemAddedEvent):
        item = event.item
        if not hasattr(item, "role"):
            return
        if item.role == "assistant" and item.text_content:
            state.transcript.append({"role": "agent", "text": item.text_content})
            asyncio.create_task(
                _publish(room, {"type": "transcript", "role": "agent", "text": item.text_content})
            )

    _prev_state: list[str] = ["idle"]

    def _state_str(s) -> str:
        return s.value if hasattr(s, "value") else str(s).split(".")[-1].lower()

    @session.on("agent_state_changed")
    def on_agent_state(event: AgentStateChangedEvent):
        new = _state_str(event.new_state)
        interrupted = _prev_state[0] == "speaking" and new == "listening"
        _prev_state[0] = new
        payload: dict = {"type": "agent_state", "state": event.new_state}
        if interrupted:
            payload["interrupted"] = True
        asyncio.create_task(_publish(room, payload))

    @room.on("data_received")
    def on_data_received(data_packet):
        nonlocal takeover_active
        if data_packet.topic != "control":
            return
        try:
            msg = json.loads(data_packet.data.decode())
        except Exception:
            return

        if msg.get("type") == "takeover":
            takeover_active = msg.get("active", False)
            if takeover_active:
                logger.info("Watcher took over — agent pausing audio input")
                session.interrupt()
                session.input.set_audio_enabled(False)
                asyncio.create_task(
                    _publish(room, {"type": "agent_state", "state": "idle", "action": "watcher in control"})
                )
            else:
                logger.info("Watcher released — agent resuming audio input")
                session.input.set_audio_enabled(True)
                asyncio.create_task(
                    _publish(room, {"type": "agent_state", "state": "listening"})
                )

    await session.start(agent, room=room, room_input_options=RoomInputOptions())

    async def _transfer_watchdog():
        while True:
            await asyncio.sleep(0.5)
            if takeover_active:
                continue
            if userdata.get("transfer_requested"):
                state.transfer_requested = True
                state.transfer_reason = userdata.get("transfer_reason", "general inquiry")
                userdata["transfer_requested"] = False
                await _do_warm_transfer(ctx, state, session)
                break

    asyncio.create_task(_transfer_watchdog())

    disconnected = asyncio.Event()

    @room.on("disconnected")
    def _on_disconnected(*_):
        disconnected.set()

    await disconnected.wait()
    # Room is disconnected; LiveKit publish will fail silently.
    # Summary is saved to DB and the frontend fetches it via HTTP.
    try:
        await asyncio.wait_for(_generate_summary(room, state, room.name), timeout=30)
    except asyncio.TimeoutError:
        logger.warning("Summary generation timed out")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
