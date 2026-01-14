import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { DeviceSelector } from "./components/DeviceSelector";
import { HighlightedText } from "./components/HighlightedText";
import { HighlightMenu } from "./components/HighlightMenu";
import { AuraResponsePanel } from "./components/AuraResponsePanel";
import { InlineAgentResponse } from "./components/InlineAgentResponse";
import { UserMenu } from "./components/UserMenu";
import type { SpeakerSource } from "./components/DeviceSelector";
import { useDualRealtime, type TranscriptionProvider, type TranscriptSegment } from "./hooks/useDualRealtime";
import { useTabCapture } from "./hooks/useTabCapture";
import { useAuraAgent } from "./hooks/useAuraAgent";
import { useHighlights, type HighlightColor, type Highlight } from "./hooks/useHighlights";
import { useTextFormats } from "./hooks/useTextFormats";
import { makeTranscriptGroupId } from "./utils/transcriptGrouping";
import { proxyBaseUrl } from "./proxyConfig";

// Agent/Workflow type from proxy server
interface AgentInfo {
  id: number;
  name: string;
  label: string;
  type: "agent" | "workflow" | "mfa";
  active: boolean;
}

// Transcription Model configuration
interface TranscriptionModel {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
}

// Available transcription models - OpenAI mini is DEFAULT (best quality/price)
// NOTE: gpt-4o-transcribe-diarize does NOT work over WebSocket Realtime API!
// Diarization is only available via REST API, not real-time streaming.
const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
  { 
    id: "openai", 
    name: "gpt-4o-mini-transcribe-2025-12-15", 
    provider: "openai", 
    providerLabel: "OpenAI" 
  },
  { 
    id: "azure-mini", 
    name: "gpt-4o-mini-transcribe", 
    provider: "azure", 
    providerLabel: "Azure OpenAI" 
  },
  { 
    id: "azure", 
    name: "gpt-4o-transcribe", 
    provider: "azure", 
    providerLabel: "Azure OpenAI" 
  },
];

const GROUP_PAUSE_THRESHOLD_MS = 3500;
const AURA_PANEL_GAP = 16;

type TranscriptGroup = {
  id: string;
  source: string;
  texts: string[];
  lastTimestamp: number;
  isSourceChange: boolean;
  hasLive: boolean;
};

// Zero-Width Space entfernen und Whitespace normalisieren
const normalizeGroupText = (value: string) => value.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();

const buildGroupTextMap = (
  inputSegments: TranscriptSegment[],
  groupCloseTimestamps: Record<string, number> = {},
  editedGroupTexts: Record<string, string> = {},
) => {
  const sorted = [...inputSegments].sort((a, b) => a.timestamp - b.timestamp);
  const groups: {
    id: string;
    source: string;
    texts: string[];
    lastTimestamp: number;
  }[] = [];

  for (const seg of sorted) {
    const lastGroup = groups[groups.length - 1];
    const pauseSinceLast = lastGroup ? seg.timestamp - lastGroup.lastTimestamp : 0;
    const sourceChanged = !lastGroup || lastGroup.source !== seg.source;
    const closedAt = lastGroup ? groupCloseTimestamps[lastGroup.id] : undefined;
    const groupClosed = closedAt !== undefined && seg.timestamp > closedAt;

    if (sourceChanged || pauseSinceLast > GROUP_PAUSE_THRESHOLD_MS || groupClosed) {
      groups.push({
        id: makeTranscriptGroupId(seg),
        source: seg.source,
        texts: [seg.text],
        lastTimestamp: seg.timestamp,
      });
    } else {
      lastGroup.texts.push(seg.text);
      lastGroup.lastTimestamp = seg.timestamp;
    }
  }

  const map = new Map<string, string>();
  for (const group of groups) {
    map.set(group.id, group.texts.join(" ").trim());
  }
  for (const [groupId, text] of Object.entries(editedGroupTexts)) {
    if (map.has(groupId)) {
      map.set(groupId, text);
    }
  }
  return map;
};

const applyEditsToSegments = (
  inputSegments: TranscriptSegment[],
  groupCloseTimestamps: Record<string, number>,
  editedGroupTexts: Record<string, string>,
) => {
  const editedEntries = Object.entries(editedGroupTexts);
  if (editedEntries.length === 0) return inputSegments;

  const sortedWithIndices = inputSegments
    .map((seg, originalIndex) => ({ seg, originalIndex }))
    .sort((a, b) => a.seg.timestamp - b.seg.timestamp);

  const groupToOriginalIndices = new Map<string, number[]>();
  let currentGroupId: string | null = null;
  let lastSeg: TranscriptSegment | null = null;

  for (const { seg, originalIndex } of sortedWithIndices) {
    const pauseSinceLast = lastSeg ? seg.timestamp - lastSeg.timestamp : 0;
    const sourceChanged = !lastSeg || lastSeg.source !== seg.source;
    const closedAt = currentGroupId ? groupCloseTimestamps[currentGroupId] : undefined;
    const groupClosed = closedAt !== undefined && seg.timestamp > closedAt;

    if (!currentGroupId || sourceChanged || pauseSinceLast > GROUP_PAUSE_THRESHOLD_MS || groupClosed) {
      currentGroupId = makeTranscriptGroupId(seg);
    }

    if (!groupToOriginalIndices.has(currentGroupId)) {
      groupToOriginalIndices.set(currentGroupId, []);
    }
    groupToOriginalIndices.get(currentGroupId)!.push(originalIndex);
    lastSeg = seg;
  }

  const newSegments = [...inputSegments];
  for (const [groupId, newText] of editedEntries) {
    const originalIndices = groupToOriginalIndices.get(groupId);
    if (!originalIndices || originalIndices.length === 0) continue;

    const words = newText.trim().split(/\s+/);
    const wordsPerSegment = Math.ceil(words.length / originalIndices.length);
    originalIndices.forEach((segIndex, i) => {
      const startWord = i * wordsPerSegment;
      const segmentWords = words.slice(startWord, startWord + wordsPerSegment);
      newSegments[segIndex] = {
        ...newSegments[segIndex],
        text: segmentWords.join(" "),
      };
    });
  }

  return newSegments.filter((seg) => seg.text.trim().length > 0);
};

const mergeEditedWithBuffered = (
  editedText: string,
  frozenText: string,
  currentText: string,
) => {
  const edited = normalizeGroupText(editedText);
  const frozen = normalizeGroupText(frozenText);
  const current = normalizeGroupText(currentText);

  if (!current || current === frozen) {
    return edited;
  }

  if (edited && current.startsWith(edited)) {
    return current;
  }

  if (current.startsWith(frozen)) {
    const tail = current.slice(frozen.length).trimStart();
    if (!tail) return edited;
    if (!edited) return tail;
    if (edited.endsWith(tail)) return edited;
    return `${edited} ${tail}`.trim();
  }

  return edited;
};

const sanitizePastedText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ");

