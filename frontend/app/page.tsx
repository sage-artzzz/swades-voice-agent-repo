"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
} from "@livekit/components-react";
import { LiveTranscript, type TranscriptEntry } from "@/components/LiveTranscript";
import { AgentStatePanel } from "@/components/AgentStatePanel";

type CallState = "idle" | "connecting" | "connected" | "ended";
type AgentState = "idle" | "listening" | "thinking" | "speaking" | "tool_call" | "transferring" | "transferred" | "transfer_declined";

// ── Monitor panel (inside LiveKitRoom context) ──────────────────────────────
function MonitorPanel() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [intent, setIntent] = useState("");
  const [action, setAction] = useState("");
  const [collectedData, setCollectedData] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [isTakenOver, setIsTakenOver] = useState(false);
  const [interruptCount, setInterruptCount] = useState(0);
  const { localParticipant } = useLocalParticipant();

  const onData = useCallback((msg: { payload: Uint8Array }) => {
    try {
      const event = JSON.parse(new TextDecoder().decode(msg.payload));
      switch (event.type) {
        case "transcript":
          setTranscript((prev) => [
            ...prev,
            { role: event.role, text: event.text, ts: Date.now() },
          ]);
          break;
        case "agent_state":
          setAgentState(event.state as AgentState);
          if (event.interrupted) setInterruptCount((n) => n + 1);
          if (event.tool) setAction(`${event.tool}…`);
          else if (["listening", "idle"].includes(event.state)) setAction("");
          if (event.reason) setIntent(event.reason);
          break;
        case "call_summary":
          setSummary(event.summary);
          break;
        case "collected_data":
          setCollectedData((prev) => ({ ...prev, ...event.data }));
          break;
      }
    } catch { /* ignore */ }
  }, []);

  useDataChannel("monitoring", onData);

  const handleTakeOver = useCallback(async () => {
    const next = !isTakenOver;
    const payload = JSON.stringify({ type: "takeover", active: next });
    await localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable: true,
      topic: "control",
    });
    setIsTakenOver(next);
  }, [isTakenOver, localParticipant]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Agent state */}
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Agent State</h2>
          <button
            onClick={handleTakeOver}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              isTakenOver
                ? "bg-green-700 hover:bg-green-800 text-white"
                : "bg-orange-600 hover:bg-orange-700 text-white"
            }`}
          >
            {isTakenOver ? "Release Control" : "Take Over"}
          </button>
        </div>
        <AgentStatePanel
          state={agentState}
          intent={intent}
          action={action}
          collectedData={collectedData}
          interruptCount={interruptCount}
        />
      </div>

      {isTakenOver && (
        <div className="bg-orange-900/40 border border-orange-600 rounded-lg px-3 py-2 text-orange-300 text-xs">
          You have taken over — speak into your mic. Agent is paused.
        </div>
      )}

      {/* Transcript */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 overflow-hidden flex flex-col">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-2 border-b border-gray-800">
          Live Transcript
        </h2>
        <div className="flex-1 overflow-y-auto">
          <LiveTranscript entries={transcript} />
        </div>
      </div>

      {/* Post-call summary */}
      {summary && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Post-Call Summary</h2>
          <p className="text-gray-200 text-sm leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}

// ── Call controls (inside LiveKitRoom context) ──────────────────────────────
function CallControls({ onDisconnect }: { onDisconnect: () => void }) {
  const state = useConnectionState();
  return (
    <div className="flex flex-col items-center gap-4">
      <RoomAudioRenderer />
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
        state === "connected" ? "bg-green-600 animate-pulse" : "bg-yellow-600"
      }`}>
        <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
        </svg>
      </div>
      <p className="text-sm text-gray-400">
        {state === "connected" ? "Connected to Alex" : "Connecting…"}
      </p>
      <button
        onClick={onDisconnect}
        className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
      >
        End Call
      </button>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function Page() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [callSummary, setCallSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const roomNameRef = useRef(`room-${Date.now()}`);
  const roomName = roomNameRef.current;

  const startCall = useCallback(async () => {
    setCallState("connecting");
    setCallSummary(null);
    const identity = `user-${Date.now()}`;
    const res = await fetch(`/api/token?room=${roomName}&identity=${identity}`);
    const data = await res.json();
    setToken(data.token);
    setServerUrl(data.url);
    setCallState("connected");
  }, [roomName]);

  const endCall = useCallback(() => {
    setCallState("ended");
    setToken("");
    // Poll the HTTP API for the post-call summary (LiveKit publish fails after disconnect)
    setSummaryLoading(true);
    (async () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch(`${backendUrl}/api/summary/${roomName}`);
          if (res.ok) {
            const data = await res.json();
            setCallSummary(data.summary ?? null);
            break;
          }
        } catch { /* retry */ }
      }
      setSummaryLoading(false);
    })();
  }, [roomName]);

  // ── Idle / ended screens ──────────────────────────────────────────────────
  if (callState === "idle" || callState === "connecting") {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-bold">Voice Assistant</h1>
        <p className="text-gray-400">Book an appointment with Alex, our AI assistant</p>
        <button
          onClick={startCall}
          disabled={callState === "connecting"}
          className="px-8 py-4 bg-blue-600 text-white text-lg rounded-xl hover:bg-blue-700 transition shadow-lg disabled:opacity-60"
        >
          {callState === "connecting" ? "Connecting…" : "Start Call"}
        </button>
        <Link href="/appointments" className="text-sm text-gray-500 hover:text-gray-300 transition">
          View Appointments →
        </Link>
      </main>
    );
  }

  if (callState === "ended") {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-6">
        <h1 className="text-2xl font-bold">Call Ended</h1>
        <p className="text-gray-400">Thank you for calling!</p>

        {/* Post-call summary */}
        <div className="w-full max-w-lg bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Post-Call Summary
          </h2>
          {callSummary ? (
            <p className="text-gray-200 text-sm leading-relaxed">{callSummary}</p>
          ) : summaryLoading ? (
            <p className="text-gray-500 text-sm italic animate-pulse">Generating summary…</p>
          ) : (
            <p className="text-gray-600 text-sm italic">No summary available.</p>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setCallState("idle")}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            New Call
          </button>
          <Link
            href="/appointments"
            className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition"
          >
            View Appointments
          </Link>
        </div>
      </main>
    );
  }

  // ── Active call — split layout ────────────────────────────────────────────
  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={endCall}
      className="min-h-screen bg-gray-950 text-white"
    >
      <div className="min-h-screen grid grid-cols-1 md:grid-cols-[280px_1fr] gap-0">
        {/* Left: Call panel */}
        <div className="bg-gray-900 border-r border-gray-800 flex flex-col items-center justify-center gap-6 p-6">
          <div className="text-center">
            <h1 className="text-xl font-bold">Voice Assistant</h1>
            <p className="text-gray-500 text-xs mt-1 font-mono">{roomName}</p>
          </div>
          <CallControls onDisconnect={endCall} />
        </div>

        {/* Right: Monitor panel */}
        <div className="p-4 overflow-y-auto">
          <div className="max-w-2xl mx-auto flex flex-col gap-4 h-full">
            <h2 className="text-lg font-bold text-gray-100">Live Monitor</h2>
            <MonitorPanel />
          </div>
        </div>
      </div>
    </LiveKitRoom>
  );
}
