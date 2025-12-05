import { useEffect, useRef, useState, useCallback } from "react";

type Status = "idle" | "connecting" | "running" | "error";
type Source = "mic" | "speaker";

export type TranscriptSegment = {
  itemId: string;
  text: string;
  isFinal: boolean;
  source: Source;
  timestamp: number;
};

type AudioSession = {
  ws: WebSocket | null;
  audioCtx: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  stream: MediaStream | null;
  isExternalStream?: boolean; // true wenn Stream von außen kommt (Tab Capture)
  commitTimer?: ReturnType<typeof setInterval> | null;
  hasAudioSinceCommit?: boolean;
};

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

export function useDualRealtime() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [stats, setStats] = useState({
    micFrames: 0,
    speakerFrames: 0,
    lastEventType: null as string | null,
  });

  // Separate Sessions für Mic und Speaker
  const micSession = useRef<AudioSession>({
    ws: null, audioCtx: null, source: null, worklet: null, stream: null,
  });
  const speakerSession = useRef<AudioSession>({
    ws: null, audioCtx: null, source: null, worklet: null, stream: null,
  });

  useEffect(() => () => stopAll(), []);

  // Delta zu einem Segment hinzufügen (mit Source-Tag)
  const addDelta = useCallback((itemId: string, delta: string, source: Source) => {
    setSegments((prev) => {
      // Suche Segment mit gleicher itemId UND source
      const idx = prev.findIndex((s) => s.itemId === itemId && s.source === source);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: updated[idx].text + delta };
        return updated;
      } else {
        return [...prev, { 
          itemId, 
          text: delta, 
          isFinal: false, 
          source,
          timestamp: Date.now(),
        }];
      }
    });
  }, []);

  // Segment finalisieren
  const finalize = useCallback((itemId: string, finalText: string, source: Source) => {
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.itemId === itemId && s.source === source);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text: finalText, isFinal: true };
        return updated;
      } else {
        return [...prev, { 
          itemId, 
          text: finalText, 
          isFinal: true, 
          source,
          timestamp: Date.now(),
        }];
      }
    });
  }, []);

  // Message Handler Factory - erstellt Handler mit Source-Tag
  const createMessageHandler = (source: Source) => (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data);
      console.log(`[WS ${source.toUpperCase()}]`, msg.type);
      setStats((s) => ({ ...s, lastEventType: msg.type }));

      if (
        msg.type === "conversation.item.input_audio_transcription.delta" &&
        msg.delta &&
        msg.item_id
      ) {
        addDelta(msg.item_id, msg.delta, source);
        return;
      }

      if (
        msg.type === "conversation.item.input_audio_transcription.completed" &&
        msg.transcript &&
        msg.item_id
      ) {
        finalize(msg.item_id, msg.transcript, source);
        return;
      }

      if (msg.type === "error") {
        console.error(`[WS ${source.toUpperCase()} ERROR]`, msg);
        setError(`${source}: ${msg.error?.message || JSON.stringify(msg)}`);
      }
    } catch (err) {
      console.warn("Parse error:", err);
    }
  };

  // WebSocket für eine Source erstellen
  const connectWs = (source: Source): WebSocket => {
    const transcriptionPrompt =
      "Auto-detect language. Produce verbatim transcripts (no summaries), keep names and numbers exactly as spoken.";
    const url = `ws://localhost:8080`;
    console.log(`[WS ${source.toUpperCase()}] Verbinde zu Proxy:`, url);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[WS ${source.toUpperCase()}] Connected`);
      
      // Unterschiedliche Konfiguration für Mic vs Speaker
      const sessionUpdate = {
        type: "transcription_session.update",
        session: {
          input_audio_transcription: {
            model: "gpt-4o-transcribe",
            prompt: transcriptionPrompt,
            // language weglassen -> automatische Spracherkennung durch Modell
          },
          turn_detection: source === "mic" 
            ? {
                // Mic: VAD aktiviert für natürliche Sprechpausen
                type: "server_vad",
                threshold: 0.3,
                prefix_padding_ms: 500,
                silence_duration_ms: 300,
              }
            : {
                // Speaker: VAD etwas weniger empfindlich, mehr Kontext
                type: "server_vad",
                threshold: 0.2,
                prefix_padding_ms: 800,
                silence_duration_ms: 1200,
              },
        },
      };
      ws.send(JSON.stringify(sessionUpdate));
    };

    ws.onmessage = createMessageHandler(source);
    ws.onerror = (e) => {
      console.error(`[WS ${source.toUpperCase()}] Error`, e);
      setError(`${source}: WebSocket Fehler`);
    };
    ws.onclose = () => {
      console.log(`[WS ${source.toUpperCase()}] Closed`);
    };

    return ws;
  };

  // Audio-Session für eine Quelle starten
  // Kann entweder deviceId ODER einen fertigen Stream (Tab Capture) nutzen
  const startAudioSession = async (
    deviceIdOrStream: string | MediaStream | undefined,
    source: Source,
    session: React.MutableRefObject<AudioSession>
  ) => {
    try {
      let stream: MediaStream;
      let isExternalStream = false;

      // Prüfe ob MediaStream oder deviceId übergeben wurde
      if (deviceIdOrStream instanceof MediaStream) {
        // Tab Capture: Stream kommt von außen
        stream = deviceIdOrStream;
        isExternalStream = true;
        console.log(`[${source.toUpperCase()}] Using external stream (Tab Capture)`);
      } else {
        // Device: getUserMedia mit deviceId
        const deviceId = deviceIdOrStream;
        const audioConstraints: MediaTrackConstraints = {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          // Sample Rate nur für Mic, Speaker nutzt native Rate
          ...(source === "mic" ? { sampleRate: 24000 } : {}),
        };
        
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
      }
      
      session.current.stream = stream;
      session.current.isExternalStream = isExternalStream;
      
      // AudioContext mit fixer 24 kHz, damit der Stream zur API passt
      // (Chrome resampelt eingehende 48 kHz Tab-Audio entsprechend runter)
      const ctx = new AudioContext({ sampleRate: 24000 });
      console.log(`[${source.toUpperCase()}] AudioContext sampleRate: ${ctx.sampleRate}`);
      session.current.audioCtx = ctx;

      await ctx.audioWorklet.addModule("/worklets/pcm16-processor.js?v=" + Date.now());
      
      const audioSource = ctx.createMediaStreamSource(stream);
      session.current.source = audioSource;

      const worklet = new AudioWorkletNode(ctx, "pcm16-processor");
      session.current.worklet = worklet;

      // Verstärkung VOR dem Worklet
      // Tab Capture braucht weniger Gain als VB-Cable, aber etwas mehr als Mic
      const inputGain = ctx.createGain();
      if (isExternalStream) {
        // Tab Capture: moderates Gain (Audio ist meist gut) -> 1x reicht, weniger Clipping
        inputGain.gain.value = 1;
      } else if (source === "speaker") {
        // VB-Cable: braucht VIEL mehr Gain
        inputGain.gain.value = 500;
      } else {
        // Mic: normales Gain
        inputGain.gain.value = 1;
      }
      
      // Output Gain auf 0 damit wir nichts hören (nur Processing)
      const outputGain = ctx.createGain();
      outputGain.gain.value = 0;
      
      // Kette: source -> inputGain -> worklet -> outputGain -> destination
      audioSource.connect(inputGain).connect(worklet).connect(outputGain).connect(ctx.destination);
      
      console.log(`[${source.toUpperCase()}] Input Gain: ${inputGain.gain.value}x, External: ${isExternalStream}`);

      // WebSocket verbinden
      const ws = connectWs(source);
      session.current.ws = ws;

      // Regelmäßige Commits schicken, damit der Server sehr kurze Abschnitte verarbeitet
      // und wir Zeile für Zeile Updates bekommen (auch wenn kein Silence erkannt wird).
      const commitIntervalMs = source === "speaker" ? 2000 : 1500;
      session.current.commitTimer = setInterval(() => {
        if (
          session.current.ws?.readyState === WebSocket.OPEN &&
          session.current.hasAudioSinceCommit
        ) {
          session.current.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          session.current.hasAudioSinceCommit = false;
        }
      }, commitIntervalMs);

      // Audio-Chunks senden mit Debug-Info
      let silentFrames = 0;
      let loudFrames = 0;
      
      worklet.port.onmessage = (event: MessageEvent) => {
        if (!session.current.ws || session.current.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const data = event.data;
        const floatData = data instanceof Float32Array ? data : new Float32Array(data);
        
        // RMS berechnen (Lautstärke-Indikator)
        let sum = 0;
        for (let i = 0; i < floatData.length; i++) {
          sum += floatData[i] * floatData[i];
        }
        const rms = Math.sqrt(sum / floatData.length);
        
        if (rms < 0.001) {
          silentFrames++;
        } else {
          loudFrames++;
          session.current.hasAudioSinceCommit = true;
        }
        
        // Alle 50 Frames loggen
        if ((silentFrames + loudFrames) % 50 === 0) {
          console.log(`[${source.toUpperCase()}] Frames: silent=${silentFrames}, loud=${loudFrames}, RMS=${rms.toFixed(4)}`);
        }
        
        const b64 = floatToInt16Base64(floatData);
        
        setStats((s) => ({
          ...s,
          [source === "mic" ? "micFrames" : "speakerFrames"]: 
            s[source === "mic" ? "micFrames" : "speakerFrames"] + 1,
        }));

        session.current.ws.send(
          JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }),
        );
      };

      return true;
    } catch (err) {
      console.error(`[${source.toUpperCase()}] Audio Error:`, err);
      return false;
    }
  };

  // Session stoppen
  const stopSession = (session: React.MutableRefObject<AudioSession>) => {
    if (session.current.ws?.readyState === WebSocket.OPEN && session.current.hasAudioSinceCommit) {
      // Letztes Commit senden, um offene Fragmente zu schließen
      session.current.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }

    if (session.current.commitTimer) {
      clearInterval(session.current.commitTimer);
      session.current.commitTimer = null;
    }

    session.current.ws?.close();
    session.current.ws = null;

    session.current.worklet?.disconnect();
    session.current.worklet = null;
    session.current.source?.disconnect();
    session.current.source = null;

    // Stream nur stoppen wenn es KEIN externer Stream ist (Tab Capture)
    // Externe Streams werden vom Aufrufer verwaltet
    if (session.current.stream && !session.current.isExternalStream) {
      session.current.stream.getTracks().forEach((t) => t.stop());
    }
    session.current.stream = null;
    session.current.isExternalStream = false;

    if (session.current.audioCtx) {
      session.current.audioCtx.close();
      session.current.audioCtx = null;
    }
  };

  // Beide Sessions starten
  // speakerSource kann deviceId (string) ODER MediaStream (Tab Capture) sein
  const start = async (
    apiKey: string,
    micDeviceId?: string,
    speakerSource?: string | MediaStream
  ) => {
    if (!apiKey) {
      setError("API-Key fehlt.");
      return;
    }
    if (status === "running" || status === "connecting") return;

    setError(null);
    setSegments([]);
    setStats({ micFrames: 0, speakerFrames: 0, lastEventType: null });
    setStatus("connecting");

    const results = await Promise.all([
      micDeviceId ? startAudioSession(micDeviceId, "mic", micSession) : Promise.resolve(false),
      speakerSource ? startAudioSession(speakerSource, "speaker", speakerSession) : Promise.resolve(false),
    ]);

    if (results.some((r) => r)) {
      setStatus("running");
    } else {
      setError("Keine Audio-Quelle konnte gestartet werden.");
      setStatus("error");
    }
  };

  // Alles stoppen
  const stopAll = () => {
    stopSession(micSession);
    stopSession(speakerSession);
    setStatus("idle");
  };

  return {
    status,
    error,
    segments,
    start,
    stop: stopAll,
    resetTranscript: () => setSegments([]),
    stats,
  };
}