const insertPlainTextAtSelection = (value: string) => {
  if (!value) return;
  const success = document.execCommand?.("insertText", false, value);
  if (success) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(value));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

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
  const [groupCloseTimestamps, setGroupCloseTimestamps] = useState<Record<string, number>>({});
  const [editedGroupTexts, setEditedGroupTexts] = useState<Record<string, string>>({});
  const [editedGroupBases, setEditedGroupBases] = useState<Record<string, string>>({});
  const transientEditOverlayRef = useRef<Record<string, string>>({});
  const syncDOMToFrozenSegmentsRef = useRef<() => void>(() => {});
  const [transientEditOverlayVersion, setTransientEditOverlayVersion] = useState(0);
  
  // TEXT FREEZE: Wenn User klickt/selektiert, wird neuer Text gepuffert statt angezeigt
  const [isTextFrozen, setIsTextFrozen] = useState(false);
  const frozenSegmentsRef = useRef<typeof segments | null>(null);
  const frozenHtmlRef = useRef<string | null>(null); // HTML-Snapshot im Freeze-Modus (für Edit-Speicherung)
  const frozenHtmlSetRef = useRef(false); // Flag für Edit-Tracking
  const frozenGroupTextRef = useRef<Map<string, string> | null>(null);
  const groupedSegmentsRef = useRef<TranscriptGroup[]>([]);
  const skipNextFreezeSaveRef = useRef(false);
  const [frozenSegmentsVersion, setFrozenSegmentsVersion] = useState(0);
  
  // Agent selection state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workflows, setWorkflows] = useState<AgentInfo[]>([]);
  const [mfas, setMfas] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<number | null>(null);
  const [agentSwitching, setAgentSwitching] = useState(false);
  
  // Transcription Model selection - DEFAULT is OpenAI (id: "openai")
  const [transcriptionModelId, setTranscriptionModelId] = useState<string>("openai");
  
  const transcriptBoxRef = useRef<HTMLDivElement>(null);
  const transcriptAreaRef = useRef<HTMLDivElement>(null);
  const auraResponsesContainerRef = useRef<HTMLDivElement>(null);
  
  // Load available agents and workflows from proxy server
  useEffect(() => {
    fetch(`${proxyBaseUrl}/agents`)
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
        if (data.mfas) {
          setMfas(data.mfas.map((m: AgentInfo) => ({ ...m, type: "mfa" as const })));
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
      const res = await fetch(`${proxyBaseUrl}/agents/switch`, {
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
        setMfas(prev => prev.map(m => ({ ...m, active: m.id === agentId })));
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
    updateHighlightsForGroupEdit,
  } = useHighlights();

  const highlightAnchorTargetsRef = useRef<Map<string, { targetGroupId: string; useBottom: boolean }>>(new Map());
  useLayoutEffect(() => {
    const next = new Map<string, { targetGroupId: string; useBottom: boolean }>();
    for (const highlight of highlights) {
      const targetGroupId = highlight.span?.endGroupId || highlight.groupId;
      if (!targetGroupId) continue;
      const isMultiGroup = Boolean(
        highlight.span &&
        highlight.span.startGroupId &&
        highlight.span.endGroupId &&
        highlight.span.startGroupId !== highlight.span.endGroupId
      );
      next.set(highlight.id, { targetGroupId, useBottom: isMultiGroup });
    }
    highlightAnchorTargetsRef.current = next;
  }, [highlights]);

  const resolveHighlightAnchorTop = useCallback((highlight: Highlight, fallbackTop: number) => {
    const span = highlight.span;
    if (!span || span.startGroupId === span.endGroupId) return fallbackTop;
    if (!span.endGroupId.startsWith("group-")) return fallbackTop;

    const transcriptBox = transcriptBoxRef.current;
    if (!transcriptBox) return fallbackTop;
    const groupEl = transcriptBox.querySelector(`[data-group-id="${span.endGroupId}"]`) as HTMLElement | null;
    if (!groupEl) return fallbackTop;

    const containerRect = transcriptBox.getBoundingClientRect();
    const rect = groupEl.getBoundingClientRect();
    return rect.bottom - containerRect.top + transcriptBox.scrollTop;
  }, []);

  const getSelectionFallbackTop = useCallback((
    container: HTMLElement,
    rect: DOMRect,
    containerRect: DOMRect,
    scrollTop: number,
  ) => {
    const top = rect.top - containerRect.top + scrollTop;
    const bottom = rect.bottom - containerRect.top + scrollTop;
    return container === transcriptBoxRef.current ? bottom : top;
  }, []);

  const resolveHighlightSourceGroupId = useCallback((highlightId: string, fallbackGroupId: string) => {
    if (!highlightId) return fallbackGroupId;
    const highlight = highlights.find((h) => h.id === highlightId);
    if (highlight?.span?.endGroupId) return highlight.span.endGroupId;
    if (highlight?.span?.groupIds && highlight.span.groupIds.length > 0) {
      return highlight.span.groupIds[highlight.span.groupIds.length - 1];
    }

    const transcriptBox = transcriptBoxRef.current;
    if (!transcriptBox) return fallbackGroupId;

    const markEls = Array.from(
      transcriptBox.querySelectorAll("mark[data-highlight-id], mark[data-highlight-ids]"),
    ) as HTMLElement[];
    let bestGroupId: string | null = null;
    let bestBottom = -Infinity;

    for (const markEl of markEls) {
      const primaryId = markEl.getAttribute("data-highlight-id");
      const idsAttr = markEl.getAttribute("data-highlight-ids");
      const ids = new Set<string>();
      if (primaryId) ids.add(primaryId);
      if (idsAttr) {
        idsAttr.split(",").forEach((id) => {
          const trimmed = id.trim();
          if (trimmed) ids.add(trimmed);
        });
      }
      if (!ids.has(highlightId)) continue;

      const groupEl = markEl.closest("[data-group-id]") as HTMLElement | null;
      if (!groupEl) continue;
      
      const groupId = groupEl.getAttribute("data-group-id") || "";
      if (!groupId.startsWith("group-")) continue;

      const rect = groupEl.getBoundingClientRect();
      if (rect.bottom > bestBottom) {
        bestBottom = rect.bottom;
        bestGroupId = groupId;
      }
    }

    return bestGroupId || fallbackGroupId;
  }, [highlights]);

  const {
    formats,
    toggleBoldFromSelection,
    clearFormats,
    updateFormatsForGroupEdit,
  } = useTextFormats();
  
  // Get the provider and model name from the selected transcription model
  const transcriptionProvider = useMemo((): TranscriptionProvider => {
    const model = TRANSCRIPTION_MODELS.find(m => m.id === transcriptionModelId);
    return (model?.provider as TranscriptionProvider) || "openai";
  }, [transcriptionModelId]);
  
  const transcriptionModelName = useMemo((): string => {
    const model = TRANSCRIPTION_MODELS.find(m => m.id === transcriptionModelId);
    return model?.name || "gpt-4o-transcribe";
  }, [transcriptionModelId]);
  
  const {
    status,
    errorLog,
    segments,
    activeServerModel,
    activeServerModelReason,
    volumeLevels,
    micMuted,
    setMicMuted,
    spkMuted,
    setSpkMuted,
    start,
    stop,
    resetTranscript,
    deleteTextFromTranscript,
    updateSegmentsFromEdit,
    addManualSegment,
    clearErrors,
    stats,
  } = useDualRealtime(transcriptionProvider, transcriptionModelName);

  const activeTranscriptionModelLabel = useMemo(() => {
    const selected = TRANSCRIPTION_MODELS.find((m) => m.id === transcriptionModelId);
    const providerLabel = selected?.providerLabel || (transcriptionProvider === "azure" ? "Azure OpenAI" : "OpenAI");
    if (!activeServerModel) return `${providerLabel}: (noch keine Info vom Server)`;
    const reasonSuffix = activeServerModelReason ? ` [${activeServerModelReason}]` : "";
    return `${providerLabel}: ${activeServerModel}${reasonSuffix}`;
  }, [transcriptionModelId, transcriptionProvider, activeServerModel, activeServerModelReason]);
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

  // EINFACHE LÖSUNG: Speichere pending edits für später, ohne Layout-Änderungen
  const pendingEditRef = useRef<Map<string, string> | null>(null);
  
  // Bei Input: Nur die pending edits tracken, KEIN Re-Render
  const handleInput = useCallback(() => {
    if (!isTextFrozen || !transcriptBoxRef.current) return;
    
    // Alle Gruppen aus dem DOM auslesen
    const groupElements = transcriptBoxRef.current.querySelectorAll('[data-group-id]');
    const editedGroups = new Map<string, string>();
    const baselineGroupTexts = frozenGroupTextRef.current || new Map<string, string>();
    
    groupElements.forEach((el) => {
      const groupId = el.getAttribute('data-group-id');
      if (!groupId || !groupId.startsWith("group-")) return;
      
      const domText = normalizeGroupText(el.textContent || '');
      const baselineText = normalizeGroupText(baselineGroupTexts.get(groupId) || '');
      
      if (domText !== baselineText) {
        editedGroups.set(groupId, domText);
      }
    });
    
    // Nur merken, NICHT speichern - das passiert beim unfreeze
    if (editedGroups.size > 0) {
      pendingEditRef.current = editedGroups;
    }
  }, [isTextFrozen, setTransientEditOverlayVersion]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!isTextFrozen) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    const sanitized = sanitizePastedText(text);
    if (!sanitized) return;
    insertPlainTextAtSelection(sanitized);
    syncDOMToFrozenSegmentsRef.current();
  }, [isTextFrozen]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isTextFrozen) return;
    e.preventDefault();
    const text = e.dataTransfer?.getData("text/plain") || "";
    const sanitized = sanitizePastedText(text);
    if (!sanitized) return;
    insertPlainTextAtSelection(sanitized);
    syncDOMToFrozenSegmentsRef.current();
  }, [isTextFrozen]);

  const closeGroupsForFreeze = useCallback(() => {
    const groups = groupedSegmentsRef.current;
    if (!groups || groups.length === 0) return;
    setGroupCloseTimestamps((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const group of groups) {
        const current = next[group.id];
        if (current === undefined || current < group.lastTimestamp) {
          next[group.id] = group.lastTimestamp;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [setGroupCloseTimestamps]);

  // TEXT FREEZE: Bei MouseDown einfrieren, damit Selektion nicht durch neuen Text gestört wird
  // AUCH wenn keine Segmente vorhanden sind - ermöglicht Editieren vor Transkription
  const handleMouseDown = useCallback(() => {
    if (!isTextFrozen) {
      // Wenn Segmente vorhanden: normaler Freeze mit Snapshot
      if (segments.length > 0) {
        // HTML-Snapshot speichern BEVOR React etwas ändert
        if (transcriptBoxRef.current) {
          frozenHtmlRef.current = transcriptBoxRef.current.innerHTML;
        }
        const baseSegments = [...segments];
        frozenSegmentsRef.current = applyEditsToSegments(baseSegments, groupCloseTimestamps, editedGroupTexts);
        frozenGroupTextRef.current = buildGroupTextMap(segments, groupCloseTimestamps, editedGroupTexts);
        closeGroupsForFreeze();
      } else {
        // Keine Segmente: Leerer Freeze für freies Editieren
        frozenHtmlRef.current = null;
        frozenSegmentsRef.current = [];
        frozenGroupTextRef.current = new Map<string, string>();
      }
      setIsTextFrozen(true);
    }
  }, [isTextFrozen, segments, groupCloseTimestamps, editedGroupTexts, closeGroupsForFreeze]);

  // TEXT UNFREEZE MIT EDIT-SPEICHERUNG: Für User-Edits (Klick außerhalb, Enter, Escape)
  const unfreezeTextWithSave = useCallback(() => {
    console.log("[unfreezeTextWithSave] Called, isTextFrozen:", isTextFrozen);
    if (isTextFrozen && transcriptBoxRef.current) {
      // Editierten Text aus dem DOM auslesen und in Segments speichern
      const editedGroups = new Map<string, string>();
      const groupElements = transcriptBoxRef.current.querySelectorAll('[data-group-id]');
      console.log("[unfreezeTextWithSave] Found group elements:", groupElements.length);
      const frozenGroupTexts = frozenGroupTextRef.current || new Map<string, string>();
      const currentGroupTexts = buildGroupTextMap(segments, groupCloseTimestamps, editedGroupTexts);
      
      // NEUER CODE: Wenn keine Gruppen-Elemente und keine Segmente, aber Text vorhanden
      // → Manuell eingegebener Text als neues Segment hinzufügen
      if (groupElements.length === 0 && segments.length === 0) {
        const manualText = normalizeGroupText(transcriptBoxRef.current.textContent || '');
        if (manualText) {
          console.log("[unfreezeTextWithSave] Adding manual segment:", manualText.slice(0, 50));
          addManualSegment(manualText); // Default ist "keyboard"
          // DOM leeren - das Segment wird durch React neu gerendert
          transcriptBoxRef.current.textContent = '';
        }
      } else {
        // Bestehende Logik für vorhandene Gruppen
        groupElements.forEach((el) => {
          const groupId = el.getAttribute('data-group-id');
          console.log("[unfreezeTextWithSave] Checking element, groupId:", groupId);
          if (!groupId || !groupId.startsWith("group-")) {
            console.log("[unfreezeTextWithSave] Skipping - invalid groupId");
            return;
          }

          // Nur den reinen Text (ohne Mark-Tags etc.)
          const text = normalizeGroupText(el.textContent || '');
          const frozenText = frozenGroupTexts.get(groupId) || "";
          const frozenNormalized = normalizeGroupText(frozenText);

          if (text !== frozenNormalized) {
            const currentText = currentGroupTexts.get(groupId) || "";
            const mergedText = mergeEditedWithBuffered(text, frozenText, currentText);
            if (mergedText !== frozenNormalized) {
              editedGroups.set(groupId, mergedText);
            }
          }
        });
        
        // Segments mit editiertem Text aktualisieren
        if (editedGroups.size > 0) {
          updateSegmentsFromEdit(editedGroups, groupCloseTimestamps);
          // Highlight-Offsets an die neuen Texte anpassen
          updateHighlightsForGroupEdit(editedGroups, frozenGroupTexts);
          updateFormatsForGroupEdit(editedGroups, frozenGroupTexts);
          setEditedGroupTexts((prev) => {
            const next = { ...prev };
            for (const [groupId, text] of editedGroups) {
              next[groupId] = text;
            }
            return next;
          });
          setEditedGroupBases((prev) => {
            const next = { ...prev };
            for (const [groupId] of editedGroups) {
              const baseText = frozenGroupTexts.get(groupId);
              if (baseText !== undefined) {
                next[groupId] = normalizeGroupText(baseText);
              }
            }
            return next;
          });
        }
      }
      
      frozenHtmlRef.current = null;
      frozenSegmentsRef.current = null;
      frozenGroupTextRef.current = null;
      frozenHtmlSetRef.current = false; // Reset für nächsten Freeze
      setIsTextFrozen(false);
      if (Object.keys(transientEditOverlayRef.current).length > 0) {
        transientEditOverlayRef.current = {};
        setTransientEditOverlayVersion((prev) => prev + 1);
      }
    }
  }, [
    isTextFrozen,
    segments,
    groupCloseTimestamps,
    editedGroupTexts,
    editedGroupBases,
    updateSegmentsFromEdit,
    updateHighlightsForGroupEdit,
    updateFormatsForGroupEdit,
    setEditedGroupTexts,
    setEditedGroupBases,
    setTransientEditOverlayVersion,
    addManualSegment,
  ]);

  // TEXT UNFREEZE OHNE EDIT-SPEICHERUNG: Für programmatische Aktionen (Delete, Copy, Agent-Query)
  // Diese Funktion überschreibt NICHT die segments - wichtig wenn deleteTextFromTranscript bereits aufgerufen wurde
  const unfreezeText = useCallback(() => {
    if (isTextFrozen) {
      frozenHtmlRef.current = null;
      frozenSegmentsRef.current = null;
      frozenGroupTextRef.current = null;
      frozenHtmlSetRef.current = false; // Reset für nächsten Freeze
      setIsTextFrozen(false);
      if (Object.keys(transientEditOverlayRef.current).length > 0) {
        transientEditOverlayRef.current = {};
        setTransientEditOverlayVersion((prev) => prev + 1);
      }
    }
  }, [isTextFrozen, setTransientEditOverlayVersion]);

  
  useEffect(() => {
    if (isTextFrozen) return;

    const editedEntries = Object.entries(editedGroupTexts);
    if (editedEntries.length === 0) return;

    const currentGroupTexts = buildGroupTextMap(segments, groupCloseTimestamps);
    const overlayUpdates = new Map<string, string>();
    const overlayPrevious = new Map<string, string>();
    const segmentUpdates = new Map<string, string>();

    for (const [groupId, editedText] of editedEntries) {
      const baseText = editedGroupBases[groupId] ?? editedText;
      const currentText = currentGroupTexts.get(groupId) ?? baseText;
      const mergedText = mergeEditedWithBuffered(editedText, baseText, currentText);

      const normalizedMerged = normalizeGroupText(mergedText);
      const normalizedEdited = normalizeGroupText(editedText);
      const normalizedCurrent = normalizeGroupText(currentText);

      if (normalizedMerged !== normalizedEdited) {
        overlayUpdates.set(groupId, mergedText);
        overlayPrevious.set(groupId, editedText);
      }

      if (normalizedMerged !== normalizedCurrent) {
        segmentUpdates.set(groupId, mergedText);
      }
    }

    if (segmentUpdates.size > 0) {
      updateSegmentsFromEdit(segmentUpdates, groupCloseTimestamps);
    }

    if (overlayUpdates.size > 0) {
      setEditedGroupTexts((prev) => {
        const next = { ...prev };
        for (const [groupId, value] of overlayUpdates) {
          next[groupId] = value;
        }
        return next;
      });
      updateHighlightsForGroupEdit(overlayUpdates, overlayPrevious);
      updateFormatsForGroupEdit(overlayUpdates, overlayPrevious);
    }
  }, [
    isTextFrozen,
    editedGroupTexts,
    editedGroupBases,
    segments,
    groupCloseTimestamps,
    updateSegmentsFromEdit,
    updateHighlightsForGroupEdit,
    updateFormatsForGroupEdit,
    setEditedGroupTexts,
  ]);

  // SYNC DOM-EDITS ZU FROZEN SEGMENTS: Synchronisiert manuelle Text-Änderungen im DOM
  // zu frozenSegmentsRef, OHNE den Freeze zu beenden. Wichtig vor Highlight-Erstellung,
  // damit React-Rerenders die Edits nicht überschreiben.
  const syncDOMToFrozenSegments = useCallback(() => {
    if (!isTextFrozen || !transcriptBoxRef.current || !frozenSegmentsRef.current) return;
    
    const groupElements = transcriptBoxRef.current.querySelectorAll('[data-group-id]');
    const frozenGroupTexts = frozenGroupTextRef.current || new Map<string, string>();
    const editedGroups = new Map<string, string>();
    
    groupElements.forEach((el) => {
      const groupId = el.getAttribute('data-group-id');
      if (!groupId || !groupId.startsWith("group-")) return;

      // Nur den reinen Text (ohne Mark-Tags etc.)
      const text = normalizeGroupText(el.textContent || '');
      const frozenText = frozenGroupTexts.get(groupId) || "";
      const frozenNormalized = normalizeGroupText(frozenText);

      if (text !== frozenNormalized) {
        editedGroups.set(groupId, text);
      }
    });
    
    // Wenn Edits vorhanden, frozenSegmentsRef aktualisieren
    if (editedGroups.size > 0) {
      // Baue eine aktualisierte Kopie von frozenSegmentsRef.current
      const sortedWithIndices = frozenSegmentsRef.current
        .map((seg, originalIndex) => ({ seg, originalIndex }))
        .sort((a, b) => a.seg.timestamp - b.seg.timestamp);
      
      // Gruppierung wie in buildGroupTextMap
      const groupToOriginalIndices = new Map<string, number[]>();
      let currentGroupId: string | null = null;
      let lastSeg: typeof segments[0] | null = null;

      for (let i = 0; i < sortedWithIndices.length; i++) {
        const { seg, originalIndex } = sortedWithIndices[i];
        const pauseSinceLast = lastSeg ? seg.timestamp - lastSeg.timestamp : 0;
        const sourceChanged = !lastSeg || lastSeg.source !== seg.source;
        const closedAt = currentGroupId ? groupCloseTimestamps[currentGroupId] : undefined;
        const groupClosed = closedAt !== undefined && seg.timestamp > closedAt;
        
        if (!currentGroupId || sourceChanged || pauseSinceLast > GROUP_PAUSE_THRESHOLD_MS || groupClosed) {
          currentGroupId = makeTranscriptGroupId(seg);
        }
        
        if (!groupToOriginalIndices.has(currentGroupId)) {
          groupToOriginalIndices.set(currentGroupId, []);
        }
        groupToOriginalIndices.get(currentGroupId)!.push(originalIndex);
        lastSeg = seg;
      }
      
      // Wende die Edits auf frozenSegmentsRef.current an
      const newFrozenSegments = [...frozenSegmentsRef.current];
      for (const [groupId, newText] of editedGroups) {
        const originalIndices = groupToOriginalIndices.get(groupId);
        if (originalIndices && originalIndices.length > 0) {
          const words = newText.trim().split(/\s+/);
          const wordsPerSegment = Math.ceil(words.length / originalIndices.length);
          
          originalIndices.forEach((segIndex, i) => {
            const startWord = i * wordsPerSegment;
            const segmentWords = words.slice(startWord, startWord + wordsPerSegment);
            newFrozenSegments[segIndex] = {
              ...newFrozenSegments[segIndex],
              text: segmentWords.join(' ')
            };
          });
        }
      }
      
      // Aktualisiere frozenSegmentsRef (ohne Freeze zu beenden)
      frozenSegmentsRef.current = newFrozenSegments.filter(seg => seg.text.trim().length > 0);
      setFrozenSegmentsVersion((prev) => prev + 1);
      
      // WICHTIG: frozenGroupTextRef NICHT aktualisieren!
      // Das ist die Baseline für den Vergleich bei unfreezeTextWithSave().
      // Wenn wir es hier überschreiben, werden weitere Änderungen nicht erkannt.
      // Die oldGroupTexts für Highlight-Updates holen wir aus dem Original.
      const oldGroupTexts = frozenGroupTextRef.current || new Map<string, string>();
      
      // Highlight-Offsets an die editierten Texte anpassen
      updateHighlightsForGroupEdit(editedGroups, oldGroupTexts);
      updateFormatsForGroupEdit(editedGroups, oldGroupTexts);

      const nextOverlay = { ...transientEditOverlayRef.current };
      for (const [groupId, text] of editedGroups) {
        nextOverlay[groupId] = text;
      }
      transientEditOverlayRef.current = nextOverlay;
      setTransientEditOverlayVersion((prev) => prev + 1);
    } else if (Object.keys(transientEditOverlayRef.current).length > 0) {
      transientEditOverlayRef.current = {};
      setTransientEditOverlayVersion((prev) => prev + 1);
    }
  }, [
    isTextFrozen,
    groupCloseTimestamps,
    segments,
    updateHighlightsForGroupEdit,
    updateFormatsForGroupEdit,
    setFrozenSegmentsVersion,
    setTransientEditOverlayVersion,
  ]);

  useEffect(() => {
    syncDOMToFrozenSegmentsRef.current = syncDOMToFrozenSegments;
  }, [syncDOMToFrozenSegments]);

  const releaseFocus = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      active.blur?.();
    }
  }, []);

  // Globaler Click-Handler: Klick außerhalb des Textfeldes beendet Freeze-Modus
  useEffect(() => {
    if (!isTextFrozen) return;

    const handleGlobalClick = (e: MouseEvent) => {
      if (skipNextFreezeSaveRef.current) {
        skipNextFreezeSaveRef.current = false;
        return;
      }
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

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      const selection = window.getSelection();
      const container = transcriptBoxRef.current;
      if (!selection || selection.rangeCount === 0 || !container) return;
      syncDOMToFrozenSegments();
      toggleBoldFromSelection(selection.getRangeAt(0), container);
      return;
    }
    
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
  }, [isTextFrozen, syncDOMToFrozenSegments, toggleBoldFromSelection, unfreezeText, unfreezeTextWithSave]);


  // Ref für letztes erstelltes Highlight (für Agent-Queries)
  const lastHighlightRef = useRef<{ 
    id: string; 
    text: string; 
    color: HighlightColor; 
    anchorTop: number;
    groupId: string;           // END-GroupId wo das Response-Panel erscheinen soll
    parentResponseId?: string; // Falls in einer Response markiert wurde
    span?: {                   // Multi-Group Info für Closure-Registrierung
      startGroupId: string;
      endGroupId: string;
      groupIds?: string[];
    };
  } | null>(null);

  // Track "pending" highlight that hasn't been confirmed with an agent query
  // Will be removed when clicking elsewhere or selecting new text
  const pendingHighlightIdRef = useRef<string | null>(null);
  const discardPendingHighlight = useCallback((keepId?: string) => {
    const pendingId = pendingHighlightIdRef.current;
    if (!pendingId) return;
    if (keepId && pendingId === keepId) return;
    removeResponseByHighlight(pendingId);
    removeHighlight(pendingId);
    if (lastHighlightRef.current?.id === pendingId) {
      lastHighlightRef.current = null;
    }
    pendingHighlightIdRef.current = null;
  }, [removeHighlight, removeResponseByHighlight]);

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
      discardPendingHighlight();
      syncDOMToFrozenSegments();

      // WICHTIG: Vor Highlight-Erstellung DOM-Edits zu frozenSegments synchronisieren,
      // damit React-Rerenders die manuellen Edits nicht überschreiben
      syncDOMToFrozenSegments();

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
          anchorTop: resolveHighlightAnchorTop(
            highlight,
            getSelectionFallbackTop(container, rect, containerRect, container.scrollTop),
          ),
          groupId: highlight.span?.endGroupId || highlight.groupId, // END-Gruppe für Response-Position
          parentResponseId,
          span: highlight.span, // Multi-Group Info für Closure-Registrierung
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
  }, [
    showMenuAtSelection,
    createHighlightFromSelection,
    syncDOMToFrozenSegments,
    discardPendingHighlight,
    resolveHighlightAnchorTop,
    getSelectionFallbackTop,
  ]);

  const openHighlightMenuForMark = useCallback((markEl: HTMLElement, container: HTMLElement) => {
    const highlightId = markEl.getAttribute("data-highlight-id");
    if (!highlightId) return;

    // Remove previous pending highlight if it's a different one
    discardPendingHighlight(highlightId);

    syncDOMToFrozenSegments();

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
      anchorTop: resolveHighlightAnchorTop(
        highlight,
        getSelectionFallbackTop(container, rect, containerRect, container.scrollTop),
      ),
      groupId: highlight.span?.endGroupId || highlight.groupId, // END-Gruppe für Response-Position
      parentResponseId,
      span: highlight.span, // Multi-Group Info für Closure-Registrierung
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
  }, [
    highlights,
    showMenuAtSelection,
    discardPendingHighlight,
    syncDOMToFrozenSegments,
    resolveHighlightAnchorTop,
    getSelectionFallbackTop,
  ]);

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
    discardPendingHighlight(highlightId);

    syncDOMToFrozenSegments();

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
      anchorTop: resolveHighlightAnchorTop(
        highlight,
        getSelectionFallbackTop(container, rect, containerRect, scrollTopForAnchor),
      ),
      groupId: highlight.span?.endGroupId || highlight.groupId, // END-Gruppe für Response-Position
      parentResponseId,
      span: highlight.span, // Multi-Group Info für Closure-Registrierung
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
  }, [
    highlights,
    showMenuAtSelection,
    transcriptScrollTop,
    discardPendingHighlight,
    syncDOMToFrozenSegments,
    resolveHighlightAnchorTop,
    getSelectionFallbackTop,
  ]);

  // Schließe eine einzelne Gruppe
  const registerGroupClosure = useCallback((groupId: string) => {
    if (!groupId.startsWith("group-")) return;
    const group = groupedSegmentsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    const closeAt = group.lastTimestamp;
    setGroupCloseTimestamps((prev) => {
      const current = prev[groupId];
      if (current !== undefined && current >= closeAt) return prev;
      return { ...prev, [groupId]: closeAt };
    });
  }, [setGroupCloseTimestamps]);

  // Schließe alle Gruppen eines Highlights (Single oder Multi-Group)
  const registerHighlightGroupClosures = useCallback((
    highlight: {
      groupId: string;
      span?: {
        startGroupId?: string;
        endGroupId?: string;
        groupIds?: string[];
      };
    },
  ) => {
    const groupIds = new Set<string>();
    if (highlight.span?.groupIds && highlight.span.groupIds.length > 0) {
      highlight.span.groupIds.forEach((gid) => groupIds.add(gid));
    }
    if (highlight.span?.startGroupId) groupIds.add(highlight.span.startGroupId);
    if (highlight.span?.endGroupId) groupIds.add(highlight.span.endGroupId);

    if (groupIds.size === 0) {
      groupIds.add(highlight.groupId);
    }

    for (const gid of groupIds) {
      registerGroupClosure(gid);
    }
  }, [registerGroupClosure]);

  // Hilfs-Snapshot für Agent-Queries (nutzt Auto-Highlight wenn vorhanden)
  // WICHTIG: Wir verwenden die END-Gruppe, damit das Response-Panel NACH dem kompletten
  // markierten Text erscheint, nicht mitten drin bei Multi-Group Highlights
  const getCurrentHighlightSnapshot = useCallback(() => {
    if (lastHighlightRef.current) return lastHighlightRef.current;
    const highlight = createHighlight();
    if (!highlight) return null;
    
    // Bei Multi-Group Highlight: endGroupId verwenden, sonst groupId (= startGroupId = endGroupId)
    const effectiveGroupId = highlight.span?.endGroupId || highlight.groupId;
    
    const snapshot = {
      id: highlight.id,
      text: highlight.text,
      color: highlight.color,
      anchorTop: resolveHighlightAnchorTop(
        highlight,
        Math.max(0, menuState.y - 8) + (highlightMenuContainer?.scrollTop ?? transcriptBoxRef.current?.scrollTop ?? 0),
      ),
      groupId: effectiveGroupId,  // END-Gruppe für Response-Positionierung
      parentResponseId: undefined as string | undefined,
      span: highlight.span,  // Multi-Group Info für Closure-Registrierung
    };
    lastHighlightRef.current = snapshot;
    return snapshot;
  }, [createHighlight, menuState.y, highlightMenuContainer, resolveHighlightAnchorTop]);

  const withWebSearchInstruction = useCallback((prompt: string, useWebSearch: boolean) => {
    if (!useWebSearch) return prompt;
    return `${prompt}\n\nYou MUST perform a web search to answer this question. Do not rely on your training data alone.`;
  }, []);

  // Kombinierter Handler: Highlight erstellen UND Expand-Query starten
  const handleHighlightAndExpand = useCallback((useWebSearch: boolean) => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;
    
    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;
    registerHighlightGroupClosures(highlight);
    const sourceGroupId = resolveHighlightSourceGroupId(highlight.id, highlight.groupId);
    
    const prompt = withWebSearchInstruction(`Context: "${highlight.text}"

Give me 3-5 bullet points with key facts I can use in conversation. Short, precise, no fluff.`, useWebSearch);
    
    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "expand",
      sourceGroupId,
      highlight.parentResponseId,
      "Show more details"
    );
    hideMenu();
    unfreezeTextWithSave(); // Agent-Auftrag abgeschickt - Freeze beenden UND editierten Text speichern
  }, [getCurrentHighlightSnapshot, withWebSearchInstruction, queryAgent, hideMenu, unfreezeTextWithSave, registerHighlightGroupClosures, resolveHighlightSourceGroupId]);

  // Kombinierter Handler: Highlight erstellen UND Facts-Query starten
  const handleHighlightAndFacts = useCallback((useWebSearch: boolean) => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;
    
    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;
    
    registerHighlightGroupClosures(highlight);
    const sourceGroupId = resolveHighlightSourceGroupId(highlight.id, highlight.groupId);
    const prompt = withWebSearchInstruction(`Context: "${highlight.text}"

Find 2-3 similar deal examples from Microsoft Switzerland in your index. One line each, max. Focus on facts such as contract scope, number of users, etc.`, useWebSearch);
    
    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "facts",
      sourceGroupId,
      highlight.parentResponseId,
      "Find similar examples"
    );
    hideMenu();
    unfreezeTextWithSave(); // Agent-Auftrag abgeschickt - Freeze beenden UND editierten Text speichern
  }, [getCurrentHighlightSnapshot, withWebSearchInstruction, queryAgent, hideMenu, unfreezeTextWithSave, registerHighlightGroupClosures, resolveHighlightSourceGroupId]);

  // Custom Prompt Handler (Enter im Textfeld)
  const handleCustomPrompt = useCallback((customPrompt: string, useWebSearch: boolean) => {
    const highlight = getCurrentHighlightSnapshot();
    if (!highlight) return;

    // Highlight ist jetzt bestätigt (Agent-Query gestartet) - nicht mehr als pending markieren
    pendingHighlightIdRef.current = null;

    registerHighlightGroupClosures(highlight);
    const sourceGroupId = resolveHighlightSourceGroupId(highlight.id, highlight.groupId);
    const prompt = withWebSearchInstruction(`Context: "${highlight.text}"

${customPrompt}`, useWebSearch);

    queryAgent(
      prompt, 
      highlight.id, 
      highlight.text, 
      highlight.color, 
      highlight.anchorTop, 
      "expand",
      sourceGroupId,
      highlight.parentResponseId,
      "Custom instruction",
      customPrompt
    );
    hideMenu();
    unfreezeTextWithSave(); // Agent-Auftrag abgeschickt - Freeze beenden UND editierten Text speichern
  }, [getCurrentHighlightSnapshot, withWebSearchInstruction, queryAgent, hideMenu, unfreezeTextWithSave, registerHighlightGroupClosures, resolveHighlightSourceGroupId]);

  // Handler fr das Schlieen des Mens - pending Highlight wird nur freigegeben
  // Wenn ein pending Highlight existiert, nur den pending-Status lschen
  const handleCloseMenu = useCallback(() => {
    discardPendingHighlight();
    hideMenu();
    // KEIN unfreezeText() - Freeze bleibt bis Klick au?erhalb
  }, [hideMenu, discardPendingHighlight]);

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

      discardPendingHighlight();

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
          anchorTop: resolveHighlightAnchorTop(
            highlight,
            getSelectionFallbackTop(container, rect, containerRect, transcriptScrollTopNow),
          ),
          groupId: highlight.span?.endGroupId || highlight.groupId, // END-Gruppe für Response-Position
          parentResponseId,
          span: highlight.span, // Multi-Group Info für Closure-Registrierung
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
  }, [
    createHighlightFromSelection,
    showMenuAtSelection,
    transcriptScrollTop,
    discardPendingHighlight,
    syncDOMToFrozenSegments,
    resolveHighlightAnchorTop,
    getSelectionFallbackTop,
  ]);

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
    unfreezeTextWithSave(); // Text kopiert - Freeze beenden UND editierten Text speichern
  }, [menuState.selectedText, menuState.highlightId, highlights, handleCloseMenu, unfreezeTextWithSave]);


  // Handler fuer Delete - loescht markierten Text aus dem Transkript
  const handleDelete = useCallback(() => {
    const highlightId = menuState.highlightId || lastHighlightRef.current?.id;
    const highlight = highlightId ? highlights.find((h) => h.id === highlightId) : undefined;

    if (disableDeleteInMenu) {
      handleCloseMenu();
      return;
    }

    const isTranscriptHighlight = !highlight
      ? true
      : highlight.groupId.startsWith("group-") ||
        Boolean(
          highlight.span &&
            ((highlight.span.groupIds && highlight.span.groupIds.some((id) => id.startsWith("group-"))) ||
              highlight.span.startGroupId.startsWith("group-") ||
              highlight.span.endGroupId.startsWith("group-")),
        );

    if (highlight && !isTranscriptHighlight) {
      handleCloseMenu();
      return;
    }

    const overlaySource = isTextFrozen && Object.keys(transientEditOverlayRef.current).length > 0
      ? transientEditOverlayRef.current
      : editedGroupTexts;
    const groupTextMap = buildGroupTextMap(segments, groupCloseTimestamps, overlaySource);

    const applyDeletion = (
      groupId: string,
      startOffset: number,
      endOffset: number,
      updates: Map<string, string>,
      oldTexts: Map<string, string>,
    ) => {
      const currentText = groupTextMap.get(groupId);
      if (currentText === undefined) return;
      const start = Math.max(0, Math.min(startOffset, currentText.length));
      const end = Math.max(start, Math.min(endOffset, currentText.length));
      if (start === end) return;
      const nextRaw = currentText.slice(0, start) + currentText.slice(end);
      const nextText = normalizeGroupText(nextRaw);
      updates.set(groupId, nextText);
      if (!oldTexts.has(groupId)) {
        oldTexts.set(groupId, currentText);
      }
    };

    if (highlight) {
      const updates = new Map<string, string>();
      const oldGroupTexts = new Map<string, string>();

      if (highlight.span) {
        const span = highlight.span;
        let spanGroupIds = span.groupIds && span.groupIds.length > 0 ? [...span.groupIds] : [];
        if (spanGroupIds.length === 0 && groupedSegmentsRef.current.length > 0) {
          const ordered = groupedSegmentsRef.current.map((group) => group.id);
          const startIndex = ordered.indexOf(span.startGroupId);
          const endIndex = ordered.indexOf(span.endGroupId);
          if (startIndex !== -1 && endIndex !== -1) {
            const from = Math.min(startIndex, endIndex);
            const to = Math.max(startIndex, endIndex);
            spanGroupIds = ordered.slice(from, to + 1);
          }
        }
        if (spanGroupIds.length === 0) {
          spanGroupIds = Array.from(new Set([span.startGroupId, span.endGroupId].filter(Boolean)));
        }

        spanGroupIds.forEach((groupId) => {
          const currentText = groupTextMap.get(groupId) || "";
          if (groupId === span.startGroupId && groupId === span.endGroupId) {
            applyDeletion(groupId, span.startOffset, span.endOffset, updates, oldGroupTexts);
            return;
          }
          if (groupId === span.startGroupId) {
            applyDeletion(groupId, span.startOffset, currentText.length, updates, oldGroupTexts);
            return;
          }
          if (groupId === span.endGroupId) {
            applyDeletion(groupId, 0, span.endOffset, updates, oldGroupTexts);
            return;
          }
          applyDeletion(groupId, 0, currentText.length, updates, oldGroupTexts);
        });
      } else {
        applyDeletion(highlight.groupId, highlight.localStartOffset, highlight.localEndOffset, updates, oldGroupTexts);
      }

      if (updates.size > 0) {
        updateSegmentsFromEdit(updates, groupCloseTimestamps);
        updateHighlightsForGroupEdit(updates, oldGroupTexts);
        updateFormatsForGroupEdit(updates, oldGroupTexts);

        setEditedGroupTexts((prev) => {
          const next = { ...prev };
          for (const [groupId, value] of updates) {
            if (value) {
              next[groupId] = value;
            } else {
              delete next[groupId];
            }
          }
          return next;
        });

        setEditedGroupBases((prev) => {
          const next = { ...prev };
          for (const [groupId, value] of updates) {
            const oldText = oldGroupTexts.get(groupId);
            if (oldText && value) {
              next[groupId] = normalizeGroupText(oldText);
            } else {
              delete next[groupId];
            }
          }
          return next;
        });

        if (highlightId) {
          removeResponseByHighlight(highlightId);
          removeHighlight(highlightId);
          if (lastHighlightRef.current?.id === highlightId) {
            lastHighlightRef.current = null;
          }
        }

        handleCloseMenu();
        unfreezeText();
        window.requestAnimationFrame(releaseFocus);
        return;
      }
    }

    // Mehrere Quellen fuer den zu loeschenden Text
    let text = menuState.selectedText;

    // Fallback 1: highlight object only when selection is missing
    if (!text && highlightId) {
      if (highlight) {
        text = highlight.text;
      }
    }

    // Fallback 2: DOM markers (including overlaps) when still missing
    if (!text && highlightId) {
      const markEls = Array.from(
        document.querySelectorAll("mark[data-highlight-id], mark[data-highlight-ids]")
      ) as HTMLElement[];
      const matched = markEls.filter((el) => {
        const primaryId = el.getAttribute("data-highlight-id");
        if (primaryId === highlightId) return true;
        const ids = el.getAttribute("data-highlight-ids");
        return ids ? ids.split(",").includes(highlightId) : false;
      });

      if (matched.length > 0) {
        const joined = matched
          .map((el) => el.textContent || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (joined) {
          text = joined;
        }
      }
    }

    if (!text) {
      console.warn("[Delete] No text to delete");
      return;
    }

    console.log("[Delete] Deleting text:", text.slice(0, 50) + (text.length > 50 ? "..." : ""));

    // Text aus Transkript loeschen
    deleteTextFromTranscript(text);

    // Zugehoerige Highlights und Antworten entfernen
    if (highlightId) {
      removeResponseByHighlight(highlightId);
      removeHighlight(highlightId);
      if (lastHighlightRef.current?.id === highlightId) {
        lastHighlightRef.current = null;
      }
    }

    // Menue schliessen und Highlight entfernen (kein Agent getriggert)
    handleCloseMenu();
    unfreezeText(); // Text geloescht - Freeze beenden
    window.requestAnimationFrame(releaseFocus);
  }, [
    menuState.selectedText,
    menuState.highlightId,
    highlights,
    disableDeleteInMenu,
    segments,
    groupCloseTimestamps,
    editedGroupTexts,
    isTextFrozen,
    updateSegmentsFromEdit,
    updateHighlightsForGroupEdit,
    updateFormatsForGroupEdit,
    setEditedGroupTexts,
    setEditedGroupBases,
    deleteTextFromTranscript,
    removeResponseByHighlight,
    removeHighlight,
    handleCloseMenu,
    unfreezeText,
    releaseFocus,
  ]);

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
  // WICHTIG: Bestehende Session wird ERWEITERT, nicht zurückgesetzt
  // Nur "Clear" löscht alles
  const handleStart = async () => {
    unfreezeText();
    releaseFocus();
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

    // NICHT mehr löschen - Session wird erweitert!
    // clearHighlights();
    // clearFormats();
    // clearAuraResponses();
    // setEditedGroupTexts({});
    // setEditedGroupBases({});
    // setGroupCloseTimestamps({});
    
    // Nur transiente Overlays und Refs zurücksetzen
    if (Object.keys(transientEditOverlayRef.current).length > 0) {
      transientEditOverlayRef.current = {};
      setTransientEditOverlayVersion((prev) => prev + 1);
    }
    lastHighlightRef.current = null;
    pendingHighlightIdRef.current = null;

    start(micDeviceId, speakerInput);
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
  // ABER: Neue Segmente (nach dem Freeze) werden trotzdem angezeigt!
  const frozenTimestampRef = useRef<number | null>(null);
  
  // Berechne displaySegments: frozen + neue Segmente
  const displaySegments = useMemo(() => {
    if (!isTextFrozen || !frozenSegmentsRef.current) {
      frozenTimestampRef.current = null;
      return segments;
    }
    
    // Merke den höchsten Timestamp der gefrorenen Segmente
    if (frozenTimestampRef.current === null && frozenSegmentsRef.current.length > 0) {
      frozenTimestampRef.current = Math.max(...frozenSegmentsRef.current.map(s => s.timestamp));
    }
    
    // Finde Segmente die NACH dem Freeze dazukamen
    const newSegments = frozenTimestampRef.current 
      ? segments.filter(s => s.timestamp > frozenTimestampRef.current!)
      : [];
    
    // Kombiniere: frozen segments + neue segments
    return [...frozenSegmentsRef.current, ...newSegments];
  }, [isTextFrozen, segments, frozenSegmentsVersion]);
  
  // Set der Gruppen-IDs die nach dem Freeze dazukamen (für contentEditable=false)
  const frozenGroupIdsRef = useRef<Set<string> | null>(null);
  const newGroupIds = useMemo(() => {
    if (!isTextFrozen || !frozenTimestampRef.current) {
      frozenGroupIdsRef.current = null;
      return new Set<string>();
    }
    
    // Beim ersten Freeze: Speichere alle aktuellen Gruppen-IDs
    if (frozenGroupIdsRef.current === null && frozenSegmentsRef.current) {
      const frozenIds = new Set<string>();
      frozenSegmentsRef.current.forEach(seg => {
        frozenIds.add(makeTranscriptGroupId(seg));
      });
      frozenGroupIdsRef.current = frozenIds;
    }
    
    // Alle Gruppen-IDs die NICHT in frozenGroupIds sind
    const newIds = new Set<string>();
    segments.forEach(seg => {
      if (seg.timestamp > frozenTimestampRef.current!) {
        newIds.add(makeTranscriptGroupId(seg));
      }
    });
    return newIds;
  }, [isTextFrozen, segments]);
    
  const sortedSegments = useMemo(() => 
    [...displaySegments].sort((a, b) => a.timestamp - b.timestamp),
    [displaySegments]
  );

  // Gruppiere ALLE Segmente (final + live): Neue Gruppe bei Speaker-Wechsel ODER lange Pause
  const PAUSE_THRESHOLD_MS = GROUP_PAUSE_THRESHOLD_MS;
  
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
    
    for (const seg of sortedSegments) {
      const lastGroup = groups[groups.length - 1];
      const pauseSinceLast = lastGroup ? seg.timestamp - lastGroup.lastTimestamp : 0;
      const sourceChanged = !lastGroup || lastGroup.source !== seg.source;
      const closedAt = lastGroup ? groupCloseTimestamps[lastGroup.id] : undefined;
      const groupClosed = closedAt !== undefined && seg.timestamp > closedAt;
      
      
      if (sourceChanged || pauseSinceLast > PAUSE_THRESHOLD_MS || groupClosed) {
        // Neue Gruppe starten mit eindeutiger ID
        groups.push({
          id: makeTranscriptGroupId(seg),
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

    const transientOverlay = transientEditOverlayRef.current;
    const overlaySource = isTextFrozen && Object.keys(transientOverlay).length > 0
      ? transientOverlay
      : editedGroupTexts;

    if (Object.keys(overlaySource).length > 0) {
      for (const group of groups) {
        const override = overlaySource[group.id];
        if (override !== undefined) {
          group.texts = [override];
        }
      }
    }

    return groups;
  }, [sortedSegments, groupCloseTimestamps, editedGroupTexts, isTextFrozen, transientEditOverlayVersion]);

  useEffect(() => {
    groupedSegmentsRef.current = groupedSegmentsWithOffsets;
  }, [groupedSegmentsWithOffsets]);

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
      const scrollTop = transcriptBox.scrollTop;
      const scrollLeft = transcriptBox.scrollLeft;
      const next: Record<string, number> = {};

      const highlightAnchors = new Map<string, { top: number; bottom: number; left: number; right: number }>();
      const highlightGroupIds = new Map<string, Set<string>>();
      const highlightTargets = highlightAnchorTargetsRef.current;
      const markEls = Array.from(
        transcriptBox.querySelectorAll("mark[data-highlight-id], mark[data-highlight-ids]")
      ) as HTMLElement[];

      for (const markEl of markEls) {
        const primaryId = markEl.getAttribute("data-highlight-id");
        const idsAttr = markEl.getAttribute("data-highlight-ids");
        const ids = new Set<string>();
        if (primaryId) ids.add(primaryId);
        if (idsAttr) {
          idsAttr.split(",").forEach((id) => {
            const trimmed = id.trim();
            if (trimmed) ids.add(trimmed);
          });
        }
        if (ids.size === 0) continue;

        const rect = markEl.getBoundingClientRect();
        const top = rect.top - containerRect.top + scrollTop;
        const bottom = rect.bottom - containerRect.top + scrollTop;
        const left = rect.left - containerRect.left + scrollLeft;
        const right = rect.right - containerRect.left + scrollLeft;

        const groupId = markEl.closest("[data-group-id]")?.getAttribute("data-group-id") || "";

        for (const id of ids) {
          if (groupId.startsWith("group-")) {
            if (!highlightGroupIds.has(id)) {
              highlightGroupIds.set(id, new Set<string>());
            }
            highlightGroupIds.get(id)!.add(groupId);
          }

          const existingAnchor = highlightAnchors.get(id);
          if (!existingAnchor || bottom > existingAnchor.bottom) {
            highlightAnchors.set(id, { top, bottom, left, right });
          } else if (top < existingAnchor.top) {
            highlightAnchors.set(id, { ...existingAnchor, top });
          }
        }
      }

      for (const response of auraResponses) {
        const anchorTarget = highlightTargets.get(response.highlightId);
        const highlightGroups = highlightGroupIds.get(response.highlightId);
        const isMultiGroup = Boolean(anchorTarget?.useBottom || (highlightGroups && highlightGroups.size > 1));
        let anchorTop: number | undefined;

        if (isMultiGroup && anchorTarget?.targetGroupId && anchorTarget.targetGroupId.startsWith("group-")) {
          const groupEl = transcriptBox.querySelector(
            `[data-group-id="${anchorTarget.targetGroupId}"]`,
          ) as HTMLElement | null;
          if (groupEl) {
            const rect = groupEl.getBoundingClientRect();
            anchorTop = rect.bottom - containerRect.top + scrollTop;
          }
        }

        if (anchorTop === undefined) {
          const highlightAnchor = highlightAnchors.get(response.highlightId);
          if (highlightAnchor) {
            anchorTop = isMultiGroup ? highlightAnchor.bottom : highlightAnchor.top;
          }
        }

        next[response.id] = anchorTop ?? response.anchorTop;
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
    const mo = new MutationObserver(() => schedule());
    mo.observe(transcriptBox, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", schedule);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
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
    
    let lastBottom = -Infinity;
    return sorted.map((response) => {
      const panelHeight = auraPanelHeights[response.id] ?? 0;
      const minTop = lastBottom === -Infinity
        ? response.currentAnchorTop
        : Math.max(response.currentAnchorTop, lastBottom + AURA_PANEL_GAP);
      const adjustedTop = Math.max(0, minTop);
      lastBottom = adjustedTop + panelHeight;
      return {
        ...response,
        adjustedTop,
      };
    });
  }, [auraResponses, dynamicAnchorTops, auraPanelHeights]);

  const auraSpacerHeight = useMemo(() => {
    const baseHeight = transcriptScrollHeight || transcriptBoxRef.current?.scrollHeight || 0;
    let required = 0;

    for (const r of positionedAuraResponses) {
      const h = auraPanelHeights[r.id] ?? 0;
      required = Math.max(required, r.adjustedTop + h + AURA_PANEL_GAP);
    }

    return Math.max(baseHeight, required);
  }, [positionedAuraResponses, auraPanelHeights, transcriptScrollHeight]);

  const inlineResponseChains = useMemo(() => {
    if (auraResponses.length === 0) return [];

    const responsesWithGroup = auraResponses.map((r) => ({
      ...r,
      sourceGroupId: resolveHighlightSourceGroupId(r.highlightId, r.sourceGroupId),
    }));

    const getChainedResponses = (parentId: string): typeof responsesWithGroup => {
      const children = responsesWithGroup.filter((r) => r.insertAfterResponseId === parentId);
      return children.flatMap((child) => [child, ...getChainedResponses(child.id)]);
    };

    const roots = responsesWithGroup.filter(
      (r) => !r.insertAfterResponseId && r.sourceGroupId.startsWith("group-")
    );

    return roots.map((root) => [root, ...getChainedResponses(root.id)]);
  }, [auraResponses, resolveHighlightSourceGroupId]);

  // Note: positionedInlineResponses, inlineResponseSpacingByHighlightId, 
  // inlineResponseSpacingByGroupId und inlineSpacerHeight wurden entfernt.
  // Responses werden jetzt direkt im Dokumentfluss nach ihrer Gruppe gerendert,
  // ohne absolute Positionierung. Das verhindert Überlappungen automatisch.

  useLayoutEffect(() => {
    if (!transcriptBoxRef.current) return;
    const { scrollTop, scrollHeight } = transcriptBoxRef.current;
    setTranscriptScrollTop(scrollTop);
    setTranscriptScrollHeight(scrollHeight);
  }, [inlineResponseChains]);
  
  const handleAskAuraFullTranscript = useCallback(() => {
    if (segments.length === 0) return;
    const prompt = `Provide key facts and highlights based on this transcript:\n${mergedTranscript}`;
    // Für Full-Transcript: Generiere temporäre ID
    const tempId = `full-${Date.now()}`;
    queryAgent(prompt, tempId, "Full Transcript Analysis", 1, 0, "full", "", undefined, "Analyze full transcript");
  }, [segments.length, mergedTranscript, queryAgent]);

  // Clear highlights when clearing transcript
  const handleClear = useCallback(() => {
    skipNextFreezeSaveRef.current = isTextFrozen;
    hideMenu();
    unfreezeText();
    resetTranscript();
    clearErrors();
    clearHighlights();
    clearFormats();
    clearAuraResponses();
    setEditedGroupTexts({});
    setEditedGroupBases({});
    if (Object.keys(transientEditOverlayRef.current).length > 0) {
      transientEditOverlayRef.current = {};
      setTransientEditOverlayVersion((prev) => prev + 1);
    }
    setGroupCloseTimestamps({});
    lastHighlightRef.current = null;
    pendingHighlightIdRef.current = null;
  }, [
    resetTranscript,
    clearErrors,
    clearHighlights,
    clearFormats,
    clearAuraResponses,
    setEditedGroupTexts,
    setEditedGroupBases,
    setGroupCloseTimestamps,
    setTransientEditOverlayVersion,
    hideMenu,
    unfreezeText,
    isTextFrozen,
  ]);

  const handleClearAuraResponses = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    hideMenu();
    clearAuraResponses();
  }, [clearAuraResponses, hideMenu]);

  const handleClearHighlightsAndResponses = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    hideMenu();
    clearHighlights();
    clearAuraResponses();
    lastHighlightRef.current = null;
    pendingHighlightIdRef.current = null;
  }, [clearHighlights, clearAuraResponses, hideMenu]);

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
        <UserMenu />
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
            <div className="muted" style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
              Active (server): {activeTranscriptionModelLabel}
            </div>
            {(status === "running" || status === "connecting") && (
              <span className="agent-switching" style={{ fontSize: 10, opacity: 0.7 }}>
                Stop to change
              </span>
            )}
          </div>
        </div>
        
        {/* Agent Selection - oberhalb Audio Settings */}
        <div className="panel sidebar-panel">
          <h3>AI Agent / Workflow / MFA</h3>
          {agents.length === 0 && workflows.length === 0 && mfas.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>Loading agents...</p>
          ) : (
            <div className="agent-selector">
              <select
                value={currentAgentId || ""}
                onChange={(e) => handleAgentSwitch(Number(e.target.value))}
                disabled={agentSwitching}
                className="agent-dropdown"
              >
                {/* Agent Group */}
                {agents.length > 0 && (
                  <optgroup label="🤖 Agent">
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.label || agent.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Workflow Group */}
                {workflows.length > 0 && (
                  <optgroup label="⚡ Workflow">
                    {workflows.map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.label || workflow.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* MFA Group */}
                {mfas.length > 0 && (
                  <optgroup label="🧩 MFA">
                    {mfas.map(mfa => (
                      <option key={mfa.id} value={mfa.id}>
                        {mfa.label || mfa.name}
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
              tabCaptureError={tabCapture.error}
              micLevel={volumeLevels.mic}
              spkLevel={volumeLevels.speaker}
              micMuted={micMuted}
              spkMuted={spkMuted}
              onMicMuteToggle={() => setMicMuted(!micMuted)}
              onSpkMuteToggle={() => setSpkMuted(!spkMuted)}
              isRunning={status === "running"}
            />

            <div className="buttons">
              <button
                className={status !== "running" && status !== "connecting" ? "btn-start" : ""}
                onClick={handleStart}
                disabled={!canStart}
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
              onInput={handleInput}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onClick={handleHighlightClick}
              onContextMenu={handleContextMenu}
              contentEditable={isTextFrozen}
              suppressContentEditableWarning={true}
              style={{ position: "relative" }}
            >
              {/* Content wird IMMER gerendert */}
              {displaySegments.length === 0 && !isTextFrozen && (
                <p className="muted">No input yet. Pick at least one audio source and hit Start, or click here to type.</p>
              )}
              {/* Gruppierte Segmente - Tag nur bei Speaker-Wechsel, Cursor bei Live-Content */}
              {groupedSegmentsWithOffsets.map((group) => {
                const groupText = group.texts.join(" ");
                
                // Prüfe ob diese Gruppe nach dem Freeze dazukam
                const isNewAfterFreeze = isTextFrozen && newGroupIds.has(group.id);
                
                // Finde alle Response-Chains für diese Gruppe
                const responseChainsForGroup = inlineResponseChains.filter(
                  chain => chain[0]?.sourceGroupId === group.id
                );
                
                // Source-Tag Label bestimmen: MIC, SPK oder KEY
                const sourceTagLabel = group.source === "mic" ? "MIC" : group.source === "keyboard" ? "KEY" : "SPK";
                
                return (
                  <div key={group.id} contentEditable={isNewAfterFreeze ? false : undefined} suppressContentEditableWarning>
                    {/* Das Transkript-Segment */}
                    <div className={`final-line source-${group.source} ${group.isSourceChange ? 'has-tag' : 'no-tag'}${isNewAfterFreeze ? ' new-after-freeze' : ''}`}>
                      {group.isSourceChange && (
                        <span className="source-tag">{sourceTagLabel}</span>
                      )}
                      <span className="segment-text">
                        {/* 
                          IMMER HighlightedText verwenden - KEIN TypewriterText mehr!
                          TypewriterText verfälscht textContent und macht Offset-Berechnung unmöglich.
                          
                          data-group-id NUR auf diesem span mit dem reinen Text.
                          Cursor ist AUSSERHALB dieses spans.
                        */}
                        <span data-group-id={group.id}>
                          <HighlightedText
                            text={groupText}
                            highlights={highlights}
                            formats={formats}
                            groupId={group.id}
                          />
                        </span>
                        {group.hasLive && <span className="cursor">|</span>}
                      </span>
                    </div>
                    {/* Inline Responses für diese Gruppe - im normalen Dokumentfluss */}
                    {responseChainsForGroup.length > 0 && (
                      <div className="inline-responses-for-group" contentEditable={false}>
                        {responseChainsForGroup.flat().map((response) => (
                          <div key={response.id} className="inline-response-block">
                            <InlineAgentResponse
                              responseId={response.id}
                              taskLabel={response.taskLabel}
                              taskDetail={response.taskDetail}
                              prompt={response.prompt}
                              result={response.result}
                              loading={response.loading}
                              error={response.error}
                              color={response.color}
                              highlights={highlights}
                              onClose={handleRemoveAuraResponse}
                            />
                          </div>
                        ))}
                      </div>
                    )}
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
                  <div className="aura-responses-toolbar">
                    <button
                      className="btn-ghost aura-clear-all-btn"
                      onClick={handleClearAuraResponses}
                      title="Clear all Context Pilot windows"
                    >
                      Clear all
                    </button>
                  </div>
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
                          prompt={response.prompt}
                          onClose={handleRemoveAuraResponse}
                          onAskFollowUp={askFollowUp}
                          highlights={highlights}
                          sourceGroupId={`aura-source-${response.id}`}
                          followUps={response.followUps}
                          agentsUsed={response.agentsUsed}
                          routing={response.routing}
                          startTime={response.startTime}
                          elapsedMs={response.elapsedMs}
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
              <button className="btn-ghost" onClick={handleClearHighlightsAndResponses} style={{ padding: "4px 8px", fontSize: 12 }}>
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
              disabled={segments.length === 0}
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
