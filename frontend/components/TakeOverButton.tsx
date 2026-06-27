"use client";

import { useCallback } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { DataPacket_Kind } from "livekit-client";

export function TakeOverButton({
  isTakenOver,
  onTakeOver,
}: {
  isTakenOver: boolean;
  onTakeOver: (v: boolean) => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const handleTakeOver = useCallback(async () => {
    const next = !isTakenOver;
    const payload = JSON.stringify({ type: "takeover", active: next });
    await localParticipant.publishData(
      new TextEncoder().encode(payload),
      { reliable: true, topic: "control" }
    );
    onTakeOver(next);
  }, [isTakenOver, localParticipant, onTakeOver]);

  return (
    <button
      onClick={handleTakeOver}
      className={`px-5 py-2 rounded-lg text-white font-medium transition ${
        isTakenOver
          ? "bg-green-700 hover:bg-green-800"
          : "bg-orange-600 hover:bg-orange-700"
      }`}
    >
      {isTakenOver ? "Release Control" : "Take Over Call"}
    </button>
  );
}
