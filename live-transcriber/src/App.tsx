import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { DeviceSelector } from "./components/DeviceSelector";
import type { SpeakerSource } from "./components/DeviceSelector";
import { useDualRealtime } from "./hooks/useDualRealtime";
import { useTabCapture } from "./hooks/useTabCapture";

const apiKeyFromEnv = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) || "";

function statusLabel(status: string) {
  switch (status) {
    case "connecting":
      return "Connecting...";
    case "running":
      return "Live";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

export default function App() {
  const [micDeviceId, setMicDeviceId] = useState<string>();
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string>();
  const [speakerSource, setSpeakerSource] = useState<SpeakerSource>("none");
  const [autoScroll, setAutoScroll] = useState(true);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  
  // Tab Capture Hook
  const tabCapture = useTabCapture();
  
  const {
    status,
    error,
    segments,
    start,
    stop,
    resetTranscript,
    stats,
  } = useDualRealtime();

  const handleDeviceSelect = useCallback((micId?: string, speakerId?: string) => {
    setMicDeviceId(micId);
    setSpeakerDeviceId(speakerId);
  }, []);

  const handleSpeakerSourceChange = useCallback((source: SpeakerSource) => {
    setSpeakerSource(source);
    // Tab Capture stoppen wenn auf andere Quelle gewechselt wird
    if (source !== "tab" && tabCapture.state === "capturing") {
      tabCapture.stopCapture();
    }
  }, [tabCapture]);

  // Cleanup Tab Capture wenn Transcription gestoppt wird
  useEffect(() => {
    if (status === "idle" && tabCapture.state === "capturing") {
      tabCapture.stopCapture();
    }
  }, [status, tabCapture]);

  // Auto-Scroll nur wenn User nicht manuell hochgescrollt hat
  useEffect(() => {
    if (autoScroll && transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [segments, autoScroll]);

  // Scroll-Handler: Auto-Scroll deaktivieren wenn User hochscrollt
  const handleScroll = () => {
    if (transcriptBoxRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = transcriptBoxRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  // Start Handler - holt Tab Capture Stream wenn nötig
  const handleStart = async () => {
    let speakerInput: string | MediaStream | undefined;

    if (speakerSource === "tab") {
      // Tab Capture: Erst Stream holen, dann starten
      const stream = await tabCapture.startCapture();
      if (!stream) {
        // User hat abgebrochen oder Fehler
        return;
      }
      speakerInput = stream;
    } else if (speakerSource === "device" && speakerDeviceId) {
      // VB-Cable Fallback: Device ID nutzen
      speakerInput = speakerDeviceId;
    }

    start(apiKeyFromEnv, micDeviceId, speakerInput);
  };

  // Stop Handler - stoppt auch Tab Capture
  const handleStop = () => {
    stop();
    if (tabCapture.state === "capturing") {
      tabCapture.stopCapture();
    }
  };

  // Segmente nach Timestamp sortieren, dann final/live trennen
  const sortedSegments = useMemo(() => 
    [...segments].sort((a, b) => a.timestamp - b.timestamp),
    [segments]
  );
  const finalSegments = sortedSegments.filter((s) => s.isFinal);
  const liveSegments = sortedSegments.filter((s) => !s.isFinal);

  const mergedTranscript = useMemo(
    () => finalSegments.map((s) => `[${s.source.toUpperCase()}] ${s.text}`).join("\n"),
    [finalSegments],
  );

  // Can start wenn mindestens eine Quelle gewählt
  const hasSpeakerSource = speakerSource === "tab" || (speakerSource === "device" && speakerDeviceId);
  const canStart = (micDeviceId || hasSpeakerSource) && status !== "running" && status !== "connecting";

  return (
    <div className="layout">
      <header>
        <div>
          <p className="eyebrow">React/Vite x OpenAI Realtime</p>
          <h1>Live Transcription</h1>
          <p className="muted">
            Capture mic and tab audio, stream via WebSocket to the intent=transcription endpoint. No virtual cable needed.
          </p>
        </div>
        <div className={`status-pill status-${status}`}>
          <span className="dot" />
          {statusLabel(status)}
        </div>
      </header>

      <section className="panel">
        <div className="controls">
          <div className="hint">
            OpenAI API key is read from <code>.env.local</code>. No key input in the UI required.
          </div>

          <DeviceSelector 
            onSelect={handleDeviceSelect} 
            onSpeakerSourceChange={handleSpeakerSourceChange}
            tabCaptureActive={tabCapture.state === "capturing"}
            tabCaptureError={tabCapture.error}
          />

          <div className="buttons">
            <button
              onClick={handleStart}
              disabled={!apiKeyFromEnv || !canStart}
            >
              Start
            </button>
            <button onClick={handleStop}>Stop</button>
            <button onClick={() => resetTranscript()}>Clear</button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </section>

      <section className="panel transcript">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Transcript</p>
            <h2>Live text</h2>
          </div>
          <div className="muted" style={{ textAlign: "right", fontSize: 13 }}>
            MIC {stats.micFrames} | SPK {stats.speakerFrames} | {stats.lastEventType || "n/a"}
            {!autoScroll && <span style={{ color: "#fbbf24", marginLeft: 8 }}>New updates</span>}
          </div>
        </div>
        <div 
          className="transcript-box" 
          ref={transcriptBoxRef}
          onScroll={handleScroll}
        >
          {segments.length === 0 && (
            <p className="muted">No input yet. Pick at least one audio source and hit Start.</p>
          )}
          {/* Finalized segments with source label and speaker ID */}
          {finalSegments.map((s) => (
            <div key={s.itemId} className={`final-line source-${s.source} ${s.speakerId ? `speaker-${s.speakerId}` : ''}`}>
              <span className="source-tag">{s.source === "mic" ? "MIC" : "SPK"}</span>
              {s.speakerId && <span className="speaker-tag">[{s.speakerId}]</span>}
              {s.text}
            </div>
          ))}
          {/* Live segments (currently spoken words) - can be multiple */}
          {liveSegments.map((s) => (
            <div key={s.itemId} className={`live-line source-${s.source} ${s.speakerId ? `speaker-${s.speakerId}` : ''}`}>
              <span className="source-tag">{s.source === "mic" ? "MIC" : "SPK"}</span>
              {s.speakerId && <span className="speaker-tag">[{s.speakerId}]</span>}
              {s.text}
              <span className="cursor">|</span>
            </div>
          ))}
        </div>
        <details className="raw">
          <summary>Raw text (merged)</summary>
          <pre>{mergedTranscript}</pre>
        </details>
      </section>
    </div>
  );
}
