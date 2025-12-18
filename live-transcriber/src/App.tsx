import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { DeviceSelector } from "./components/DeviceSelector";
import { VolumeMeter } from "./components/VolumeMeter";
import { HighlightedText } from "./components/HighlightedText";
import { HighlightMenu } from "./components/HighlightMenu";
import { AuraResponsePanel } from "./components/AuraResponsePanel";
import { InlineAgentResponse } from "./components/InlineAgentResponse";
import type { SpeakerSource } from "./components/DeviceSelector";
import { useDualRealtime, type TranscriptionProvider } from "./hooks/useDualRealtime";
import { useTabCapture } from "./hooks/useTabCapture";
import { useAuraAgent } from "./hooks/useAuraAgent";
import { useHighlights, type HighlightColor } from "./hooks/useHighlights";

const apiKeyFromEnv = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) || "";

// Agent/Workflow type from proxy server
interface AgentInfo {
  id: number;
  name: string;
  label: string;
  type: "agent" | "workflow";
  active: boolean;
}

// Transcription Model configuration
interface TranscriptionModel {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
}

// Available transcription models - OpenAI is DEFAULT and must always work
// NOTE: gpt-4o-transcribe-diarize does NOT work over WebSocket Realtime API!
// Diarization is only available via REST API, not real-time streaming.
const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
  { 
    id: "openai", 
    name: "gpt-4o-transcribe", 
    provider: "openai", 
    providerLabel: "OpenAI" 
  },
  { 
    id: "azure", 
    name: "gpt-4o-transcribe", 
    provider: "azure", 
    providerLabel: "Azure OpenAI" 
  },
];

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
  const [transcriptScrollTop, setTranscriptScrollTop] = useState(0);
  const [transcriptScrollHeight, setTranscriptScrollHeight] = useState(0);
  const [auraPanelHeights, setAuraPanelHeights] = useState<Record<string, number>>({});
  const [dynamicAnchorTops, setDynamicAnchorTops] = useState<Record<string, number>>({});
  const [agentPanelWidth, setAgentPanelWidth] = useState(400); // Default doppelte Breite
  const [isResizing, setIsResizing] = useState(false);
  const [highlightMenuContainer, setHighlightMenuContainer] = useState<HTMLElement | null>(null);
  const [disableDeleteInMenu, setDisableDeleteInMenu] = useState(false);
  
  // TEXT FREEZE: Wenn User klickt/selektiert, wird neuer Text gepuffert statt angezeigt
  const [isTextFrozen, setIsTextFrozen] = useState(false);
  const frozenSegmentsRef = useRef<typeof segments | null>(null);
  const frozenHtmlRef = useRef<string | null>(null); // HTML-Snapshot im Freeze-Modus (für Edit-Speicherung)
  const frozenHtmlSetRef = useRef(false); // Flag für Edit-Tracking
  
  // Agent selection state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workflows, setWorkflows] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<number | null>(null);
  const [agentSwitching, setAgentSwitching] = useState(false);
  
  // Transcription Model selection - DEFAULT is OpenAI (id: "openai")
  const [transcriptionModelId, setTranscriptionModelId] = useState<string>("openai");
  
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  const transcriptAreaRef = useRef<HTMLDivElement>(null);
  const auraResponsesContainerRef = useRef<HTMLDivElement>(null);
  
  // Load available agents and workflows from proxy server
  useEffect(() => {
    fetch("http://localhost:8080/agents")
      .then(res => res.json())
      .then(data => {
        if (data.agents) {
          // Add type to agents for UI display
          setAgents(data.agents.map((a: AgentInfo) => ({ ...a, type: "agent" as const })));
        }
        if (data.workflows) {
          // Add type to workflows for UI display
          setWorkflows(data.workflows.map((w: AgentInfo) => ({ ...w, type: "workflow" as const })));
        }
        if (data.currentAgentId !== undefined) {
          setCurrentAgentId(data.currentAgentId);
        }
      })
      .catch(err => console.error("Failed to load agents:", err));
  }, []);
  
  // Switch agent/workflow handler
  const handleAgentSwitch = useCallback(async (agentId: number) => {
    if (agentId === currentAgentId || agentSwitching) return;
    
    setAgentSwitching(true);
    try {
      const res = await fetch("http://localhost:8080/agents/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentAgentId(agentId);
        // Update active state in both lists
        setAgents(prev => prev.map(a => ({ ...a, active: a.id === agentId })));
        setWorkflows(prev => prev.map(w => ({ ...w, active: w.id === agentId })));
      }
    } catch (err) {
      console.error("Failed to switch agent:", err);
    } finally {
      setAgentSwitching(false);
    }
  }, [currentAgentId, agentSwitching]);
  
  // Tab Capture Hook
  const tabCapture = useTabCapture();
  
  // Highlight System
  const {
    highlights,
    menuState,
    showMenuAtSelection,
    hideMenu,
    createHighlight,
    createHighlightFromSelection,
    removeHighlight,
    clearHighlights,
  } = useHighlights();
  
  // Get the provider from the selected transcription model
  const transcriptionProvider = useMemo((): TranscriptionProvider => {
    const model = TRANSCRIPTION_MODELS.find(m => m.id === transcriptionModelId);
    return (model?.provider as TranscriptionProvider) || "openai";
  }, [transcriptionModelId]);
  
  const {
    status,
    errorLog,
    segments,
    volumeLevels,
    micMuted,
    setMicMuted,
    start,
    stop,
    resetTranscript,
    deleteTextFromTranscript,
    updateSegmentsFromEdit,
    clearErrors,
    stats,
  } = useDualRealtime(transcriptionProvider);
  const {
    responses: auraResponses,
    queryAgent,
    askFollowUp,
    removeResponse: removeAuraResponse,
    removeResponseByHighlight,
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
      setTranscriptScrollTop(scrollTop);
      setTranscriptScrollHeight(scrollHeight);
    }
  };

  // TEXT FREEZE: Bei MouseDown einfrieren, damit Selektion nicht durch neuen Text gestört wird
  const handleMouseDown = useCallback(() => {
    if (!isTextFrozen && segments.length > 0) {
      // HTML-Snapshot speichern BEVOR React etwas ändert
      if (transcriptBoxRef.current) {
        frozenHtmlRef.current = transcriptBoxRef.current.innerHTML;
      }
      frozenSegmentsRef.current = [...segments];
      setIsTextFrozen(true);
    }
  }, [isTextFrozen, segments]);

  // TEXT UNFREEZE MIT EDIT-SPEICHERUNG: Für User-Edits (Klick außerhalb, Enter, Escape)
  const unfreezeTextWithSave = useCallback(() => {
    if (isTextFrozen && transcriptBoxRef.current) {
      // Editierten Text aus dem DOM auslesen und in Segments speichern
      const editedGroups = new Map<string, string>();
      const groupElements = transcriptBoxRef.current.querySelectorAll('[data-group-id]');
      
      groupElements.forEach((el) => {
        const groupId = el.getAttribute('data-group-id');
        if (groupId) {
          // Nur den reinen Text (ohne Mark-Tags etc.)
          const text = el.textContent || '';
          editedGroups.set(groupId, text);
        }
      });
      
      // Segments mit editiertem Text aktualisieren
      if (editedGroups.size > 0) {
        updateSegmentsFromEdit(editedGroups);
      }
      
      frozenHtmlRef.current = null;
      frozenSegmentsRef.current = null;
      frozenHtmlSetRef.current = false; // Reset für nächsten Freeze
      setIsTextFrozen(false);
    }
  }, [isTextFrozen, updateSegmentsFromEdit]);

  // TEXT UNFREEZE OHNE EDIT-SPEICHERUNG: Für programmatische Aktionen (Delete, Copy, Agent-Query)
  // Diese Funktion überschreibt NICHT die segments - wichtig wenn deleteTextFromTranscript bereits aufgerufen wurde
  const unfreezeText = useCallback(() => {
    if (isTextFrozen) {
      frozenHtmlRef.current = null;
      frozenSegmentsRef.current = null;
      frozenHtmlSetRef.current = false; // Reset für nächsten Freeze
      setIsTextFrozen(false);
    }
  }, [isTextFrozen]);

  // Globaler Click-Handler: Klick außerhalb des Textfeldes beendet Freeze-Modus
  useEffect(() => {
    if (!isTextFrozen) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const transcriptBox = transcriptBoxRef.current;
      
      // Prüfe ob Klick AUSSERHALB des Textfeldes war
      if (transcriptBox && !transcriptBox.contains(target)) {
        // Auch nicht im Highlight-Menü
        const highlightMenu = document.querySelector('.highlight-action-bar');
        if (!highlightMenu || !highlightMenu.contains(target)) {
          unfreezeTextWithSave(); // User-Edit speichern
        }
      }
    };

    // Mit kleiner Verzögerung registrieren, damit der initiale Klick nicht sofort unfreezt
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleGlobalClick);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [isTextFrozen, unfreezeTextWithSave]);

  // Keyboard-Handler für Freeze-Modus: Escape oder Enter beendet Edit-Modus
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isTextFrozen) return;
    
    // Escape: Edit abbrechen, Freeze beenden (OHNE Speichern - Änderungen verwerfen)
    if (e.key === 'Escape') {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      unfreezeText(); // Ohne Speichern - verwirft Änderungen
    }
    
    // Enter: Edit bestätigen, Freeze beenden (MIT Speichern)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      unfreezeTextWithSave(); // Mit Speichern - behält Änderungen
    }
  }, [isTextFrozen, unfreezeText, unfreezeTextWithSave]);

  // Context menu on right-click or text selection
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim() && transcriptBoxRef.current) {
      e.preventDefault();
      setHighlightMenuContainer(transcriptBoxRef.current);
      setDisableDeleteInMenu(false);
      showMenuAtSelection(transcriptBoxRef.current);
    }
  }, [showMenuAtSelection]);

  // Also show menu on mouseup if text selected
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // WICHTIG: Wenn auf einen Link geklickt wurde, nicht interferieren
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      return; // Link-Klick nicht blockieren - Freeze bleibt aktiv
    }

    const selection = window.getSelection();
    const container = transcriptBoxRef.current;

    if (selection && selection.toString().trim() && container && selection.rangeCount > 0) {
      const text = selection.toString();
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Remove previous pending highlight if exists (user selected new text without querying agent)
      if (pendingHighlightIdRef.current) {
        removeHighlight(pendingHighlightIdRef.current);
        pendingHighlightIdRef.current = null;
      }

      // Sofort echtes Highlight erzeugen (mark-Element)
      const highlight = createHighlightFromSelection(range, text, container);
      if (highlight) {
        // Prüfe ob das Highlight in einer Agent-Response liegt
        let parentResponseId: string | undefined;
        let node: Node | null = range.startContainer;
        while (node && node !== container) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.hasAttribute('data-response-id')) {
              parentResponseId = el.getAttribute('data-response-id') || undefined;
              break;
            }
          }
          node = node.parentNode;
        }
        
        lastHighlightRef.current = {
          id: highlight.id,
          text: highlight.text,
          color: highlight.color,
          anchorTop: rect.top - containerRect.top + container.scrollTop,
          groupId: highlight.groupId,
          parentResponseId,
        };
        // Mark this highlight as pending (not yet confirmed with agent query)
        pendingHighlightIdRef.current = highlight.id;
        setHighlightMenuContainer(container);
        setDisableDeleteInMenu(false);
        
        // Menü unterhalb des markierten Bereichs anzeigen
        showMenuAtSelection(container, {
          range,
          selectedText: highlight.text,
          highlightColor: highlight.color,
          highlightId: highlight.id,
          width: rect.width,
          x: rect.left - containerRect.left,
          y: rect.bottom - containerRect.top + 8,
        });
      }

      // Native Selection entfernen, damit nur das mark sichtbar ist
      selection.removeAllRanges();
    }
    // KEINE unfreezeText() hier - Freeze bleibt aktiv bis Klick AUSSERHALB des Textfeldes
  }, [showMenuAtSelection, createHighlightFromSelection]);

  const openHighlightMenuForMark = useCallback((markEl: HTMLElement, container: HTMLElement) => {
    const highlightId = markEl.getAttribute("data-highlight-id");
    if (!highlightId) return;

    // Remove previous pending highlight if it's a different one
    if (pendingHighlightIdRef.current && pendingHighlightIdRef.current !== highlightId) {
      removeHighlight(pendingHighlightIdRef.current);
      pendingHighlightIdRef.current = null;
    }

    const highlight = highlights.find(h => h.id === highlightId);
    if (!highlight) return;

    const range = document.createRange();
    range.selectNodeContents(markEl);

    const rect = markEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Pr\u00fcfe ob das Highlight in einer Agent-Response liegt
    let parentResponseId: string | undefined;
    let node: Node | null = markEl;
    while (node && node !== container) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute('data-response-id')) {
          parentResponseId = el.getAttribute('data-response-id') || undefined;
          break;
        }
      }
      node = node.parentNode;
    }

    lastHighlightRef.current = {
      id: highlight.id,
      text: highlight.text,
      color: highlight.color,
      anchorTop: rect.top - containerRect.top + container.scrollTop,
      groupId: highlight.groupId,
      parentResponseId,
    };

    // In der rechten Spalte ist \"Delete from transcript\" nicht sinnvoll/gef\u00e4hrlich
    setDisableDeleteInMenu(!highlight.groupId.startsWith("group-"));
    setHighlightMenuContainer(container);

    setHighlightMenuContainer(container);
    setDisableDeleteInMenu(false);
    showMenuAtSelection(container, {
      range,
      selectedText: highlight.text,
      highlightColor: highlight.color,
      highlightId: highlight.id,
      width: rect.width,
      x: rect.left - containerRect.left,
      y: rect.bottom - containerRect.top + 8,
    });
  }, [highlights, removeHighlight, showMenuAtSelection]);

  // Beim Klick auf bestehendes Highlight: Optionen erneut anzeigen
  const handleHighlightClick = useCallback((e: React.MouseEvent) => {
    // WICHTIG: Wenn auf einen Link geklickt wurde, nicht interferieren
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      return; // Link-Klick nicht blockieren
    }

    const container = transcriptBoxRef.current;
    if (!container) return;

    const markEl = (e.target as HTMLElement).closest("mark[data-highlight-id]") as HTMLElement | null;
    if (!markEl) return;

    const highlightId = markEl.getAttribute("data-highlight-id");
    if (!highlightId) return;

    // Remove previous pending highlight if it's a different one
    if (pendingHighlightIdRef.current && pendingHighlightIdRef.current !== highlightId) {
      removeHighlight(pendingHighlightIdRef.current);
      pendingHighlightIdRef.current = null;
    }

    const highlight = highlights.find(h => h.id === highlightId);
    if (!highlight) return;

    const range = document.createRange();
    range.selectNodeContents(markEl);

    const rect = markEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Prüfe ob das Highlight in einer Agent-Response liegt
    let parentResponseId: string | undefined;
    let node: Node | null = markEl;
    while (node && node !== container) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute('data-response-id')) {
          parentResponseId = el.getAttribute('data-response-id') || undefined;
          break;
        }
      }
      node = node.parentNode;
    }

    const scrollTopForAnchor =
      container === transcriptBoxRef.current
        ? container.scrollTop
        : (transcriptBoxRef.current?.scrollTop ?? transcriptScrollTop);

    lastHighlightRef.current = {
      id: highlight.id,
      text: highlight.text,
      color: highlight.color,
      anchorTop: rect.top - containerRect.top + scrollTopForAnchor,
      groupId: highlight.groupId,
      parentResponseId,
    };

    setHighlightMenuContainer(container);
    setDisableDeleteInMenu(!highlight.groupId.startsWith("group-"));

    showMenuAtSelection(container, {
      range,
      selectedText: highlight.text,
      highlightColor: highlight.color,
      highlightId: highlight.id,
      width: rect.width,
      x: rect.left - containerRect.left,
      y: rect.bottom - containerRect.top + 8,
    });
  }, [highlights, removeHighlight, showMenuAtSelection, transcriptScrollTop]);

  // Ref für letztes erstelltes Highlight (für Agent-Queries)
  const lastHighlightRef = useRef<{ 
    id: string; 
    text: string; 
    color: HighlightColor; 
    anchorTop: number;
    groupId: string;           // GroupId wo das Highlight liegt
    parentResponseId?: string; // Falls in einer Response markiert wurde
  } | null>(null);

  // Track "pending" highlight that hasn't been confirmed with an agent query
  // Will be removed when clicking elsewhere or selecting new text
  const pendingHighlightIdRef = useRef<string | null>(null);

  // Hilfs-Snapshot für Agent-Queries (nutzt Auto-Highlight wenn vorhanden)
  const getCurrentHighlightSnapshot = useCallback(() => {
    if (lastHighlightRef.current) return lastHighlightRef.current;
    const highlight = createHighlight();
    if (!highlight) return null;
    const snapshot = {
      id: highlight.id,
      text: highlight.text,
      color: highlight.color,
      anchorTop: Math.max(0, menuState.y - 8) + (highlightMenuContainer?.scrollTop ?? transcriptBoxRef.current?.scrollTop ?? 0),
      groupId: highlight.groupId,
      parentResponseId: undefined as string | undefined,
    };
    lastHighlightRef.current = snapshot;
    return snapshot;
  }, [createHighlight, menuState.y, highlightMenuContainer]);

  // Kombinierter Handler: Highlight erstellen UND Expand-Query starten
  const handleHighlightAndExpand = useCallback(() => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;
    
    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;
    
    const prompt = `Context: "${highlight.text}"

Give me 3-5 bullet points with key facts I can use in conversation. Short, precise, no fluff.`;
    
    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "expand",
      highlight.groupId,
      highlight.parentResponseId,
      "Show more details"
    );
    hideMenu();
    unfreezeText(); // Agent-Auftrag abgeschickt - Freeze beenden
  }, [getCurrentHighlightSnapshot, queryAgent, hideMenu, unfreezeText]);

  // Kombinierter Handler: Highlight erstellen UND Facts-Query starten
  const handleHighlightAndFacts = useCallback(() => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;
    
    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;
    
    const prompt = `Context: "${highlight.text}"

Find 2-3 similar deal examples from Microsoft Switzerland in your index. One line each, max. Focus on facts such as contract scope, number of users, etc.`;
    
    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "facts",
      highlight.groupId,
      highlight.parentResponseId,
      "Find similar examples"
    );
    hideMenu();
    unfreezeText(); // Agent-Auftrag abgeschickt - Freeze beenden
  }, [getCurrentHighlightSnapshot, queryAgent, hideMenu, unfreezeText]);

  // Custom Prompt Handler (Enter im Textfeld)
  const handleCustomPrompt = useCallback((customPrompt: string) => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;

    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;

    const prompt = `Context: "${highlight.text}"

${customPrompt}`;

    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "expand",
      highlight.groupId,
      highlight.parentResponseId,
      "Custom instruction",
      customPrompt
    );
    hideMenu();
    unfreezeText(); // Agent-Auftrag abgeschickt - Freeze beenden
  }, [getCurrentHighlightSnapshot, queryAgent, hideMenu, unfreezeText]);

  // Handler für das Schließen des Menüs - entfernt auch das pending Highlight
  const handleCloseMenu = useCallback(() => {
    // Wenn ein pending Highlight existiert und das Menü geschlossen wird (ohne Agent-Query),
    // dann entferne das Highlight wieder
    if (pendingHighlightIdRef.current) {
      removeHighlight(pendingHighlightIdRef.current);
      pendingHighlightIdRef.current = null;
      lastHighlightRef.current = null;
    }
    hideMenu();
    // KEIN unfreezeText() - Freeze bleibt bis Klick außerhalb
  }, [hideMenu, removeHighlight]);

  // Handler für Copy - kopiert markierten Text in Zwischenablage
  // Rechter Panel: Textselektion ebenfalls highlightbar machen (Agent-Aufträge markieren)
  const handleAuraPanelContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const container = auraResponsesContainerRef.current;
    if (!container) return;

    if (selection && selection.toString().trim()) {
      e.preventDefault();
      setHighlightMenuContainer(container);
      setDisableDeleteInMenu(true);
      showMenuAtSelection(container);
    }
  }, [showMenuAtSelection]);

  const handleAuraPanelMouseUp = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      return;
    }

    const selection = window.getSelection();
    const container = auraResponsesContainerRef.current;
    if (!container) return;

    if (selection && selection.toString().trim() && selection.rangeCount > 0) {
      const text = selection.toString();
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      if (pendingHighlightIdRef.current) {
        removeHighlight(pendingHighlightIdRef.current);
        pendingHighlightIdRef.current = null;
      }

      const highlight = createHighlightFromSelection(range, text, container);
      if (highlight) {
        let parentResponseId: string | undefined;
        let node: Node | null = range.startContainer;
        while (node && node !== container) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.hasAttribute('data-response-id')) {
              parentResponseId = el.getAttribute('data-response-id') || undefined;
              break;
            }
          }
          node = node.parentNode;
        }

        const transcriptScrollTopNow = transcriptBoxRef.current?.scrollTop ?? transcriptScrollTop;

        lastHighlightRef.current = {
          id: highlight.id,
          text: highlight.text,
          color: highlight.color,
          anchorTop: rect.top - containerRect.top + transcriptScrollTopNow,
          groupId: highlight.groupId,
          parentResponseId,
        };
        pendingHighlightIdRef.current = highlight.id;

        setHighlightMenuContainer(container);
        setDisableDeleteInMenu(true);

        showMenuAtSelection(container, {
          range,
          selectedText: highlight.text,
          highlightColor: highlight.color,
          highlightId: highlight.id,
          width: rect.width,
          x: rect.left - containerRect.left,
          y: rect.bottom - containerRect.top + 8,
        });
      }

      selection.removeAllRanges();
    }
  }, [createHighlightFromSelection, removeHighlight, showMenuAtSelection, transcriptScrollTop]);

  const handleAuraPanelHighlightClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      return;
    }

    const container = auraResponsesContainerRef.current;
    if (!container) return;

    const markEl = (e.target as HTMLElement).closest("mark[data-highlight-id]") as HTMLElement | null;
    if (!markEl) return;

    openHighlightMenuForMark(markEl, container);
  }, [openHighlightMenuForMark]);

  const handleCopy = useCallback(async () => {
    // Versuche zuerst den Text aus dem aktuellen Mark-Element zu holen
    let text = menuState.selectedText;
    
    // Fallback: Text aus dem Highlight-Objekt holen
    if (menuState.highlightId) {
      const highlight = highlights.find(h => h.id === menuState.highlightId);
      if (highlight) {
        text = highlight.text;
      }
    }
    
    // Fallback: Text aus dem DOM-Mark-Element holen
    if (!text) {
      const markEl = document.querySelector(`mark[data-highlight-id="${menuState.highlightId}"]`);
      if (markEl) {
        const highlightId = menuState.highlightId;
        const markEls = highlightId ? document.querySelectorAll(`mark[data-highlight-id="${highlightId}"]`) : [];
        const joined = Array.from(markEls)
          .map((el) => el.textContent || "")
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
        text = joined || markEl.textContent || "";
      }
    }
    
    if (!text) return;
    
    try {
      await navigator.clipboard.writeText(text);
      console.log("[Copy] Text copied to clipboard:", text.slice(0, 50) + (text.length > 50 ? "..." : ""));
    } catch (err) {
      console.error("[Copy] Failed to copy:", err);
      // Fallback für ältere Browser
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    
    // Menü schließen und Highlight entfernen (kein Agent getriggert)
    handleCloseMenu();
    unfreezeText(); // Text kopiert - Freeze beenden
  }, [menuState.selectedText, menuState.highlightId, highlights, handleCloseMenu, unfreezeText]);

  // Handler für Delete - löscht markierten Text aus dem Transkript
  const handleDelete = useCallback(() => {
    // Mehrere Quellen für den zu löschenden Text
    let text = menuState.selectedText;
    const highlightId = menuState.highlightId || lastHighlightRef.current?.id;
    
    // Fallback 1: Text aus dem Highlight-Objekt holen
    if (highlightId) {
      const highlight = highlights.find(h => h.id === highlightId);
      if (highlight) {
        text = highlight.text;
      }
    }
    
    // Fallback 2: Text aus dem DOM-Mark-Element holen (aktuellster Stand)
    if (highlightId) {
      const markEl = document.querySelector(`mark[data-highlight-id="${highlightId}"]`);
      if (markEl && markEl.textContent) {
        // Nutze den DOM-Text als primäre Quelle wenn vorhanden
        const markEls = document.querySelectorAll(`mark[data-highlight-id="${highlightId}"]`);
        const joined = Array.from(markEls)
          .map((el) => el.textContent || "")
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim();
        text = joined || markEl.textContent;
      }
    }
    
    if (!text) {
      console.warn("[Delete] No text to delete");
      return;
    }
    
    console.log("[Delete] Deleting text:", text.slice(0, 50) + (text.length > 50 ? "..." : ""));
    
    // Text aus Transkript löschen
    deleteTextFromTranscript(text);
    
    // Zugehörige Highlights und Antworten entfernen
    if (highlightId) {
      removeResponseByHighlight(highlightId);
      removeHighlight(highlightId);
      if (lastHighlightRef.current?.id === highlightId) {
        lastHighlightRef.current = null;
      }
    }

    // Menü schließen und Highlight entfernen (kein Agent getriggert)
    handleCloseMenu();
    unfreezeText(); // Text gelöscht - Freeze beenden
  }, [menuState.selectedText, menuState.highlightId, highlights, deleteTextFromTranscript, removeResponseByHighlight, removeHighlight, handleCloseMenu, unfreezeText]);

  // Handler für das Löschen einer Agent-Antwort - entfernt auch das zugehörige Highlight
  const handleRemoveAuraResponse = useCallback((responseId: string) => {
    // Finde die Antwort um die highlightId zu bekommen
    const response = auraResponses.find(r => r.id === responseId);
    if (response) {
      const remaining = auraResponses.filter(r => r.highlightId === response.highlightId && r.id !== responseId);
      if (remaining.length === 0) {
        removeHighlight(response.highlightId);
        if (lastHighlightRef.current?.id === response.highlightId) {
          lastHighlightRef.current = null;
        }
      }
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
  // Segmente nach Timestamp sortieren - bei Freeze die gefrorenen verwenden
  const displaySegments = isTextFrozen && frozenSegmentsRef.current 
    ? frozenSegmentsRef.current 
    : segments;
    
  const sortedSegments = useMemo(() => 
    [...displaySegments].sort((a, b) => a.timestamp - b.timestamp),
    [displaySegments]
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

  useLayoutEffect(() => {
    if (!transcriptBoxRef.current) return;
    const { scrollTop, scrollHeight } = transcriptBoxRef.current;
    setTranscriptScrollTop(scrollTop);
    setTranscriptScrollHeight(scrollHeight);
  }, [groupedSegmentsWithOffsets.length, auraResponses.length, isTextFrozen]);

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

  // Rechte Spalte muss Context-Panels vollständig zeigen, auch wenn das Transkript (noch) kurz ist.
  // Daher messen wir die tatsächlichen Panel-Höhen und erhöhen den Spacer so, dass die gesamte Box sichtbar ist.
  useLayoutEffect(() => {
    const container = auraResponsesContainerRef.current;
    if (!container) return;

    const panels = Array.from(
      container.querySelectorAll(".aura-response-panel[data-response-id]")
    ) as HTMLElement[];

    if (panels.length === 0) return;

    const update = (el: HTMLElement) => {
      const id = el.getAttribute("data-response-id");
      if (!id) return;
      const h = Math.max(0, Math.ceil(el.getBoundingClientRect().height));
      setAuraPanelHeights((prev) => {
        if (prev[id] === h) return prev;
        return { ...prev, [id]: h };
      });
    };

    panels.forEach(update);

    const ro = new ResizeObserver((entries) => {
      entries.forEach((entry) => update(entry.target as HTMLElement));
    });

    panels.forEach((p) => ro.observe(p));

    return () => ro.disconnect();
  }, [auraResponses.length]);

  // Dynamische anchorTop-Positionen (Highlight kann sich durch Re-Sortierung/Wrap/Resize verschieben).
  // Wichtig: DOM-Messung NICHT in render() (useMemo) ausführen, sonst läuft es bei Streaming ständig.
  const auraAnchorSignature = useMemo(() => {
    return auraResponses.map((r) => `${r.id}:${r.highlightId}:${r.anchorTop}`).join("|");
  }, [auraResponses]);

  useLayoutEffect(() => {
    const transcriptBox = transcriptBoxRef.current;
    if (!transcriptBox) return;

    let rafId: number | null = null;

    const compute = () => {
      rafId = null;
      const containerRect = transcriptBox.getBoundingClientRect();
      const next: Record<string, number> = {};

      for (const response of auraResponses) {
        const markEl = transcriptBox.querySelector(
          `mark[data-highlight-id="${response.highlightId}"]`
        ) as HTMLElement | null;

        if (!markEl) {
          next[response.id] = response.anchorTop;
          continue;
        }

        const markRect = markEl.getBoundingClientRect();
        next[response.id] = markRect.top - containerRect.top + transcriptBox.scrollTop;
      }

      setDynamicAnchorTops((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) return next;
        for (const k of nextKeys) {
          if (prev[k] !== next[k]) return next;
        }
        return prev;
      });
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(compute);
    };

    schedule();

    const ro = new ResizeObserver(() => schedule());
    ro.observe(transcriptBox);
    window.addEventListener("resize", schedule);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [auraAnchorSignature, groupedSegmentsWithOffsets.length, isTextFrozen, agentPanelWidth]);

  // Berechne nicht-überlappende Positionen für AURA-Panels
  // Sortiert nach anchorTop, dann werden überlappende Panels nach unten verschoben
  const positionedAuraResponses = useMemo(() => {
    if (auraResponses.length === 0) return [];
    
    // Verwende dynamische Positionen statt fester anchorTop
    const withDynamicTops = auraResponses.map(r => ({
      ...r,
      currentAnchorTop: dynamicAnchorTops[r.id] ?? r.anchorTop
    }));
    
    // Sortiere nach aktueller Position
    const sorted = withDynamicTops.sort((a, b) => a.currentAnchorTop - b.currentAnchorTop);
    
    return sorted.map((response) => ({
      ...response,
      adjustedTop: response.currentAnchorTop,
    }));
  }, [auraResponses, dynamicAnchorTops]);

  const auraSpacerHeight = useMemo(() => {
    const baseHeight = transcriptScrollHeight || transcriptBoxRef.current?.scrollHeight || 0;
    let required = 0;

    for (const r of positionedAuraResponses) {
      const h = auraPanelHeights[r.id] ?? 0;
      required = Math.max(required, r.adjustedTop + h + 16);
    }

    return Math.max(baseHeight, required);
  }, [positionedAuraResponses, auraPanelHeights, transcriptScrollHeight]);
  
  const handleAskAuraFullTranscript = useCallback(() => {
    if (segments.length === 0) return;
    const prompt = `Provide key facts and highlights based on this transcript:\n${mergedTranscript}`;
    // Für Full-Transcript: Generiere temporäre ID
    const tempId = `full-${Date.now()}`;
    queryAgent(prompt, tempId, "Full Transcript Analysis", 1, 0, "full", "", undefined, "Analyze full transcript");
  }, [segments.length, mergedTranscript, queryAgent]);

  // Clear highlights when clearing transcript
  const handleClear = useCallback(() => {
    resetTranscript();
    clearErrors();
    clearHighlights();
    clearAuraResponses();
    lastHighlightRef.current = null;
  }, [resetTranscript, clearErrors, clearHighlights, clearAuraResponses]);

  return (
    <div className="layout">
      <header>
        <div>
          <p className="eyebrow">React/Vite x OpenAI Realtime x Microsoft Foundry Workflows</p>
          <h1 className="brand-title">
            <span className="brand-main">CONPILOT</span>
            <span className="brand-text">TEXT</span>
          </h1>
        </div>
      </header>

      {/* Sidebar links */}
      <aside className="sidebar">
        {/* Transcription Model Selection - oberhalb Agent Selection */}
        <div className="panel sidebar-panel">
          <h3>Transcription Model</h3>
          <div className="agent-selector">
            <select
              value={transcriptionModelId}
              onChange={(e) => setTranscriptionModelId(e.target.value)}
              disabled={status === "running" || status === "connecting"}
              className="agent-dropdown"
              title={status === "running" ? "Stop transcription to change model" : "Select transcription model"}
            >
              {TRANSCRIPTION_MODELS.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.providerLabel})
                </option>
              ))}
            </select>
            {(status === "running" || status === "connecting") && (
              <span className="agent-switching" style={{ fontSize: 10, opacity: 0.7 }}>
                Stop to change
              </span>
            )}
          </div>
        </div>
        
        {/* Agent Selection - oberhalb Audio Settings */}
        <div className="panel sidebar-panel">
          <h3>AI Agent / Workflow</h3>
          {agents.length === 0 && workflows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>Loading agents...</p>
          ) : (
            <div className="agent-selector">
              <select
                value={currentAgentId || ""}
                onChange={(e) => handleAgentSwitch(Number(e.target.value))}
                disabled={agentSwitching}
                className="agent-dropdown"
              >
                {/* Agents Group */}
                {agents.length > 0 && (
                  <optgroup label="🤖 Agents">
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.label || agent.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Workflows Group */}
                {workflows.length > 0 && (
                  <optgroup label="⚡ Workflows">
                    {workflows.map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.label || workflow.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {agentSwitching && <span className="agent-switching">Switching...</span>}
            </div>
          )}
        </div>
        
        <div className="panel sidebar-panel">
          <h3>Audio Settings</h3>
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
            <div className="volume-meter-row">
              <VolumeMeter level={micMuted ? 0 : volumeLevels.mic} label="MIC" />
              <button 
                className={`mic-mute-btn ${micMuted ? 'muted' : 'recording'}`}
                onClick={() => setMicMuted(!micMuted)}
                title={micMuted ? "Start recording" : "Stop recording"}
                disabled={status !== "running"}
              >
                <div className="mic-icon-wrapper">
                  {micMuted ? (
                    /* Muted - Red circle with mic-off */
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mic-icon-svg">
                      <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M12 7v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <circle cx="12" cy="14" r="1" fill="currentColor"/>
                      <line x1="7" y1="7" x2="17" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    /* Recording - Green pulsing circle with mic */
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mic-icon-svg">
                      <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity="0.4"/>
                      <rect x="10" y="6" width="4" height="8" rx="2" fill="currentColor"/>
                      <path d="M8 12a4 4 0 0 0 8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <line x1="12" y1="16" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>
              </button>
            </div>
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
            {/* EIN Container für beide Modi - contentEditable wird umgeschaltet */}
            <div 
              className={`transcript-box ${isTextFrozen ? 'editable-mode' : ''}`}
              ref={transcriptBoxRef}
              onScroll={handleScroll}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onKeyDown={handleKeyDown}
              onClick={handleHighlightClick}
              onContextMenu={handleContextMenu}
              contentEditable={isTextFrozen}
              suppressContentEditableWarning={true}
              style={{ position: "relative" }}
            >
              {/* Content wird IMMER gerendert */}
              {displaySegments.length === 0 && (
                <p className="muted">No input yet. Pick at least one audio source and hit Start.</p>
              )}
              {/* Gruppierte Segmente - Tag nur bei Speaker-Wechsel, Cursor bei Live-Content */}
              {/* Mit Inline Agent Responses nach relevanten Segmenten */}
              {groupedSegmentsWithOffsets.map((group) => {
                const groupText = group.texts.join(" ");
                
                // Finde alle Responses die zu diesem Segment gehören
                // (sourceGroupId = group.id UND keine insertAfterResponseId)
                const responsesForGroup = auraResponses.filter(r => 
                  r.sourceGroupId === group.id && !r.insertAfterResponseId
                );
                
                return (
                  <div key={group.id}>
                    {/* Das Transkript-Segment */}
                    <div className={`final-line source-${group.source} ${group.isSourceChange ? 'has-tag' : 'no-tag'}`}>
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
                    
                    {/* Inline Agent Responses für dieses Segment */}
                    {responsesForGroup.map(response => {
                      // Sammle auch alle Folge-Responses (wenn in dieser Response markiert wurde)
                      const getChainedResponses = (parentId: string): typeof auraResponses => {
                        const children = auraResponses.filter(r => r.insertAfterResponseId === parentId);
                        return children.flatMap(child => [child, ...getChainedResponses(child.id)]);
                      };
                      const chainedResponses = getChainedResponses(response.id);
                      
                      return (
                        <div key={response.id} className="inline-responses-chain">
                          <InlineAgentResponse
                            responseId={response.id}
                            taskLabel={response.taskLabel}
                            taskDetail={response.taskDetail}
                            result={response.result}
                            loading={response.loading}
                            error={response.error}
                            color={response.color}
                            highlights={highlights}
                            onClose={handleRemoveAuraResponse}
                          />
                          {/* Folge-Responses (nicht verschachtelt, untereinander) */}
                          {chainedResponses.map(chainedResponse => (
                            <InlineAgentResponse
                              key={chainedResponse.id}
                              responseId={chainedResponse.id}
                              taskLabel={chainedResponse.taskLabel}
                              taskDetail={chainedResponse.taskDetail}
                              result={chainedResponse.result}
                              loading={chainedResponse.loading}
                              error={chainedResponse.error}
                              color={chainedResponse.color}
                              highlights={highlights}
                              onClose={handleRemoveAuraResponse}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              
              {menuState.visible && highlightMenuContainer && createPortal(
                <HighlightMenu
                  visible={menuState.visible}
                  x={menuState.x}
                  y={menuState.y}
                  width={menuState.width}
                  highlightColor={menuState.highlightColor}
                  onClose={handleCloseMenu}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                  onExpand={handleHighlightAndExpand}
                  onFacts={handleHighlightAndFacts}
                  onCustomPrompt={handleCustomPrompt}
                  isLoading={anyAuraLoading}
                  disableDelete={disableDeleteInMenu}
                />,
                highlightMenuContainer
              )}
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
                  ref={auraResponsesContainerRef}
                  style={{ width: agentPanelWidth }}
                  onMouseUp={handleAuraPanelMouseUp}
                  onClick={handleAuraPanelHighlightClick}
                  onContextMenu={handleAuraPanelContextMenu}
                >
                  <div
                    className="aura-responses-spacer"
                    style={{
                      height: auraSpacerHeight || undefined,
                      transform: `translateY(-${transcriptScrollTop}px)`,
                    }}
                  >
                    {positionedAuraResponses.map((response) => (
                      <div
                        key={response.id}
                        className="aura-response-positioner"
                        style={{ top: response.adjustedTop }}
                      >
                        <AuraResponsePanel
                          id={response.id}
                          sourceText={response.sourceText}
                          taskLabel={response.taskLabel}
                          taskDetail={response.taskDetail}
                          color={response.color}
                          result={response.result}
                          loading={response.loading}
                          error={response.error}
                          statusNote={response.statusNote}
                          onClose={handleRemoveAuraResponse}
                          onAskFollowUp={askFollowUp}
                          highlights={highlights}
                          sourceGroupId={`aura-source-${response.id}`}
                          followUps={response.followUps}
                        />
                      </div>
                    ))}
                  </div>
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
