"use client";

import { useEffect, useRef } from "react";

export type TranscriptEntry = {
  role: "caller" | "agent";
  text: string;
  ts: number;
};

export function LiveTranscript({ entries }: { entries: TranscriptEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="text-gray-500 text-sm italic p-4">
        Waiting for conversation to start…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto max-h-96">
      {entries.map((e) => (
        <div
          key={e.ts}
          className={`flex gap-2 ${e.role === "agent" ? "justify-start" : "justify-end"}`}
        >
          <div
            className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
              e.role === "agent"
                ? "bg-blue-900 text-blue-100 rounded-tl-none"
                : "bg-gray-700 text-gray-100 rounded-tr-none"
            }`}
          >
            <span className="block text-xs font-semibold mb-1 opacity-60">
              {e.role === "agent" ? "Alex (Agent)" : "Caller"}
            </span>
            {e.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
