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
    groupIds: string[];      // Alle Gruppen, die die Selektion berührt (inkl. Mittelstücke)
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
  const buildHighlightFromRange = useCallback((
    range: Range,
    text: string,
    container: HTMLElement,
    color?: HighlightColor,
  ): Highlight | null => {
    if (!text.trim()) return null;
    if (!container.contains(range.commonAncestorContainer)) return null;

    // Hilfsfunktion: nächster data-group-id Vorfahre
    const findGroup = (node: Node | null): HTMLElement | null => {
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.hasAttribute('data-group-id')) {
            return el;
          }
        }
        node = node.parentNode;
      }
      return null;
    };

    const startGroup = findGroup(range.startContainer);
    const endGroup = findGroup(range.endContainer);

    if (!startGroup || !endGroup) {
      console.warn("[buildHighlightFromRange] Could not find group element(s) with data-group-id!");
      return null;
    }

    const startGroupId = startGroup.getAttribute('data-group-id')!;
    const endGroupId = endGroup.getAttribute('data-group-id')!;

    // Wenn gleiche Gruppe, wie bisher
    if (startGroupId === endGroupId) {
      const groupId = startGroupId;
      try {
        const preRange = document.createRange();
        preRange.setStart(startGroup, 0);
        preRange.setEnd(range.startContainer, range.startOffset);
        const localStartOffset = preRange.toString().length;
        const localEndOffset = localStartOffset + text.length;

        const highlightColor = color || getNextColor();
        const highlight: Highlight = {
          id: generateId(),
          text,
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
      const preRangeStart = document.createRange();
      preRangeStart.setStart(startGroup, 0);
      preRangeStart.setEnd(range.startContainer, range.startOffset);
      const startOffset = preRangeStart.toString().length;

      const preRangeEnd = document.createRange();
      preRangeEnd.setStart(endGroup, 0);
      preRangeEnd.setEnd(range.endContainer, range.endOffset);
      const endOffset = preRangeEnd.toString().length;

      // Alle Gruppen im Container in DOM-Reihenfolge sammeln (einmalig je ID)
      const orderedGroupIds: string[] = [];
      container.querySelectorAll<HTMLElement>('[data-group-id]').forEach((el) => {
        const id = el.getAttribute('data-group-id');
        if (id && !orderedGroupIds.includes(id)) {
          orderedGroupIds.push(id);
        }
      });

      const startIndex = orderedGroupIds.indexOf(startGroupId);
      const endIndex = orderedGroupIds.indexOf(endGroupId);

      if (startIndex === -1 || endIndex === -1) {
        console.warn("[buildHighlightFromRange] Could not determine group order for multi-group highlight");
        return null;
      }

      const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      const groupsInRange = orderedGroupIds.slice(from, to + 1);

      const highlightColor = color || getNextColor();
      const highlight: Highlight = {
        id: generateId(),
        text,
        color: highlightColor,
        groupId: startGroupId,
        localStartOffset: startOffset,
        localEndOffset: Number.POSITIVE_INFINITY, // Marker: wird per span genutzt
        span: {
          startGroupId,
          endGroupId,
          startOffset,
          endOffset,
          groupIds: groupsInRange,
        },
        timestamp: Date.now(),
      };

      setHighlights((prev) => [...prev, highlight]);
      return highlight;
    } catch (e) {
      console.warn("[buildHighlightFromRange] Could not calculate cross-group offsets:", e);
      return null;
    }
  }, [getNextColor]);

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

    const text = opts?.selectedText ?? selection?.toString() ?? "";
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
  }, []);

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
