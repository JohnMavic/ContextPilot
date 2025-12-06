import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { DeviceSelector } from "./components/DeviceSelector";
import { VolumeMeter } from "./components/VolumeMeter";
import { HighlightedText } from "./components/HighlightedText";
import { HighlightMenu } from "./components/HighlightMenu";
import { AuraResponsePanel } from "./components/AuraResponsePanel";
import type { SpeakerSource } from "./components/DeviceSelector";
import { useDualRealtime } from "./hooks/useDualRealtime";
import { useTabCapture } from "./hooks/useTabCapture";
import { useAuraAgent } from "./hooks/useAuraAgent";
import { useHighlights, type HighlightColor } from "./hooks/useHighlights";

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
  const [agentPanelWidth, setAgentPanelWidth] = useState(400); // Default doppelte Breite
  const [isResizing, setIsResizing] = useState(false);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  const transcriptAreaRef = useRef<HTMLDivElement>(null);
  
  // Tab Capture Hook
  const tabCapture = useTabCapture();
  
  // Highlight System
  const {
    highlights,
    menuState,
    showMenuAtSelection,
    hideMenu,
    createHighlight,
    removeHighlight,
    clearHighlights,
  } = useHighlights();
  
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
  const {
    responses: auraResponses,
    queryAgent,
    removeResponse: removeAuraResponse,
    clearAllResponses: clearAuraResponses,
  } = useAuraAgent();

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

  // Resizer für Agent Panel - Mouse Events
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!transcriptAreaRef.current) return;
      
      const containerRect = transcriptAreaRef.current.getBoundingClientRect();
      const containerRight = containerRect.right;
      const newWidth = containerRight - e.clientX;
      
      // Min/Max Grenzen
      const minWidth = 200;
      const maxWidth = containerRect.width * 0.6; // Max 60% der Gesamtbreite
      
      setAgentPanelWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Scroll-Handler: Auto-Scroll deaktivieren wenn User hochscrollt
  const handleScroll = () => {
    if (transcriptBoxRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = transcriptBoxRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  // Context menu on right-click or text selection
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim() && transcriptBoxRef.current) {
      e.preventDefault();
      showMenuAtSelection(transcriptBoxRef.current);
    }
  }, [showMenuAtSelection]);

  // Also show menu on mouseup if text selected
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim() && transcriptBoxRef.current) {
      // Small delay to ensure selection is complete
      setTimeout(() => {
        showMenuAtSelection(transcriptBoxRef.current!);
      }, 10);
    }
  }, [showMenuAtSelection]);

  // Ref für letztes erstelltes Highlight (für Agent-Queries)
  const lastHighlightRef = useRef<{ id: string; text: string; color: HighlightColor; anchorTop: number } | null>(null);

  // Highlight erstellen und Info speichern
  const handleCreateHighlight = useCallback((color?: HighlightColor) => {
    const highlight = createHighlight(color);
    if (highlight) {
      lastHighlightRef.current = {
        id: highlight.id,
        text: highlight.text,
        color: highlight.color,
        anchorTop: menuState.y,
      };
    }
    return highlight;
  }, [createHighlight, menuState.y]);

  // Kombinierter Handler: Highlight erstellen UND Expand-Query starten
  const handleHighlightAndExpand = useCallback(() => {
    const highlight = createHighlight();
    if (!highlight) return;
    
    const prompt = `Context: "${highlight.text}"

Give me 3-5 bullet points with key facts I can use in conversation. Short, precise, no fluff.`;
    
    queryAgent(prompt, highlight.id, highlight.text, highlight.color, menuState.y, "expand");
  }, [createHighlight, queryAgent, menuState.y]);

  // Kombinierter Handler: Highlight erstellen UND Facts-Query starten
  const handleHighlightAndFacts = useCallback(() => {
    const highlight = createHighlight();
    if (!highlight) return;
    
    const prompt = `Context: "${highlight.text}"

Find 2-3 similar examples or related cases from your index. One line each, max.`;
    
    queryAgent(prompt, highlight.id, highlight.text, highlight.color, menuState.y, "facts");
  }, [createHighlight, queryAgent, menuState.y]);

  // Handler für das Löschen einer Agent-Antwort - entfernt auch das zugehörige Highlight
  const handleRemoveAuraResponse = useCallback((responseId: string) => {
    // Finde die Antwort um die highlightId zu bekommen
    const response = auraResponses.find(r => r.id === responseId);
    if (response) {
      // Entferne das zugehörige Highlight
      removeHighlight(response.highlightId);
    }
    // Entferne die Antwort
    removeAuraResponse(responseId);
  }, [auraResponses, removeHighlight, removeAuraResponse]);

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
  const PAUSE_THRESHOLD_MS = 3500;
  
  // Berechne gruppierte Segmente MIT eindeutiger ID für Highlight-Mapping
  const groupedSegmentsWithOffsets = useMemo(() => {
    const groups: { 
      id: string;  // Eindeutige Gruppen-ID für Highlighting
      source: string; 
      texts: string[]; 
      lastTimestamp: number; 
      isSourceChange: boolean; 
      hasLive: boolean;
    }[] = [];
    
    let groupIndex = 0;
    
    for (const seg of sortedSegments) {
      const lastGroup = groups[groups.length - 1];
      const pauseSinceLast = lastGroup ? seg.timestamp - lastGroup.lastTimestamp : 0;
      const sourceChanged = !lastGroup || lastGroup.source !== seg.source;
      
      if (sourceChanged || pauseSinceLast > PAUSE_THRESHOLD_MS) {
        // Neue Gruppe starten mit eindeutiger ID
        groups.push({
          id: `group-${groupIndex++}`,
          source: seg.source,
          texts: [seg.text],
          lastTimestamp: seg.timestamp,
          isSourceChange: sourceChanged,
          hasLive: !seg.isFinal,
        });
      } else {
        // Zu bestehender Gruppe hinzufügen
        lastGroup.texts.push(seg.text);
        lastGroup.lastTimestamp = seg.timestamp;
        if (!seg.isFinal) lastGroup.hasLive = true;
      }
    }
    
    return groups;
  }, [sortedSegments]);

  const mergedTranscript = useMemo(
    () => groupedSegmentsWithOffsets.map((g) => `[${g.source.toUpperCase()}] ${g.texts.join(" ")}`).join("\n\n"),
    [groupedSegmentsWithOffsets],
  );

  // Can start wenn mindestens eine Quelle gewählt
  const hasSpeakerSource = speakerSource === "tab" || (speakerSource === "device" && speakerDeviceId);
  const canStart = (micDeviceId || hasSpeakerSource) && status !== "running" && status !== "connecting";
  const liveClass = status === "running" ? "live-on" : status === "connecting" ? "live-off" : "live-off";
  
  // Check if any AURA response is loading
  const anyAuraLoading = auraResponses.some(r => r.loading);
  
  const handleAskAuraFullTranscript = useCallback(() => {
    if (segments.length === 0) return;
    const prompt = `Provide key facts and highlights based on this transcript:\n${mergedTranscript}`;
    // Für Full-Transcript: Generiere temporäre ID
    const tempId = `full-${Date.now()}`;
    queryAgent(prompt, tempId, "Full Transcript Analysis", 1, 0, "full");
  }, [segments.length, mergedTranscript, queryAgent]);

  // Clear highlights when clearing transcript
  const handleClear = useCallback(() => {
    resetTranscript();
    clearErrors();
    clearHighlights();
    clearAuraResponses();
  }, [resetTranscript, clearErrors, clearHighlights, clearAuraResponses]);

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
                onClick={handleClear}
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
          <div className="transcript-area" ref={transcriptAreaRef}>
            <div 
              className="transcript-box" 
              ref={transcriptBoxRef}
              onScroll={handleScroll}
              onMouseUp={handleMouseUp}
              onContextMenu={handleContextMenu}
              style={{ position: "relative" }}
            >
              {segments.length === 0 && (
                <p className="muted">No input yet. Pick at least one audio source and hit Start.</p>
              )}
              {/* Gruppierte Segmente - Tag nur bei Speaker-Wechsel, Cursor bei Live-Content */}
              {groupedSegmentsWithOffsets.map((group) => {
                const groupText = group.texts.join(" ");
                
                return (
                  <div key={group.id} className={`final-line source-${group.source} ${group.isSourceChange ? 'has-tag' : 'no-tag'}`}>
                    {group.isSourceChange && (
                      <span className="source-tag">{group.source === "mic" ? "MIC" : "SPK"}</span>
                    )}
                    <span className="segment-text">
                      {/* 
                        IMMER HighlightedText verwenden - KEIN TypewriterText mehr!
                        TypewriterText verfälscht textContent und macht Offset-Berechnung unmöglich.
                        
                        data-group-id NUR auf diesem span mit dem reinen Text.
                        Cursor ist AUSSERHALB dieses spans.
                      */}
                      <span data-group-id={group.id}>
                        <HighlightedText text={groupText} highlights={highlights} groupId={group.id} />
                      </span>
                      {group.hasLive && <span className="cursor">|</span>}
                    </span>
                  </div>
                );
              })}
              
              {/* Highlight Context Menu - positioned within transcript box */}
              <HighlightMenu
                visible={menuState.visible}
                x={menuState.x}
                y={menuState.y}
                selectedText={menuState.selectedText}
                onClose={hideMenu}
                onHighlight={handleCreateHighlight}
                onHighlightAndExpand={handleHighlightAndExpand}
                onHighlightAndFacts={handleHighlightAndFacts}
                isLoading={anyAuraLoading}
              />
            </div>
            
            {/* AURA Response Panels - rechts im Panel, mit Resizer */}
            {auraResponses.length > 0 && (
              <>
                {/* Resizer Handle */}
                <div 
                  className="panel-resizer"
                  onMouseDown={handleResizerMouseDown}
                />
                <div 
                  className="aura-responses-container"
                  style={{ width: agentPanelWidth }}
                >
                  {auraResponses.map((response) => (
                    <AuraResponsePanel
                      key={response.id}
                      id={response.id}
                      sourceText={response.sourceText}
                      color={response.color}
                      result={response.result}
                      loading={response.loading}
                      error={response.error}
                      onClose={handleRemoveAuraResponse}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          
          {/* Highlights summary */}
          {highlights.length > 0 && (
            <div className="highlights-summary" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
              <span className="muted">{highlights.length} highlight{highlights.length !== 1 ? 's' : ''}</span>
              <button className="btn-ghost" onClick={clearHighlights} style={{ padding: "4px 8px", fontSize: 12 }}>
                Clear all
              </button>
            </div>
          )}
          
          <details className="raw">
            <summary>Raw text (merged)</summary>
            <pre>{mergedTranscript}</pre>
          </details>

          <div className="selection-actions">
            <p className="muted" style={{ margin: 0 }}>
              Select text in the transcript and use the context menu to highlight or ask AURA for insights.
            </p>
            <button
              className="btn-ghost"
              onClick={handleAskAuraFullTranscript}
              disabled={segments.length === 0 || anyAuraLoading}
              style={{ marginTop: 8 }}
            >
              {anyAuraLoading ? "Asking AURA..." : "Ask AURA: Analyze full transcript"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
