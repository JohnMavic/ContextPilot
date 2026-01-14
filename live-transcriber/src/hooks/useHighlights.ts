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

    const getGroupAncestor = (node: Node | null) => {
      if (!node) return null;
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).closest("[data-group-id]") as HTMLElement | null;
      }
      return node.parentElement?.closest("[data-group-id]") as HTMLElement | null;
    };

    let startGroup = getGroupAncestor(range.startContainer);
    let endGroup = getGroupAncestor(range.endContainer);

    const extractPrefix = (id: string) => id.split("-")[0];
    const startGroupIdAttr = startGroup?.getAttribute("data-group-id") || "";
    const endGroupIdAttr = endGroup?.getAttribute("data-group-id") || "";
    const startPrefix = startGroupIdAttr ? extractPrefix(startGroupIdAttr) : "";
    const endPrefix = endGroupIdAttr ? extractPrefix(endGroupIdAttr) : "";
    const resolvedPrefix = startPrefix || endPrefix;
    const usePrefix = resolvedPrefix && (!startPrefix || !endPrefix || startPrefix === endPrefix);

    const scopedGroupElements = usePrefix
      ? groupElements.filter((el) => (el.getAttribute("data-group-id") || "").startsWith(`${resolvedPrefix}-`))
      : groupElements;

    const intersectsRange = (el: HTMLElement) => {
      try {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(el);
        if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0) return false;
        if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0) return false;
        return true;
      } catch {
        return false;
      }
    };

    const intersecting = scopedGroupElements.filter((el) => intersectsRange(el));

    if (intersecting.length > 0) {
      const first = intersecting[0];
      const last = intersecting[intersecting.length - 1];
      if (!startGroup) startGroup = first;
      if (!endGroup) endGroup = last;
      if (intersecting.length > 1) {
        startGroup = first;
        endGroup = last;
      }
    }

    if (!startGroup || !endGroup) return null;

    const startGroupId = startGroup.getAttribute("data-group-id");
    const endGroupId = endGroup.getAttribute("data-group-id");
    if (!startGroupId || !endGroupId) return null;

    let useScopedList = true;
    let startIndex = scopedGroupElements.indexOf(startGroup);
    let endIndex = scopedGroupElements.indexOf(endGroup);
    if (startIndex === -1 || endIndex === -1) {
      startIndex = groupElements.indexOf(startGroup);
      endIndex = groupElements.indexOf(endGroup);
      useScopedList = false;
    }
    if (startIndex === -1 || endIndex === -1) return null;
    if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

    const sourceElements = useScopedList ? scopedGroupElements : groupElements;
    const groupIds = sourceElements
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
      const middleGroupElements = sourceElements.slice(startIndex + 1, endIndex);
      const parts = [
        startGroupText.slice(startOffset),
        ...middleGroupElements.map((el) => (el.textContent || "").trim()).filter(Boolean),
        endGroupText.slice(0, endOffset),
      ].filter(Boolean);
      combined = parts.join(" ");
    }

    const normalizeSelectionText = (value: string) => value.replace(/\s+/g, " ").trim();
    const normalizedText = normalizeSelectionText(combined);
    const normalizedSelection = normalizeSelectionText(range.toString());
    const hasMismatch = normalizedSelection
      ? (!normalizedText ||
        normalizedText.length < normalizedSelection.length * 0.6 ||
        (!normalizedSelection.includes(normalizedText) && !normalizedText.includes(normalizedSelection)))
      : false;

    if (hasMismatch) {
      const intersectionSegments: Array<{
        groupId: string;
        startOffset: number;
        endOffset: number;
        text: string;
      }> = [];

      for (const el of sourceElements) {
        const groupId = el.getAttribute("data-group-id");
        if (!groupId) continue;

        const groupRange = document.createRange();
        groupRange.selectNodeContents(el);

        try {
          if (range.compareBoundaryPoints(Range.END_TO_START, groupRange) <= 0) continue;
          if (range.compareBoundaryPoints(Range.START_TO_END, groupRange) >= 0) continue;
        } catch {
          continue;
        }

        const intersection = range.cloneRange();
        try {
          if (intersection.compareBoundaryPoints(Range.START_TO_START, groupRange) < 0) {
            intersection.setStart(groupRange.startContainer, groupRange.startOffset);
          }
          if (intersection.compareBoundaryPoints(Range.END_TO_END, groupRange) > 0) {
            intersection.setEnd(groupRange.endContainer, groupRange.endOffset);
          }
        } catch {
          continue;
        }

        const text = intersection.toString();
        if (!text.trim()) continue;

        const prefixRange = document.createRange();
        prefixRange.setStart(groupRange.startContainer, groupRange.startOffset);
        prefixRange.setEnd(intersection.startContainer, intersection.startOffset);
        const startOffset = prefixRange.toString().length;
        const endOffset = startOffset + text.length;

        intersectionSegments.push({
          groupId,
          startOffset,
          endOffset,
          text,
        });
      }

      if (intersectionSegments.length > 0) {
        const first = intersectionSegments[0];
        const last = intersectionSegments[intersectionSegments.length - 1];
        const combinedText = intersectionSegments
          .map((seg) => seg.text.trim())
          .filter(Boolean)
          .join(" ");
        const fallbackText = normalizeSelectionText(combinedText);
        if (fallbackText) {
          return {
            startGroup,
            endGroup,
            startGroupId: first.groupId,
            endGroupId: last.groupId,
            groupIds: intersectionSegments.map((seg) => seg.groupId),
            startOffset: Math.max(0, first.startOffset),
            endOffset: Math.max(0, last.endOffset),
            normalizedText: fallbackText,
          };
        }
      }
    }

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

  /**
   * Aktualisiert Highlight-Offsets nach einer Textbearbeitung in einer Gruppe.
   * Sucht den ursprünglichen Highlight-Text im neuen Gruppen-Text und passt die Offsets an.
   * 
   * @param editedGroups - Map von groupId zu neuem Text
   * @param oldGroupTexts - Map von groupId zu altem Text (vor dem Edit)
   */
  const updateHighlightsForGroupEdit = useCallback((
    editedGroups: Map<string, string>,
    oldGroupTexts: Map<string, string>
  ) => {
    if (editedGroups.size === 0) return;

    setHighlights((prev) => {
      let hasChanges = false;
      
      const updated = prev.map((hl) => {
        // Nur Single-Group Highlights behandeln (ohne span)
        // Multi-Group Highlights sind komplexer und seltener editiert
        if (hl.span) {
          // Für Multi-Group: Prüfe ob Start- oder End-Gruppe betroffen ist
          const startEdited = editedGroups.has(hl.span.startGroupId);
          const endEdited = editedGroups.has(hl.span.endGroupId);
          
          if (!startEdited && !endEdited) return hl;
          
          // Versuche den Highlight-Text in den neuen Texten zu finden
          const newStartText = editedGroups.get(hl.span.startGroupId);
          const newEndText = editedGroups.get(hl.span.endGroupId);
          const oldStartText = oldGroupTexts.get(hl.span.startGroupId) || "";
          const oldEndText = oldGroupTexts.get(hl.span.endGroupId) || "";
          
          // Extrahiere den Teil des Highlight-Texts aus Start- und End-Gruppe
          const hlStartPart = oldStartText.slice(hl.span.startOffset);
          const hlEndPart = oldEndText.slice(0, hl.span.endOffset);
          
          let newSpan = { ...hl.span };
          
          if (startEdited && newStartText) {
            // Suche hlStartPart im neuen Text
            const newStartOffset = newStartText.indexOf(hlStartPart);
            if (newStartOffset >= 0) {
              newSpan.startOffset = newStartOffset;
              hasChanges = true;
            } else {
              // Highlight-Text nicht mehr gefunden - Highlight beibehalten
              return hl;
            }
          }
          
          if (endEdited && newEndText) {
            // Suche hlEndPart im neuen Text
            const endPartIndex = newEndText.indexOf(hlEndPart);
            if (endPartIndex >= 0) {
              newSpan.endOffset = endPartIndex + hlEndPart.length;
              hasChanges = true;
            } else {
              // Highlight-Text nicht mehr gefunden - Highlight beibehalten
              return hl;
            }
          }
          
          return { ...hl, span: newSpan };
        }
        
        // Single-Group Highlight
        if (!editedGroups.has(hl.groupId)) return hl;
        
        const newText = editedGroups.get(hl.groupId)!;
        
        // Der ursprünglich markierte Text
        const highlightedText = hl.text;
        
        // Suche den Highlight-Text im neuen Gruppen-Text
        const newStartOffset = newText.indexOf(highlightedText);
        
        if (newStartOffset >= 0) {
          // Text gefunden - Offsets aktualisieren
          const newEndOffset = newStartOffset + highlightedText.length;
          
          // Nur aktualisieren wenn sich etwas geändert hat
          if (newStartOffset !== hl.localStartOffset || newEndOffset !== hl.localEndOffset) {
            hasChanges = true;
            return {
              ...hl,
              localStartOffset: newStartOffset,
              localEndOffset: newEndOffset,
              text: newText.slice(newStartOffset, newEndOffset),
            };
          }
          return hl;
        }
        
        // Text nicht exakt gefunden - versuche Teilübereinstimmung
        // (z.B. wenn nur Whitespace normalisiert wurde)
        const normalizedHighlight = highlightedText.replace(/\s+/g, " ").trim();
        const normalizedNew = newText.replace(/\s+/g, " ").trim();
        
        const normalizedIndex = normalizedNew.indexOf(normalizedHighlight);
        if (normalizedIndex >= 0) {
          // Finde die entsprechende Position im Original-Text
          // Zähle Zeichen bis zur normalisierten Position
          let charCount = 0;
          let realIndex = 0;
          for (let i = 0; i < newText.length && charCount < normalizedIndex; i++) {
            if (!/\s/.test(newText[i]) || (i > 0 && !/\s/.test(newText[i-1]))) {
              charCount++;
            }
            realIndex = i + 1;
          }
          
          // Approximiere die neue Position
          const newStartOffset = Math.max(0, realIndex);
          const newEndOffset = Math.min(newText.length, newStartOffset + highlightedText.length);
          
          if (newStartOffset !== hl.localStartOffset || newEndOffset !== hl.localEndOffset) {
            hasChanges = true;
            return {
              ...hl,
              localStartOffset: newStartOffset,
              localEndOffset: newEndOffset,
              text: newText.slice(newStartOffset, newEndOffset),
            };
          }
          return hl;
        }
        
        // Highlight-Text nicht mehr im neuen Text vorhanden
        // Highlight beibehalten (Offsets bleiben)
        console.warn(`[updateHighlightsForGroupEdit] Highlight text "${highlightedText}" not found in edited group "${hl.groupId}", keeping highlight`);
        return hl;
      });
      
      // Wenn keine Änderungen, Original-Array zurückgeben (verhindert unnötige Re-Renders)
      if (!hasChanges) return prev;
      
      // Highlights beibehalten
      return updated;
    });
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
    updateHighlightsForGroupEdit,
  };
}
