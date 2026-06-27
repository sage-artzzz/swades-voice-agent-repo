"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useDataChannel,
} from "@livekit/components-react";
import { LiveTranscript, type TranscriptEntry } from "@/components/LiveTranscript";
import { AgentStatePanel } from "@/components/AgentStatePanel";
import { TakeOverButton } from "@/components/TakeOverButton";

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "tool_call" | "transferring" | "transferred" | "transfer_declined";

function MonitorInner({ roomName }: { roomName: string }) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [intent, setIntent] = useState("");
  const [action, setAction] = useState("");
  const [collectedData, setCollectedData] = useState<Record<string, string>>({});
  const [callStatus, setCallStatus] = useState<"connected" | "transferring" | "ended">("connected");
  const [summary, setSummary] = useState<string | null>(null);
  const [isTakenOver, setIsTakenOver] = useState(false);
  const [interruptCount, setInterruptCount] = useState(0);

  const onData = useCallback((msg: { payload: Uint8Array; topic?: string }) => {
    try {
      const text = new TextDecoder().decode(msg.payload);
      const event = JSON.parse(text);

      switch (event.type) {
        case "transcript":
          setTranscript((prev) => [
            ...prev,
            { role: event.role, text: event.text, ts: Date.now() },
          ]);
          // Extract collected booking data from agent speech
          if (event.role === "agent") {
            const lower = event.text.toLowerCase();
            if (lower.includes("transferring") || lower.includes("connect you")) {
              setCallStatus("transferring");
            }
          }
          break;

        case "agent_state":
          setAgentState(event.state as AgentState);
          if (event.interrupted) setInterruptCount((n) => n + 1);
          if (event.tool) setAction(`${event.tool}…`);
          else if (event.state === "listening") setAction("");
          if (event.reason) setIntent(event.reason);
          if (event.state === "transferred" || event.state === "transfer_declined") {
            setCallStatus("ended");
          }
          break;

        case "call_summary":
          setSummary(event.summary);
          setCallStatus("ended");
          break;

        case "collected_data":
          setCollectedData((prev) => ({ ...prev, ...event.data }));
          break;
      }
    } catch {
      // ignore malformed messages
    }
  }, []);

  useDataChannel("monitoring", onData);
  useDataChannel("control", onData);

  const STATUS_COLOR = {
    connected: "bg-green-600",
    transferring: "bg-orange-500",
    ended: "bg-gray-600",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 flex flex-col gap-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Monitor</h1>
          <p className="text-gray-500 text-sm font-mono">{roomName}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-white text-sm font-medium capitalize ${STATUS_COLOR[callStatus]}`}>
            {callStatus}
          </span>
          {callStatus === "connected" && (
            <TakeOverButton isTakenOver={isTakenOver} onTakeOver={setIsTakenOver} />
          )}
        </div>
      </div>

      {isTakenOver && (
        <div className="bg-orange-900/40 border border-orange-600 rounded-xl p-3 text-orange-300 text-sm">
          You have taken over the call. Speak into your microphone — the caller hears you directly. Agent is paused.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 px-4 pt-4 pb-2 border-b border-gray-800">
            Agent State
          </h2>
          <AgentStatePanel
            state={agentState}
            intent={intent}
            action={action}
            collectedData={collectedData}
            interruptCount={interruptCount}
          />
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 px-4 pt-4 pb-2 border-b border-gray-800">
            Live Transcript
          </h2>
          <LiveTranscript entries={transcript} />
        </div>
      </div>

      {summary && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Post-Call Summary</h2>
          <p className="text-gray-200 text-sm leading-relaxed">{summary}</p>
        </div>
      )}

      <RoomAudioRenderer muted={!isTakenOver} />
    </div>
  );
}

function MonitorWithRoom() {
  const searchParams = useSearchParams();
  const roomName = searchParams.get("room") ?? "monitor-room";
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  useEffect(() => {
    const identity = `watcher-${Date.now()}`;
    fetch(`/api/token?room=${roomName}&identity=${identity}`)
      .then((r) => r.json())
      .then((d) => {
        setToken(d.token);
        setServerUrl(d.url);
      });
  }, [roomName]);

  if (!token || !serverUrl) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Connecting to room…</p>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false}
    >
      <MonitorInner roomName={roomName} />
    </LiveKitRoom>
  );
}

export default function MonitorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    }>
      <MonitorWithRoom />
    </Suspense>
  );
}
