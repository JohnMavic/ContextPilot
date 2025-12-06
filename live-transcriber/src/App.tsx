import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { DeviceSelector } from "./components/DeviceSelector";
import { VolumeMeter } from "./components/VolumeMeter";
import { TypewriterText } from "./components/TypewriterText";
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
  const [speakerSource, setSpeakerSource] = useState<SpeakerSource>("tab");
  const [autoScroll, setAutoScroll] = useState(true);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  
  // Tab Capture Hook
  const tabCapture = useTabCapture();
  
  const {
    status,
    errorLog,
    segments,
    volumeLevels,
    start,
    stop,
    resetTranscript,
    clearErrors,
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

  // Segmente nach Timestamp sortieren (alle zusammen, nicht getrennt)
  const sortedSegments = useMemo(() => 
    [...segments].sort((a, b) => a.timestamp - b.timestamp),
    [segments]
  );

  // Gruppiere ALLE Segmente (final + live): Neue Gruppe bei Speaker-Wechsel ODER lange Pause
  const PAUSE_THRESHOLD_MS = 3500; // Etwas mehr als commit interval
  const groupedSegments = useMemo(() => {
    const groups: { source: string; texts: string[]; lastTimestamp: number; isSourceChange: boolean; hasLive: boolean }[] = [];
    
    for (const seg of sortedSegments) {
      const lastGroup = groups[groups.length - 1];
      const pauseSinceLast = lastGroup ? seg.timestamp - lastGroup.lastTimestamp : 0;
      const sourceChanged = !lastGroup || lastGroup.source !== seg.source;
      
      // Neue Gruppe wenn: anderer Speaker ODER Pause > threshold
      if (sourceChanged || pauseSinceLast > PAUSE_THRESHOLD_MS) {
        groups.push({
          source: seg.source,
          texts: [seg.text],
          lastTimestamp: seg.timestamp,
          isSourceChange: sourceChanged,
          hasLive: !seg.isFinal,
        });
      } else {
        // Zum bestehenden Gruppe hinzufügen (gleicher Speaker, keine lange Pause)
        lastGroup.texts.push(seg.text);
        lastGroup.lastTimestamp = seg.timestamp;
        if (!seg.isFinal) lastGroup.hasLive = true;
      }
    }
    
    return groups;
  }, [sortedSegments]);

  const mergedTranscript = useMemo(
    () => groupedSegments.map((g) => `[${g.source.toUpperCase()}] ${g.texts.join(" ")}`).join("\n\n"),
    [groupedSegments],
  );

  // Can start wenn mindestens eine Quelle gewählt
  const hasSpeakerSource = speakerSource === "tab" || (speakerSource === "device" && speakerDeviceId);
  const canStart = (micDeviceId || hasSpeakerSource) && status !== "running" && status !== "connecting";
  const liveClass = status === "running" ? "live-on" : status === "connecting" ? "live-off" : "live-off";

  return (
    <div className="layout">
      <header>
        <div>
          <p className="eyebrow">React/Vite x OpenAI Realtime</p>
          <h1 className="brand-title"><span className="brand-co">CON</span><span className="brand-text">TEXT</span><span className="brand-pilot">PILOT</span></h1>
        </div>
      </header>

      {/* Sidebar links */}
      <aside className="sidebar">
        <div className="panel sidebar-panel">
          <h3>Settings</h3>
          <div className="controls">
            <DeviceSelector 
              onSelect={handleDeviceSelect} 
              onSpeakerSourceChange={handleSpeakerSourceChange}
              tabCaptureActive={tabCapture.state === "capturing"}
              tabCaptureError={tabCapture.error}
            />

            <div className="buttons">
              <button
                className={status !== "running" && status !== "connecting" ? "btn-start" : ""}
                onClick={handleStart}
                disabled={!apiKeyFromEnv || !canStart}
              >
                Start
              </button>
              <button 
                className={status === "running" ? "btn-stop" : ""}
                onClick={handleStop}
              >
                Stop
              </button>
              <button 
                className={status !== "running" && status !== "connecting" ? "btn-clear" : ""}
                onClick={() => { resetTranscript(); clearErrors(); }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
        <div className="panel sidebar-panel">
          <h3>Audio Levels</h3>
          <div className="volume-meters">
            <VolumeMeter level={volumeLevels.mic} label="MIC" />
            <VolumeMeter level={volumeLevels.speaker} label="SPK" />
          </div>
        </div>
        <div className="panel sidebar-panel">
          <h3>Stats</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            MIC frames: {stats.micFrames}<br />
            SPK frames: {stats.speakerFrames}<br />
            Last event: {stats.lastEventType || "n/a"}
          </div>
        </div>
        <div className="panel sidebar-panel">
          <details className="error-log">
            <summary>
              <span>Error Log</span>
              {errorLog.length > 0 && <span className="error-count">{errorLog.length}</span>}
            </summary>
            <div className="error-log-content">
              {errorLog.length === 0 ? (
                <p className="muted">No errors</p>
              ) : (
                <>
                  <button className="clear-btn" onClick={clearErrors}>Clear</button>
                  {errorLog.slice().reverse().map((e, i) => (
                    <div key={i} className="error-entry">
                      <span className="error-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      <span className={`error-source source-${e.source}`}>{e.source.toUpperCase()}</span>
                      <span className="error-msg">{e.message}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </details>
        </div>
      </aside>

      {/* Main content - Transcript zentriert */}
      <div className="main-content">
        <section className="panel transcript">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Transcript</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Live text</h2>
                <span className={`live-pill ${liveClass}`}>
                  <span className="dot" />
                  {statusLabel(status)}
                </span>
              </div>
            </div>
            {!autoScroll && <span style={{ color: "#fbbf24", fontSize: 13 }}>↓ New updates below</span>}
          </div>
          <div 
            className="transcript-box" 
            ref={transcriptBoxRef}
            onScroll={handleScroll}
          >
            {segments.length === 0 && (
              <p className="muted">No input yet. Pick at least one audio source and hit Start.</p>
            )}
            {/* Gruppierte Segmente - Tag nur bei Speaker-Wechsel, Cursor bei Live-Content */}
            {groupedSegments.map((group, idx) => (
              <div key={idx} className={`final-line source-${group.source} ${group.isSourceChange ? 'has-tag' : 'no-tag'}`}>
                {group.isSourceChange && (
                  <span className="source-tag">{group.source === "mic" ? "MIC" : "SPK"}</span>
                )}
                <span className="segment-text">
                  <TypewriterText text={group.texts.join(" ")} wordsPerSecond={8} />
                  {group.hasLive && <span className="cursor">|</span>}
                </span>
              </div>
            ))}
          </div>
          <details className="raw">
            <summary>Raw text (merged)</summary>
            <pre>{mergedTranscript}</pre>
          </details>
        </section>
      </div>
    </div>
  );
}
