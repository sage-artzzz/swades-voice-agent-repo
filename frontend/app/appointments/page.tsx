"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Appointment = {
  id: number;
  name: string;
  reason: string;
  date: string;
  time: string;
  phone: string;
  status: string;
  created_at: string;
};

type Filter = "all" | "confirmed" | "cancelled";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-green-900/60 text-green-300",
  cancelled:  "bg-red-900/50 text-red-300",
};

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${backendUrl}/api/appointments`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAppointments(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = filter === "all" ? appointments : appointments.filter((a) => a.status === filter);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Appointments</h1>
            <p className="text-gray-400 text-sm mt-1">{visible.length} shown · {appointments.length} total</p>
          </div>
          <div className="flex gap-3">
            <button onClick={load} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm rounded-lg transition">
              Refresh
            </button>
            <Link href="/" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-sm rounded-lg transition">
              ← Back to Call
            </Link>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(["all", "confirmed", "cancelled"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-sm capitalize transition ${
                filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded-lg p-4 text-red-300 text-sm">
            Failed to load appointments: {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-400">
            No appointments found.
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Booked At</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a, i) => (
                  <tr
                    key={a.id}
                    className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition ${
                      a.status === "cancelled" ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{a.name}</td>
                    <td className="px-4 py-3 text-gray-300">{a.reason}</td>
                    <td className="px-4 py-3 text-gray-300">{a.date}</td>
                    <td className="px-4 py-3 text-gray-300">{a.time}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{a.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[a.status] ?? "bg-gray-700 text-gray-300"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{a.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
