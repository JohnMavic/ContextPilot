import { useState, useCallback, useRef } from "react";

export type HighlightColor = 1 | 2 | 3 | 4 | 5;

export interface Highlight {
  id: string;
  text: string;
  color: HighlightColor;
  // Lokale Offsets relativ zu einer Gruppe ODER multiGroup
  groupId: string;        // ID der primären Gruppe
  localStartOffset: number;  // Start-Offset im Gruppen-Text
  localEndOffset: number;    // End-Offset im Gruppen-Text
  span?: {
    startGroupId: string;
    endGroupId: string;
    startOffset: number;
    endOffset: number;
    groupIds?: string[];
  };
  timestamp: number;
}

interface HighlightMenuState {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  selectedText: string;
  highlightColor?: HighlightColor;
  highlightId?: string;
  range: Range | null;
}

export function useHighlights() {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [menuState, setMenuState] = useState<HighlightMenuState>({
    visible: false,
    x: 0,
    y: 0,
    width: 0,
    selectedText: "",
    range: null,
  });
  const [nextColor, setNextColor] = useState<HighlightColor>(1);
  const containerRef = useRef<HTMLElement | null>(null);

  // Cycle through colors: 1=rot, 2=grün, 3=orange, 4=gelb, 5=blau
  const getNextColor = useCallback((): HighlightColor => {
    const color = nextColor;
    setNextColor((prev) => ((prev % 5) + 1) as HighlightColor);
    return color;
  }, [nextColor]);

  // Generate unique ID
  const generateId = () => `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Erstellt ein Highlight direkt aus einem Range/Text.
   * Wird fA¬r das sofortige Auto-Highlighting beim MouseUp genutzt.
   */
  const resolveSelection = useCallback((range: Range, container: HTMLElement) => {
    const groupElements = Array.from(container.querySelectorAll("[data-group-id]")) as HTMLElement[];
    if (groupElements.length === 0) return null;

    // Robust: Start/End kann auf SPK/MIC-Label liegen, daher Intersection nutzen.
    const intersecting = groupElements.filter((el) => {
      try {
        return range.intersectsNode(el);
      } catch {
        return false;
      }
    });

    if (intersecting.length === 0) return null;

    const startGroup = intersecting[0];
    const endGroup = intersecting[intersecting.length - 1];

    const startGroupId = startGroup.getAttribute("data-group-id");
    const endGroupId = endGroup.getAttribute("data-group-id");
    if (!startGroupId || !endGroupId) return null;

    let startIndex = groupElements.indexOf(startGroup);
    let endIndex = groupElements.indexOf(endGroup);
    if (startIndex === -1 || endIndex === -1) return null;
    if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

    const groupIds = groupElements
      .slice(startIndex, endIndex + 1)
      .map((el) => el.getAttribute("data-group-id"))
      .filter((id): id is string => Boolean(id));

    const startGroupText = startGroup.textContent || "";
    const endGroupText = endGroup.textContent || "";

    const computeOffsetWithinGroup = (groupEl: HTMLElement, boundaryNode: Node, boundaryOffset: number) => {
      try {
        const preRange = document.createRange();
        preRange.setStart(groupEl, 0);
        preRange.setEnd(boundaryNode, boundaryOffset);
        return preRange.toString().length;
      } catch {
        return 0;
      }
    };

    const startOffsetRaw = startGroup.contains(range.startContainer)
      ? computeOffsetWithinGroup(startGroup, range.startContainer, range.startOffset)
      : 0;

    const endOffsetRaw = endGroup.contains(range.endContainer)
      ? computeOffsetWithinGroup(endGroup, range.endContainer, range.endOffset)
      : endGroupText.length;

    const startOffset = Math.max(0, Math.min(startOffsetRaw, startGroupText.length));
    const endOffset = Math.max(0, Math.min(endOffsetRaw, endGroupText.length));

    let combined = "";
    if (startGroupId === endGroupId) {
      combined = startGroupText.slice(startOffset, endOffset);
    } else {
      const middleGroupElements = groupElements.slice(startIndex + 1, endIndex);
      const parts = [
        startGroupText.slice(startOffset),
        ...middleGroupElements.map((el) => (el.textContent || "").trim()).filter(Boolean),
        endGroupText.slice(0, endOffset),
      ].filter(Boolean);
      combined = parts.join(" ");
    }

    const normalizedText = combined.replace(/\\s+/g, " ").trim();
    if (!normalizedText) return null;

    return {
      startGroup,
      endGroup,
      startGroupId,
      endGroupId,
      groupIds,
      startOffset,
      endOffset,
      normalizedText,
    };
  }, []);

  const buildHighlightFromRange = useCallback((
    range: Range,
    text: string,
    container: HTMLElement,
    color?: HighlightColor,
  ): Highlight | null => {
    if (!text.trim()) return null;
    if (!container.contains(range.commonAncestorContainer)) return null;

    // Hilfsfunktion: nächster data-group-id Vorfahre
    const info = resolveSelection(range, container);
    if (!info) {
      console.warn("[buildHighlightFromRange] Could not resolve selection to transcript group text!");
      return null;
    }

    const { startGroupId, endGroupId, groupIds, startOffset, endOffset, normalizedText } = info;

    // Wenn gleiche Gruppe, wie bisher
    if (startGroupId === endGroupId) {
      const groupId = startGroupId;
      try {
        const localStartOffset = startOffset;
        const localEndOffset = endOffset;

        const highlightColor = color || getNextColor();
        const highlight: Highlight = {
          id: generateId(),
          text: normalizedText,
          color: highlightColor,
          groupId,
          localStartOffset,
          localEndOffset,
          timestamp: Date.now(),
        };

        setHighlights((prev) => [...prev, highlight]);
        return highlight;
      } catch (e) {
        console.warn("[buildHighlightFromRange] Could not calculate local offsets:", e);
        return null;
      }
    }

    // Multi-Group Highlight: speichere Spanne, damit wir beim Rendern splitten können
    try {
      const highlightColor = color || getNextColor();
      const highlight: Highlight = {
        id: generateId(),
        text: normalizedText,
        color: highlightColor,
        groupId: startGroupId,
        localStartOffset: startOffset,
        localEndOffset: Number.POSITIVE_INFINITY, // Marker: wird per span genutzt
        span: {
          startGroupId,
          endGroupId,
          startOffset,
          endOffset,
          groupIds,
        },
        timestamp: Date.now(),
      };

      setHighlights((prev) => [...prev, highlight]);
      return highlight;
    } catch (e) {
      console.warn("[buildHighlightFromRange] Could not calculate cross-group offsets:", e);
      return null;
    }
  }, [getNextColor, resolveSelection]);

  // Show context menu at selection position
  const showMenuAtSelection = useCallback((container: HTMLElement, opts?: {
    highlightColor?: HighlightColor;
    highlightId?: string;
    range?: Range;
    selectedText?: string;
    width?: number;
    x?: number;
    y?: number;
  }) => {
    const selection = window.getSelection();
    const range = opts?.range ?? (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
    if (!range) return;

    const resolved = resolveSelection(range, container);
    const text = opts?.selectedText ?? resolved?.normalizedText ?? selection?.toString() ?? "";
    if (!text) return;

    // Check if selection is within our container
    if (!container.contains(range.commonAncestorContainer)) return;

    // Position below selection
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const x = opts?.x ?? (rect.left - containerRect.left);
    const y = opts?.y ?? (rect.bottom - containerRect.top + 8);
    const width = opts?.width ?? rect.width;
    
    setMenuState({
      visible: true,
      x,
      y,
      width,
      selectedText: text,
      range: range.cloneRange(),
      highlightColor: opts?.highlightColor,
      highlightId: opts?.highlightId,
    });

    containerRef.current = container;
  }, [resolveSelection]);

  // Hide menu
  const hideMenu = useCallback(() => {
    setMenuState((prev) => ({ ...prev, visible: false }));
  }, []);

  // Create highlight from current selection - finds the group and calculates LOCAL offsets
  const createHighlight = useCallback((color?: HighlightColor): Highlight | null => {
    if (!menuState.range || !menuState.selectedText || !containerRef.current) {
      console.warn("[createHighlight] No range or selectedText!");
      return null;
    }

    const highlight = buildHighlightFromRange(menuState.range, menuState.selectedText, containerRef.current, color);
    if (!highlight) return null;

    hideMenu();
    
    // Clear selection
    window.getSelection()?.removeAllRanges();

    return highlight;
  }, [menuState, hideMenu, buildHighlightFromRange]);

  // Direktes Highlighten der aktuellen Auswahl (ohne Menu-State-AbhA¤ngigkeit)
  const createHighlightFromSelection = useCallback((
    range: Range,
    selectedText: string,
    container: HTMLElement,
    color?: HighlightColor,
  ) => {
    return buildHighlightFromRange(range, selectedText, container, color);
  }, [buildHighlightFromRange]);

  // Remove a highlight
  const removeHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }, []);

  // Clear all highlights
  const clearHighlights = useCallback(() => {
    setHighlights([]);
  }, []);

  return {
    highlights,
    menuState,
    showMenuAtSelection,
    hideMenu,
    createHighlight,
    createHighlightFromSelection,
    removeHighlight,
    clearHighlights,
    setNextColor,
  };
}
