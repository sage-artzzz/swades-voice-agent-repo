"use client";

type AgentState = "idle" | "listening" | "thinking" | "speaking" | "tool_call" | "transferring" | "transferred" | "transfer_declined";

const STATE_CONFIG: Record<AgentState, { label: string; color: string; pulse: boolean }> = {
  idle:              { label: "Idle",          color: "bg-gray-600",   pulse: false },
  listening:         { label: "Listening…",    color: "bg-green-600",  pulse: true  },
  thinking:          { label: "Thinking…",     color: "bg-yellow-500", pulse: true  },
  speaking:          { label: "Speaking",      color: "bg-blue-600",   pulse: true  },
  tool_call:         { label: "Processing…",   color: "bg-purple-600", pulse: true  },
  transferring:      { label: "Transferring",  color: "bg-orange-500", pulse: true  },
  transferred:       { label: "Transferred",   color: "bg-green-700",  pulse: false },
  transfer_declined: { label: "Not Available", color: "bg-red-700",    pulse: false },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  reason: "Reason",
  date: "Date",
  time: "Time",
  phone: "Phone",
};

const FIELD_ORDER = ["name", "reason", "date", "time", "phone"];

export function AgentStatePanel({
  state,
  intent,
  action,
  collectedData,
  interruptCount,
}: {
  state: AgentState;
  intent: string;
  action: string;
  collectedData: Record<string, string>;
  interruptCount: number;
}) {
  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.idle;
  const orderedFields = FIELD_ORDER.filter((k) => collectedData[k]);
  const extraFields = Object.keys(collectedData).filter((k) => !FIELD_ORDER.includes(k));

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-white text-sm font-medium ${cfg.color}`}
          >
            {cfg.pulse && (
              <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
            )}
            {cfg.label}
          </span>
          {action && (
            <span className="text-gray-400 text-sm italic">{action}</span>
          )}
        </div>
        {interruptCount > 0 && (
          <span className="text-xs text-orange-400 font-medium" title="Number of times caller interrupted the agent">
            {interruptCount} interrupt{interruptCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {intent && (
        <div className="text-sm">
          <span className="text-gray-500">Intent: </span>
          <span className="text-yellow-300 font-medium">{intent}</span>
        </div>
      )}

      {(orderedFields.length > 0 || extraFields.length > 0) && (
        <div className="mt-1 bg-gray-800/60 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Collected</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {[...orderedFields, ...extraFields].map((k) => (
              <div key={k} className="flex gap-1.5">
                <span className="text-gray-500 shrink-0">{FIELD_LABELS[k] ?? k}:</span>
                <span className="text-gray-100 truncate">{collectedData[k]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
