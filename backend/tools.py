import json
import logging
from livekit.agents import function_tool, RunContext
from db import (
    check_availability,
    book_appointment,
    find_appointments,
    cancel_appointment_by_id,
    reschedule_appointment_by_id,
)

logger = logging.getLogger(__name__)


async def _publish_collected(context: RunContext, field: str, value: str):
    room = context.userdata.get("room")
    if not room:
        return
    try:
        await room.local_participant.publish_data(
            json.dumps({"type": "collected_data", "data": {field: value}}).encode(),
            reliable=True,
            topic="monitoring",
        )
    except Exception:
        pass


@function_tool
async def note_caller_info(context: RunContext, field: str, value: str) -> str:
    """
    Record a confirmed piece of caller info so it appears live on the monitoring dashboard.
    Call this immediately after the caller confirms each detail.
    field: one of: name, reason, date, time, phone
    value: the confirmed value
    """
    context.userdata.setdefault("collected", {})[field] = value
    await _publish_collected(context, field, value)
    return f"Noted: {field} = {value}"


@function_tool
async def check_slot_availability(context: RunContext, date: str, time: str) -> str:
    """
    Check whether a specific date and time slot is available for booking.
    date: YYYY-MM-DD (e.g. 2025-07-15)
    time: HH:MM 24h (e.g. 14:30)
    """
    available = await check_availability(date, time)
    if available:
        return f"The slot on {date} at {time} is available."
    return f"Sorry, {date} at {time} is already booked. Please suggest another time."


@function_tool
async def confirm_booking(
    context: RunContext,
    name: str,
    reason: str,
    date: str,
    time: str,
    phone: str,
) -> str:
    """
    Book an appointment after confirming availability.
    name: full name of the caller
    reason: reason for the appointment
    date: YYYY-MM-DD
    time: HH:MM (24h)
    phone: contact number with country code
    """
    available = await check_availability(date, time)
    if not available:
        return f"The slot {date} at {time} was just taken. Please ask the caller for another preferred time."

    appt = await book_appointment(name, reason, date, time, phone)
    return (
        f"Appointment confirmed! Booking ID: {appt['id']}. "
        f"{name} is booked for '{reason}' on {date} at {time}. "
        f"Confirmation will be sent to {phone}."
    )


@function_tool
async def look_up_appointment(context: RunContext, name: str, phone: str) -> str:
    """
    Look up existing appointments by name and/or phone number.
    Pass an empty string for fields you don't know.
    name: caller's name (partial match)
    phone: caller's phone number (partial match)
    """
    results = await find_appointments(name=name, phone=phone)
    if not results:
        return "No active appointments found matching that name or phone number."
    lines = [
        f"ID {a['id']}: {a['name']} — {a['reason']} on {a['date']} at {a['time']} (status: {a['status']})"
        for a in results
    ]
    return "Found these appointments:\n" + "\n".join(lines)


@function_tool
async def cancel_appointment(context: RunContext, appointment_id: int) -> str:
    """
    Cancel an existing appointment by its ID.
    Always look up the appointment first and confirm the details with the caller before cancelling.
    appointment_id: the numeric ID from look_up_appointment
    """
    success = await cancel_appointment_by_id(appointment_id)
    if success:
        return f"Appointment {appointment_id} has been cancelled successfully."
    return f"Could not cancel appointment {appointment_id}. It may not exist or is already cancelled."


@function_tool
async def reschedule_appointment(
    context: RunContext,
    appointment_id: int,
    new_date: str,
    new_time: str,
) -> str:
    """
    Reschedule an existing appointment to a new date and time.
    Always look up and confirm the appointment with the caller first.
    appointment_id: the numeric ID from look_up_appointment
    new_date: YYYY-MM-DD
    new_time: HH:MM (24h)
    """
    result = await reschedule_appointment_by_id(appointment_id, new_date, new_time)
    if result is None:
        return (
            f"Cannot reschedule: {new_date} at {new_time} is already booked. "
            "Please ask the caller for another preferred time."
        )
    return (
        f"Appointment {appointment_id} rescheduled to {new_date} at {new_time}. "
        f"Confirmed for {result['name']} — {result['reason']}."
    )


@function_tool
async def request_human_transfer(context: RunContext, reason: str) -> str:
    """
    Initiate a warm transfer to a human agent when the caller needs human assistance.
    Use this when the caller mentions: billing issues, complaints, 'talk to a person',
    'speak to someone', 'human agent', or anything the AI cannot resolve.
    reason: brief reason for the transfer (e.g. 'billing dispute', 'complaint')
    """
    ctx_data = context.userdata
    ctx_data["transfer_requested"] = True
    ctx_data["transfer_reason"] = reason
    return f"Understood. I'll connect you with a human agent now regarding {reason}. Please hold."
