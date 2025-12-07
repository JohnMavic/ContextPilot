import { useEffect, useRef, useState, useCallback } from "react";

type Status = "idle" | "connecting" | "running" | "error";
type Source = "mic" | "speaker";

export type TranscriptSegment = {
  itemId: string;
  text: string;
  isFinal: boolean;
  source: Source;
  timestamp: number;
  speakerId?: string; // Speaker-ID von Diarization (z.B. "speaker_0", "speaker_1")
};

type AudioSession = {
  ws: WebSocket | null;
  audioCtx: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  stream: MediaStream | null;
  analyser?: AnalyserNode | null;
  isExternalStream?: boolean; // true wenn Stream von außen kommt (Tab Capture)
  commitTimer?: ReturnType<typeof setInterval> | null;
  volumeTimer?: ReturnType<typeof setInterval> | null;
  hasAudioSinceCommit?: boolean;
  framesSinceCommit?: number;
  bytesSinceCommit?: number;
  queue?: { data: Float32Array; durationMs: number }[];
  queueDurationMs?: number;
  sampleRate?: number;
  lastLoudAt?: number;
  durationSinceCommit?: number;
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

export type ErrorLogEntry = {
  timestamp: number;
  source: Source;
  message: string;
};

export function useDualRealtime() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [volumeLevels, setVolumeLevels] = useState({ mic: 0, speaker: 0 });
  const [micMuted, setMicMutedState] = useState(false); // Mic mute state
  const [stats, setStats] = useState({
    micFrames: 0,
    speakerFrames: 0,
    lastEventType: null as string | null,
  });

  // Helper: Fehler zum Log hinzufügen (max 50 Einträge behalten)
  const addError = useCallback((source: Source, message: string) => {
    setErrorLog((prev) => {
      const newEntry: ErrorLogEntry = { timestamp: Date.now(), source, message };
      const updated = [...prev, newEntry];
      return updated.slice(-50); // Max 50 Fehler behalten
    });
  }, []);

  // Separate Sessions für Mic und Speaker
  const micSession = useRef<AudioSession>({
    ws: null, audioCtx: null, source: null, worklet: null, stream: null,
  });
  const speakerSession = useRef<AudioSession>({
    ws: null, audioCtx: null, source: null, worklet: null, stream: null,
  });

  useEffect(() => () => stopAll(), []);

  // Delta zu einem Segment hinzufügen (mit Source-Tag und optionaler Speaker-ID)
  const addDelta = useCallback((itemId: string, delta: string, source: Source, speakerId?: string) => {
    setSegments((prev) => {
      // Suche Segment mit gleicher itemId UND source
      const idx = prev.findIndex((s) => s.itemId === itemId && s.source === source);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { 
          ...updated[idx], 
          text: updated[idx].text + delta,
          speakerId: speakerId || updated[idx].speakerId,
        };
        return updated;
      } else {
        return [...prev, { 
          itemId, 
          text: delta, 
          isFinal: false, 
          source,
          timestamp: Date.now(),
          speakerId,
        }];
      }
    });
  }, []);

  // Segment finalisieren
  const finalize = useCallback((itemId: string, finalText: string, source: Source, speakerId?: string) => {
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.itemId === itemId && s.source === source);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { 
          ...updated[idx], 
          text: finalText, 
          isFinal: true,
          speakerId: speakerId || updated[idx].speakerId,
        };
        return updated;
      } else {
        return [...prev, { 
          itemId, 
          text: finalText, 
          isFinal: true, 
          source,
          timestamp: Date.now(),
          speakerId,
        }];
      }
    });
  }, []);

  // Message Handler Factory - erstellt Handler mit Source-Tag
  const createMessageHandler = (source: Source) => (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data);
      console.log(`[WS ${source.toUpperCase()}]`, msg.type, msg.speaker_id ? `[${msg.speaker_id}]` : '');
      setStats((s) => ({ ...s, lastEventType: msg.type }));

      // Reset commit flags on speech boundaries to avoid empty commits
      if (msg.type === "input_audio_buffer.speech_started" || msg.type === "input_audio_buffer.speech_stopped") {
        const session = source === "mic" ? micSession : speakerSession;
        session.current.hasAudioSinceCommit = false;
        session.current.framesSinceCommit = 0;
        session.current.bytesSinceCommit = 0;
        session.current.durationSinceCommit = 0;
      }

      // Speaker-ID aus Diarization extrahieren (falls vorhanden)
      const speakerId = msg.speaker_id || msg.speaker || undefined;

      if (
        msg.type === "conversation.item.input_audio_transcription.delta" &&
        msg.delta &&
        msg.item_id
      ) {
        addDelta(msg.item_id, msg.delta, source, speakerId);
        return;
      }

      if (
        msg.type === "conversation.item.input_audio_transcription.completed" &&
        msg.transcript &&
        msg.item_id
      ) {
        finalize(msg.item_id, msg.transcript, source, speakerId);
        return;
      }

      if (msg.type === "error") {
        const code = msg.error?.code;
        const errMsg = msg.error?.message || code || JSON.stringify(msg.error);
        console.error(`[WS ${source.toUpperCase()} ERROR]`, msg.error);
        addError(source, errMsg);

        // Bei leeren Commits Zähler zurücksetzen, um erneute leere Commits zu vermeiden
        if (code === "input_audio_buffer_commit_empty") {
          const session = source === "mic" ? micSession : speakerSession;
          session.current.hasAudioSinceCommit = false;
          session.current.framesSinceCommit = 0;
          session.current.bytesSinceCommit = 0;
          session.current.durationSinceCommit = 0;
        }
      }
    } catch (err) {
      console.warn("Parse error:", err);
    }
  };

  // WebSocket für eine Source erstellen
  const connectWs = (source: Source): WebSocket => {
    const transcriptionPrompt =
      "Auto-detect language. Produce verbatim transcripts (no summaries), keep names and numbers exactly as spoken. Merge adjacent fragments into complete, coherent sentences when they clearly belong together; lightly fix punctuation and obvious word breaks; do not add, omit, or change facts.";
    const url = `ws://localhost:8080`;
    console.log(`[WS ${source.toUpperCase()}] Verbinde zu Proxy:`, url);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log(`[WS ${source.toUpperCase()}] Connected`);
      
      // Unterschiedliche Konfiguration für Mic vs Speaker
      // gpt-4o-transcribe für Standard-Transkription
      // gpt-4o-transcribe-diarize wäre für Speaker-Erkennung (noch nicht überall verfügbar)
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
                threshold: 0.28,
                prefix_padding_ms: 450,
                silence_duration_ms: 1000,
              }
            : {
                // Speaker: VAD etwas weniger empfindlich, mehr Kontext
                type: "server_vad",
                threshold: 0.29,
                prefix_padding_ms: 900,
                silence_duration_ms: 1550,
              },
        },
      };
      ws.send(JSON.stringify(sessionUpdate));
    };

    ws.onmessage = createMessageHandler(source);
    ws.onerror = (e) => {
      console.error(`[WS ${source.toUpperCase()}] Error`, e);
      setError(`${source}: WebSocket error`);
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
      session.current.hasAudioSinceCommit = false;
      session.current.framesSinceCommit = 0;
      session.current.lastLoudAt = undefined;
      session.current.queue = [];
      session.current.queueDurationMs = 0;
      session.current.bytesSinceCommit = 0;
      session.current.durationSinceCommit = 0;
      
      // AudioContext mit fixer 24 kHz, damit der Stream zur API passt
      // (Chrome resampelt eingehende 48 kHz Tab-Audio entsprechend runter)
      const ctx = new AudioContext({ sampleRate: 24000 });
      console.log(`[${source.toUpperCase()}] AudioContext sampleRate: ${ctx.sampleRate}`);
      session.current.audioCtx = ctx;
      session.current.sampleRate = ctx.sampleRate;

      const workletUrl = new URL(
        `${import.meta.env.BASE_URL || "/"}worklets/pcm16-processor.js?v=${Date.now()}`,
        window.location.origin,
      ).toString();
      await ctx.audioWorklet.addModule(workletUrl);
      
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
        // Mic: leicht erhöhtes Gain, um leises Signal anzuheben
        inputGain.gain.value = 2;
      }
      
      // AnalyserNode für Volume-Level-Anzeige
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      session.current.analyser = analyser;
      
      // Output Gain auf 0 damit wir nichts hören (nur Processing)
      const outputGain = ctx.createGain();
      outputGain.gain.value = 0;
      
      // Kette: source -> inputGain -> analyser -> worklet -> outputGain -> destination
      audioSource.connect(inputGain).connect(analyser);
      analyser.connect(worklet).connect(outputGain).connect(ctx.destination);
      
      // Volume-Level-Update-Timer (60fps)
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      session.current.volumeTimer = setInterval(() => {
        if (session.current.analyser) {
          session.current.analyser.getByteFrequencyData(dataArray);
          // Durchschnitt berechnen und auf 0-1 normalisieren
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length / 255;
          // Etwas verstärken für bessere visuelle Reaktion
          const level = Math.min(1, avg * 2.5);
          setVolumeLevels(prev => ({ ...prev, [source]: level }));
        }
      }, 1000 / 30); // 30fps für flüssige Animation
      
      console.log(`[${source.toUpperCase()}] Input Gain: ${inputGain.gain.value}x, External: ${isExternalStream}`);

      // WebSocket verbinden
      const ws = connectWs(source);
      session.current.ws = ws;

      // Regelmäßige Commits schicken, damit der Server sehr kurze Abschnitte verarbeitet
      // und wir Zeile für Zeile Updates bekommen (auch wenn kein Silence erkannt wird).
      const commitIntervalMs = source === "speaker" ? 2600 : 3500;
      const minFramesForCommit = source === "mic" ? 20 : 3;
      const minDurationMsForCommit = source === "mic" ? 400 : 250;
      session.current.commitTimer = setInterval(() => {
        if (
          session.current.ws?.readyState === WebSocket.OPEN &&
          session.current.hasAudioSinceCommit &&
          (session.current.framesSinceCommit || 0) >= minFramesForCommit &&
          (session.current.bytesSinceCommit || 0) > 0 &&
          (session.current.durationSinceCommit || 0) >= minDurationMsForCommit
        ) {
          session.current.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          session.current.hasAudioSinceCommit = false;
          session.current.framesSinceCommit = 0;
          session.current.bytesSinceCommit = 0;
          session.current.durationSinceCommit = 0;
        }
      }, commitIntervalMs);

      // Audio-Chunks senden mit Debug-Info
      let silentFrames = 0;
      let loudFrames = 0;
      const prebufferMs = 250;
      
      worklet.port.onmessage = (event: MessageEvent) => {
        if (!session.current.ws || session.current.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const data = event.data;
        const floatData = data instanceof Float32Array ? data : new Float32Array(data);
        const sr = session.current.sampleRate || session.current.audioCtx?.sampleRate || 24000;
        const chunkDurationMs = (floatData.length / sr) * 1000;
        
        // RMS berechnen (Lautstärke-Indikator)
        let sum = 0;
        for (let i = 0; i < floatData.length; i++) {
          sum += floatData[i] * floatData[i];
        }
        const rms = Math.sqrt(sum / floatData.length);
        
        const loudThreshold = 0.0001;
        if (rms < loudThreshold) {
          silentFrames++;
        } else {
          loudFrames++;
          session.current.hasAudioSinceCommit = true;
          session.current.lastLoudAt = Date.now();
        }
        
        // Alle 50 Frames loggen
        if ((silentFrames + loudFrames) % 50 === 0) {
          console.log(`[${source.toUpperCase()}] Frames: silent=${silentFrames}, loud=${loudFrames}, RMS=${rms.toFixed(4)}`);
        }

        // Prebuffer queue: keep ~250ms, send oldest when above target
        session.current.queue = session.current.queue || [];
        session.current.queueDurationMs = session.current.queueDurationMs || 0;
        session.current.queue.push({ data: floatData, durationMs: chunkDurationMs });
        session.current.queueDurationMs += chunkDurationMs;

        while (session.current.queueDurationMs > prebufferMs && session.current.queue.length > 0) {
        const chunk = session.current.queue.shift()!;
        session.current.queueDurationMs -= chunk.durationMs;

        const b64 = floatToInt16Base64(chunk.data);
        setStats((s) => ({
            ...s,
            [source === "mic" ? "micFrames" : "speakerFrames"]: 
              s[source === "mic" ? "micFrames" : "speakerFrames"] + 1,
          }));
        session.current.framesSinceCommit = (session.current.framesSinceCommit || 0) + 1;
        session.current.bytesSinceCommit = (session.current.bytesSinceCommit || 0) + chunk.data.byteLength;
        session.current.durationSinceCommit = (session.current.durationSinceCommit || 0) + chunk.durationMs;

        session.current.ws.send(
          JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }),
        );
      }
      };

      return true;
    } catch (err) {
      console.error(`[${source.toUpperCase()}] Audio Error:`, err);
      setError(`${source}: Audio/worklet error ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  // Session stoppen
  const stopSession = (session: React.MutableRefObject<AudioSession>) => {
    if (
      session.current.ws?.readyState === WebSocket.OPEN &&
      session.current.hasAudioSinceCommit &&
      (session.current.framesSinceCommit || 0) > 0 &&
      (session.current.bytesSinceCommit || 0) > 0 &&
      (session.current.durationSinceCommit || 0) > 0
    ) {
      // Letztes Commit senden, um offene Fragmente zu schließen
      session.current.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }

    if (session.current.commitTimer) {
      clearInterval(session.current.commitTimer);
      session.current.commitTimer = null;
    }
    
    if (session.current.volumeTimer) {
      clearInterval(session.current.volumeTimer);
      session.current.volumeTimer = null;
    }

    session.current.ws?.close();
    session.current.ws = null;

    session.current.worklet?.disconnect();
    session.current.worklet = null;
    session.current.analyser?.disconnect();
    session.current.analyser = null;
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

    session.current.queue = [];
    session.current.queueDurationMs = 0;
    session.current.bytesSinceCommit = 0;
  };

  // Beide Sessions starten
  // speakerSource kann deviceId (string) ODER MediaStream (Tab Capture) sein
  const start = async (
    apiKey: string,
    micDeviceId?: string,
    speakerSource?: string | MediaStream
  ) => {
    if (!apiKey) {
      setError("API key missing.");
      return;
    }
    if (status === "running" || status === "connecting") return;

    setError(null);
    setErrorLog([]);
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
      setError("Could not start any audio source.");
      setStatus("error");
    }
  };

  // Alles stoppen
  const stopAll = () => {
    stopSession(micSession);
    stopSession(speakerSession);
    setVolumeLevels({ mic: 0, speaker: 0 });
    setMicMutedState(false); // Reset mute state on stop
    setStatus("idle");
  };

  // Mic muten/unmuten (enabled/disabled auf dem Track)
  const setMicMuted = useCallback((muted: boolean) => {
    const session = micSession.current;
    if (session.stream) {
      session.stream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
        console.log(`[MIC] Track ${track.label} ${muted ? 'muted' : 'unmuted'}`);
      });
    }
    setMicMutedState(muted);
  }, []);

  // Text aus Segmenten löschen - robuste Version mit mehreren Matching-Strategien
  const deleteTextFromTranscript = useCallback((textToDelete: string) => {
    if (!textToDelete.trim()) return;
    
    const trimmedDelete = textToDelete.trim();
    const normalizedDelete = trimmedDelete.toLowerCase();
    const deleteWords = normalizedDelete.split(/\s+/).filter(w => w.length > 1);
    
    console.log("[Transcript] Attempting to delete:", trimmedDelete.slice(0, 80));
    
    setSegments(prev => {
      let deleted = false;

      // Strategie 0: Exakter Match über segment-übergreifenden Text (kontinuierlich)
      {
        const spans: { start: number; end: number }[] = [];
        let merged = "";
        let pos = 0;
        prev.forEach((segment, idx) => {
          const start = pos;
          merged += segment.text;
          pos += segment.text.length;
          spans.push({ start, end: pos });
          if (idx !== prev.length - 1) {
            merged += " ";
            pos += 1; // Space-Trenner
          }
        });

        const mergedLower = merged.toLowerCase();
        const startIdx = mergedLower.indexOf(normalizedDelete);
        if (startIdx !== -1) {
          const endIdx = startIdx + normalizedDelete.length;
          const newSegments = prev.map((segment, i) => {
            const span = spans[i];
            const overlapStart = Math.max(span.start, startIdx);
            const overlapEnd = Math.min(span.end, endIdx);
            if (overlapStart < overlapEnd) {
              const localStart = overlapStart - span.start;
              const localEnd = overlapEnd - span.start;
              const newTextRaw = segment.text.slice(0, localStart) + segment.text.slice(localEnd);
              const newText = newTextRaw.replace(/\s+/g, " ");
              deleted = true;
              return { ...segment, text: newText };
            }
            return segment;
          });

          if (deleted) {
            console.log("[Transcript] Strategy 0 (cross-segment exact): Found and deleted");
            return newSegments;
          }
        }
      }
      
      // Strategie 1: Exaktes Matching (case-insensitive)
      let newSegments = prev.map(segment => {
        const normalizedSegment = segment.text.toLowerCase();
        
        if (normalizedSegment.includes(normalizedDelete)) {
          const startIdx = normalizedSegment.indexOf(normalizedDelete);
          if (startIdx !== -1) {
            const beforeText = segment.text.slice(0, startIdx);
            const afterText = segment.text.slice(startIdx + trimmedDelete.length);
            const newText = (beforeText + afterText).trim();
            deleted = true;
            console.log("[Transcript] Strategy 1 (exact match): Found and deleted");
            return { ...segment, text: newText };
          }
        }
        return segment;
      }).filter(segment => segment.text.length > 0);
      
      if (deleted) return newSegments;
      
      // Strategie 2: Substring-Matching (mindestens 80% des Texts)
      const minMatchLength = Math.floor(trimmedDelete.length * 0.8);
      newSegments = prev.map(segment => {
        const normalizedSegment = segment.text.toLowerCase();
        
        // Suche nach dem längsten übereinstimmenden Substring
        for (let len = trimmedDelete.length; len >= minMatchLength; len--) {
          for (let start = 0; start <= trimmedDelete.length - len; start++) {
            const subDelete = normalizedDelete.slice(start, start + len);
            if (normalizedSegment.includes(subDelete)) {
              const startIdx = normalizedSegment.indexOf(subDelete);
              const beforeText = segment.text.slice(0, startIdx);
              const afterText = segment.text.slice(startIdx + len);
              const newText = (beforeText + afterText).trim();
              deleted = true;
              console.log("[Transcript] Strategy 2 (substring match): Found and deleted", len, "chars");
              return { ...segment, text: newText };
            }
          }
        }
        return segment;
      }).filter(segment => segment.text.length > 0);
      
      if (deleted) return newSegments;
      
      // Strategie 3: Wort-basiertes Matching (mindestens 60% der Wörter)
      if (deleteWords.length >= 2) {
        const threshold = Math.ceil(deleteWords.length * 0.6);
        newSegments = prev.map(segment => {
          const segmentLower = segment.text.toLowerCase();
          const segmentWords = segmentLower.split(/\s+/);
          const matchingWords = deleteWords.filter(w => segmentWords.some(sw => sw.includes(w) || w.includes(sw)));
          
          if (matchingWords.length >= threshold) {
            // Segment enthält genug übereinstimmende Wörter
            // Wenn Segment ähnlich lang ist wie der zu löschende Text -> komplett entfernen
            if (segment.text.trim().length <= trimmedDelete.length * 1.5) {
              deleted = true;
              console.log("[Transcript] Strategy 3 (word match): Removing entire segment");
              return { ...segment, text: '' };
            }
            // Sonst: Versuche die übereinstimmenden Wörter zu entfernen
            let newText = segment.text;
            for (const word of deleteWords) {
              const regex = new RegExp(`\\b${word}\\b`, 'gi');
              newText = newText.replace(regex, '').trim();
            }
            if (newText !== segment.text) {
              deleted = true;
              console.log("[Transcript] Strategy 3 (word match): Removed matching words");
              return { ...segment, text: newText.replace(/\s+/g, ' ').trim() };
            }
          }
          return segment;
        }).filter(segment => segment.text.length > 0);
      }
      
      if (!deleted) {
        console.warn("[Transcript] Could not find text to delete with any strategy");
      }
      
      return newSegments;
    });
  }, []);

  return {
    status,
    error,
    errorLog,
    segments,
    volumeLevels,
    micMuted,
    setMicMuted,
    start,
    stop: stopAll,
    resetTranscript: () => setSegments([]),
    deleteTextFromTranscript,
    clearErrors: () => setErrorLog([]),
    stats,
  };
}
