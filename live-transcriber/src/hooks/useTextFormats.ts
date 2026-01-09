import { useState, useCallback } from "react";

export type TextFormatKind = "bold";

export interface TextFormatRange {
  id: string;
  kind: TextFormatKind;
  text: string;
  groupId: string;
  localStartOffset: number;
  localEndOffset: number;
  span?: {
    startGroupId: string;
    endGroupId: string;
    startOffset: number;
    endOffset: number;
    groupIds?: string[];
  };
  timestamp: number;
}

const generateId = () => `fmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const resolveSelection = (range: Range, container: HTMLElement) => {
  const groupElements = Array.from(container.querySelectorAll("[data-group-id]")) as HTMLElement[];
  if (groupElements.length === 0) return null;

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

  const normalizedText = combined.replace(/\s+/g, " ").trim();
  if (!normalizedText) return null;

  return {
    startGroupId,
    endGroupId,
    groupIds,
    startOffset,
    endOffset,
    normalizedText,
  };
};

export function useTextFormats() {
  const [formats, setFormats] = useState<TextFormatRange[]>([]);

  const toggleBoldFromSelection = useCallback((range: Range, container: HTMLElement) => {
    if (!container.contains(range.commonAncestorContainer)) return;
    const info = resolveSelection(range, container);
    if (!info) return;

    const { startGroupId, endGroupId, groupIds, startOffset, endOffset, normalizedText } = info;
    if (!normalizedText) return;
    const selectionGroupIds = groupIds.length > 0 ? groupIds : [startGroupId];
    if (!selectionGroupIds.some((id) => id.startsWith("group-"))) return;

    const overlapsSelection = (fmt: TextFormatRange) => {
      const fmtGroupIds = fmt.span?.groupIds && fmt.span.groupIds.length > 0
        ? fmt.span.groupIds
        : [fmt.groupId];
      const intersectsGroup = fmtGroupIds.some((id) => selectionGroupIds.includes(id));
      if (!intersectsGroup) return false;
      if (fmt.span) return true;
      if (startGroupId !== endGroupId) return true;
      return !(fmt.localEndOffset <= startOffset || fmt.localStartOffset >= endOffset);
    };

    setFormats((prev) => {
      const hasOverlap = prev.some(overlapsSelection);
      if (hasOverlap) {
        return prev.filter((fmt) => !overlapsSelection(fmt));
      }

      const format: TextFormatRange = {
        id: generateId(),
        kind: "bold",
        text: normalizedText,
        groupId: startGroupId,
        localStartOffset: startOffset,
        localEndOffset: endOffset,
        span: startGroupId === endGroupId
          ? undefined
          : {
              startGroupId,
              endGroupId,
              startOffset,
              endOffset,
              groupIds,
            },
        timestamp: Date.now(),
      };

      return [...prev, format];
    });
  }, []);

  const clearFormats = useCallback(() => {
    setFormats([]);
  }, []);

  const updateFormatsForGroupEdit = useCallback((
    editedGroups: Map<string, string>,
    oldGroupTexts: Map<string, string>,
  ) => {
    if (editedGroups.size === 0) return;

    setFormats((prev) => {
      let hasChanges = false;

      const updated = prev.map((fmt) => {
        if (fmt.span) {
          const startEdited = editedGroups.has(fmt.span.startGroupId);
          const endEdited = editedGroups.has(fmt.span.endGroupId);
          if (!startEdited && !endEdited) return fmt;

          const newStartText = editedGroups.get(fmt.span.startGroupId);
          const newEndText = editedGroups.get(fmt.span.endGroupId);
          const oldStartText = oldGroupTexts.get(fmt.span.startGroupId) || "";
          const oldEndText = oldGroupTexts.get(fmt.span.endGroupId) || "";

          const startPart = oldStartText.slice(fmt.span.startOffset);
          const endPart = oldEndText.slice(0, fmt.span.endOffset);

          const nextSpan = { ...fmt.span };

          if (startEdited && newStartText) {
            const newStartOffset = newStartText.indexOf(startPart);
            if (newStartOffset >= 0) {
              nextSpan.startOffset = newStartOffset;
              hasChanges = true;
            }
          }

          if (endEdited && newEndText) {
            const endPartIndex = newEndText.indexOf(endPart);
            if (endPartIndex >= 0) {
              nextSpan.endOffset = endPartIndex + endPart.length;
              hasChanges = true;
            }
          }

          return { ...fmt, span: nextSpan };
        }

        if (!editedGroups.has(fmt.groupId)) return fmt;
        const newText = editedGroups.get(fmt.groupId)!;
        const matchStart = newText.indexOf(fmt.text);

        if (matchStart >= 0) {
          const matchEnd = matchStart + fmt.text.length;
          if (matchStart !== fmt.localStartOffset || matchEnd !== fmt.localEndOffset) {
            hasChanges = true;
            return {
              ...fmt,
              localStartOffset: matchStart,
              localEndOffset: matchEnd,
              text: newText.slice(matchStart, matchEnd),
            };
          }
          return fmt;
        }

        const normalizedFormat = fmt.text.replace(/\s+/g, " ").trim();
        const normalizedNew = newText.replace(/\s+/g, " ").trim();
        const normalizedIndex = normalizedNew.indexOf(normalizedFormat);
        if (normalizedIndex >= 0) {
          let charCount = 0;
          let realIndex = 0;
          for (let i = 0; i < newText.length && charCount < normalizedIndex; i++) {
            if (!/\s/.test(newText[i]) || (i > 0 && !/\s/.test(newText[i - 1]))) {
              charCount++;
            }
            realIndex = i + 1;
          }
          const newStartOffset = Math.max(0, realIndex);
          const newEndOffset = Math.min(newText.length, newStartOffset + fmt.text.length);
          if (newStartOffset !== fmt.localStartOffset || newEndOffset !== fmt.localEndOffset) {
            hasChanges = true;
            return {
              ...fmt,
              localStartOffset: newStartOffset,
              localEndOffset: newEndOffset,
              text: newText.slice(newStartOffset, newEndOffset),
            };
          }
        }

        return fmt;
      });

      if (!hasChanges) return prev;
      return updated;
    });
  }, []);

  return {
    formats,
    toggleBoldFromSelection,
    clearFormats,
    updateFormatsForGroupEdit,
  };
}
