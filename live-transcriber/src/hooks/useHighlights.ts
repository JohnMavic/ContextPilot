import { useState, useCallback, useRef } from "react";

export type HighlightColor = 1 | 2 | 3 | 4 | 5;

export interface Highlight {
  id: string;
  text: string;
  color: HighlightColor;
  // NEU: Lokale Offsets relativ zu einer Gruppe
  groupId: string;        // ID der Gruppe in der das Highlight liegt
  localStartOffset: number;  // Start-Offset im reinen Gruppen-Text
  localEndOffset: number;    // End-Offset im reinen Gruppen-Text
  timestamp: number;
}

interface HighlightMenuState {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  range: Range | null;
}

export function useHighlights() {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [menuState, setMenuState] = useState<HighlightMenuState>({
    visible: false,
    x: 0,
    y: 0,
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

  // Show context menu at selection position
  const showMenuAtSelection = useCallback((container: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    
    // Check if selection is within our container
    if (!container.contains(range.commonAncestorContainer)) return;

    // Get position below the selection
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    setMenuState({
      visible: true,
      x: rect.left - containerRect.left,
      y: rect.bottom - containerRect.top + 8,
      selectedText: text,
      range: range.cloneRange(),
    });

    containerRef.current = container;
  }, []);

  // Hide menu
  const hideMenu = useCallback(() => {
    setMenuState((prev) => ({ ...prev, visible: false }));
  }, []);

  // Create highlight from current selection - finds the group and calculates LOCAL offsets
  const createHighlight = useCallback((color?: HighlightColor): Highlight | null => {
    if (!menuState.range || !menuState.selectedText) {
      console.warn("[createHighlight] No range or selectedText!");
      return null;
    }

    const text = menuState.selectedText;
    const range = menuState.range;
    
    // Find the segment-text element that contains the selection
    // We look for the closest parent with data-group-id attribute
    let node: Node | null = range.startContainer;
    let groupElement: HTMLElement | null = null;
    
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute('data-group-id')) {
          groupElement = el;
          break;
        }
      }
      node = node.parentNode;
    }
    
    if (!groupElement) {
      console.warn("[createHighlight] Could not find group element with data-group-id!");
      return null;
    }
    
    const groupId = groupElement.getAttribute('data-group-id')!;
    
    // Calculate LOCAL offset within this group's text content
    // The group element's textContent is the pure text (no tags)
    const groupText = groupElement.textContent || "";
    
    let localStartOffset = 0;
    let localEndOffset = 0;
    
    try {
      // Create a range from group start to selection start
      const preRange = document.createRange();
      preRange.setStart(groupElement, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      localStartOffset = preRange.toString().length;
      localEndOffset = localStartOffset + text.length;
    } catch (e) {
      console.warn("[createHighlight] Could not calculate local offsets:", e);
      return null;
    }

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

    console.log("[createHighlight] Created highlight:", {
      text: text.slice(0, 30),
      color: highlightColor,
      groupId,
      localStartOffset,
      localEndOffset,
      groupText: groupText.slice(0, 50),
    });

    setHighlights((prev) => [...prev, highlight]);
    hideMenu();
    
    // Clear selection
    window.getSelection()?.removeAllRanges();

    return highlight;
  }, [menuState, getNextColor, hideMenu]);

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
    removeHighlight,
    clearHighlights,
    setNextColor,
  };
}
