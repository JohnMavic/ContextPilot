import { useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "running" | "error";

export type TranscriptItem = {
  id: string;
  text: string;
  isFinal: boolean;
};

const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random()}`;

const floatToInt16Base64 = (floatData: Float32Array) => {
  const int16 = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i++) {
    const s = Math.max(-1, Math.min(1, floatData[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

export function useRealtime() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [framesSent, setFramesSent] = useState<number>(0);
  const [bytesSent, setBytesSent] = useState<number>(0);
  const [lastEventType, setLastEventType] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => stop(), []);

  const handleMessage = (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data);
      console.log("[WS RECV]", msg.type, JSON.stringify(msg, null, 2));
      setLastEventType(msg.type || null);

      if (msg.type === "transcription.output_text.delta" && msg.delta) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.delta, isFinal: false },
        ]);
        return;
      }
      if (msg.type === "transcription.output_text.done" && msg.text) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.text, isFinal: true },
        ]);
        return;
      }

      if (
        msg.type === "conversation.item.input_audio_transcription.delta" &&
        msg.delta
      ) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.delta, isFinal: false },
        ]);
        return;
      }
      if (
        msg.type === "conversation.item.input_audio_transcription.completed" &&
        msg.transcript
      ) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.transcript, isFinal: true },
        ]);
        return;
      }

      if (msg.type === "response.output_text.delta" && msg.delta) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.delta, isFinal: false },
        ]);
        return;
      }
      if (msg.type === "response.output_text.done" && msg.text) {
        setTranscript((prev) => [
          ...prev,
          { id: makeId(), text: msg.text, isFinal: true },
        ]);
        return;
      }

      if (msg.type === "conversation.item.created" && msg.item?.content) {
        const textContent = msg.item.content.find(
          (c: any) =>
            c.transcript || c.text || c.type === "input_audio" || c.type === "text",
        );
        if (textContent?.transcript) {
          setTranscript((prev) => [
            ...prev,
            { id: makeId(), text: textContent.transcript, isFinal: true },
          ]);
        }
        return;
      }

      if (msg.type === "error") {
        console.error("[WS ERROR]", msg);
        setError(
          `Server Error: ${msg.error?.message || msg.error?.code || JSON.stringify(msg)}`,
        );
      }
    } catch (err) {
      console.warn("Failed to parse WS message", err);
    }
  };

  const connectWs = (_apiKey: string) => {
    const url = `ws://localhost:8080`;
    console.log("[WS] Verbinde zu Proxy:", url);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      console.log("[WS] Connected, sending session update");
      setStatus("running");

      // Minimales Format laut Berater (Dez 2025) - nur die 3 erlaubten Felder
      const sessionUpdate = {
        type: "transcription_session.update",
        session: {
          input_audio_transcription: {
            model: "gpt-4o-transcribe",
            prompt: "",
            language: "de",
          },
        },
      };
      console.log("[WS SEND]", JSON.stringify(sessionUpdate, null, 2));
      ws.send(JSON.stringify(sessionUpdate));
    };

    ws.onmessage = handleMessage;
    ws.onerror = (e) => {
      console.error(e);
      setError("WebSocket Fehler – bitte API-Key/Netz prüfen.");
      setStatus("error");
    };
    ws.onclose = () => {
      setStatus((prev) => (prev === "error" ? "error" : "idle"));
    };
  };

  const start = async (apiKey: string, deviceId?: string) => {
    if (!apiKey) {
      setError("API-Key fehlt.");
      return;
    }
    if (status === "running" || status === "connecting") return;
    setError(null);
    setTranscript([]);
    setFramesSent(0);
    setBytesSent(0);
    setLastEventType(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: 24000,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/worklets/pcm16-processor.js?v=" + Date.now());
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(ctx, "pcm16-processor");
      workletRef.current = worklet;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(worklet).connect(gain).connect(ctx.destination);

      connectWs(apiKey);

      worklet.port.onmessage = (event: MessageEvent) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }
        const data = event.data;
        const floatData = data instanceof Float32Array ? data : new Float32Array(data);
        const b64 = floatToInt16Base64(floatData);
        setFramesSent((c) => c + 1);
        setBytesSent((c) => c + floatData.byteLength);
        wsRef.current.send(
          JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }),
        );
      };
    } catch (err) {
      console.error(err);
      setError("Audio- oder Verbindungsfehler. Berechtigungen/Device prüfen.");
      setStatus("error");
      stop("error");
    }
  };

  const stop = (nextStatus: Status = "idle") => {
    wsRef.current?.close();
    wsRef.current = null;

    workletRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    setStatus(nextStatus);
  };

  return {
    status,
    error,
    transcript,
    start,
    stop,
    resetTranscript: () => setTranscript([]),
    stats: { framesSent, bytesSent, lastEventType },
  };
}
