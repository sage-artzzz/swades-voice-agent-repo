import aiosqlite
import asyncio
import os
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", "appointments.db")


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                reason TEXT NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                phone TEXT NOT NULL,
                status TEXT DEFAULT 'confirmed',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS call_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT NOT NULL,
                transcript TEXT,
                summary TEXT,
                outcome TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()


async def check_availability(date: str, time: str) -> bool:
    """Returns True if the slot is free."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT id FROM appointments WHERE date = ? AND time = ? AND status = 'confirmed'",
            (date, time),
        )
        row = await cursor.fetchone()
        return row is None


async def book_appointment(name: str, reason: str, date: str, time: str, phone: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO appointments (name, reason, date, time, phone) VALUES (?, ?, ?, ?, ?)",
            (name, reason, date, time, phone),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": name, "reason": reason, "date": date, "time": time, "phone": phone}


async def save_call_summary(room_name: str, transcript: str, summary: str, outcome: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO call_summaries (room_name, transcript, summary, outcome) VALUES (?, ?, ?, ?)",
            (room_name, transcript, summary, outcome),
        )
        await db.commit()


async def find_appointments(name: str = "", phone: str = "") -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM appointments
               WHERE (? = '' OR name LIKE ?) AND (? = '' OR phone LIKE ?)
               AND status != 'cancelled'
               ORDER BY date ASC, time ASC""",
            (name, f"%{name}%", phone, f"%{phone}%"),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def cancel_appointment_by_id(appointment_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'",
            (appointment_id,),
        )
        await db.commit()
        return cursor.rowcount > 0


async def reschedule_appointment_by_id(appointment_id: int, new_date: str, new_time: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        conflict = await db.execute(
            "SELECT id FROM appointments WHERE date=? AND time=? AND status='confirmed' AND id!=?",
            (new_date, new_time, appointment_id),
        )
        if await conflict.fetchone():
            return None  # slot taken
        await db.execute(
            "UPDATE appointments SET date=?, time=? WHERE id=? AND status='confirmed'",
            (new_date, new_time, appointment_id),
        )
        await db.commit()
        row = await (await db.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,))).fetchone()
        return dict(row) if row else None


async def get_all_appointments() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM appointments ORDER BY date ASC, time ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_call_summary(room_name: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM call_summaries WHERE room_name = ? ORDER BY created_at DESC LIMIT 1",
            (room_name,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


if __name__ == "__main__":
    asyncio.run(init_db())
    print("Database initialized: appointments.db")
