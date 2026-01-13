import { memo, useMemo } from "react";
import type { Highlight } from "../hooks/useHighlights";
import type { TextFormatRange } from "../hooks/useTextFormats";

interface HighlightedTextProps {
  text: string;
  highlights: Highlight[];
  formats?: TextFormatRange[];
  responseSpacing?: Record<string, number>;
  groupId: string;  // Die ID dieser Gruppe für Highlight-Filterung
}

interface TextSegment {
  text: string;
  highlightIds: string[];      // Alle Highlight-IDs die dieses Segment abdecken
  highlightColors: number[];   // Alle Farben die dieses Segment abdecken
  isBold: boolean;
  startOffset: number;
  endOffset: number;
  endHighlightIds: string[];
}

/**
 * Rendert Text mit Highlights als <mark> Elemente.
 * Unterstützt ÜBERLAPPENDE Highlights mit additiver Farbmischung:
 * - 1 Highlight: normale Farbe
 * - 2+ Highlights: heller/weißer (additive Mischung)
 * 
 * Verwendet LOKALE Offsets relativ zum groupId.
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  highlights,
  formats = [],
  responseSpacing = {},
  groupId,
}: HighlightedTextProps) {
  
  // Erstelle Segmente mit Überlappungserkennung
  const segments = useMemo(() => {
    if (!text) {
      return [{ text: "", highlightIds: [], highlightColors: [], isBold: false, startOffset: 0, endOffset: 0, endHighlightIds: [] }] as TextSegment[];
    }

    // Filtere nur Highlights fr DIESE Gruppe
    // Highlights dieser Gruppe ODER Multi-Group-Spannen, die diese Gruppe berhren
    const groupHighlights = highlights
      .filter(h => {
        if (h.groupId === groupId && h.span === undefined) return true;
        if (!h.span) return false;
        if (h.span.groupIds && h.span.groupIds.length > 0) {
          return h.span.groupIds.includes(groupId);
        }
        return h.span.startGroupId === groupId || h.span.endGroupId === groupId;
      })
      .map(h => {
        // Auf diese Gruppe projizieren
        if (!h.span) {
          return h;
        }
        // Innerhalb der Spanne: fr jede Gruppe eigene Offsets
        if (groupId === h.span.startGroupId && groupId === h.span.endGroupId) {
          return {
            ...h,
            localStartOffset: h.span.startOffset,
            localEndOffset: h.span.endOffset,
          };
        }
        if (groupId === h.span.startGroupId) {
          return {
            ...h,
            localStartOffset: h.span.startOffset,
            localEndOffset: text.length, // bis Ende dieser Gruppe
          };
        }
        if (groupId === h.span.endGroupId) {
          return {
            ...h,
            localStartOffset: 0,
            localEndOffset: h.span.endOffset,
          };
        }
        // Mittlere Gruppen: kompletter Text dieser Gruppe markieren
        if (h.span.groupIds && h.span.groupIds.includes(groupId)) {
          return {
            ...h,
            localStartOffset: 0,
            localEndOffset: text.length,
          };
        }
        return null;
      })
      .filter((h): h is Highlight => h !== null)
      .filter(h => h.localStartOffset < text.length && h.localEndOffset > 0);

    const groupFormats = formats
      .filter(f => {
        if (f.groupId === groupId && f.span === undefined) return true;
        if (!f.span) return false;
        if (f.span.groupIds && f.span.groupIds.length > 0) {
          return f.span.groupIds.includes(groupId);
        }
        return f.span.startGroupId === groupId || f.span.endGroupId === groupId;
      })
      .map(f => {
        if (!f.span) {
          return f;
        }
        if (groupId === f.span.startGroupId && groupId === f.span.endGroupId) {
          return {
            ...f,
            localStartOffset: f.span.startOffset,
            localEndOffset: f.span.endOffset,
          };
        }
        if (groupId === f.span.startGroupId) {
          return {
            ...f,
            localStartOffset: f.span.startOffset,
            localEndOffset: text.length,
          };
        }
        if (groupId === f.span.endGroupId) {
          return {
            ...f,
            localStartOffset: 0,
            localEndOffset: f.span.endOffset,
          };
        }
        if (f.span.groupIds && f.span.groupIds.includes(groupId)) {
          return {
            ...f,
            localStartOffset: 0,
            localEndOffset: text.length,
          };
        }
        return null;
      })
      .filter((f): f is TextFormatRange => f !== null)
      .filter(f => f.localStartOffset < text.length && f.localEndOffset > 0);

    if (groupHighlights.length === 0 && groupFormats.length === 0) {
      return [{ text, highlightIds: [], highlightColors: [], isBold: false, startOffset: 0, endOffset: text.length, endHighlightIds: [] }] as TextSegment[];
    }

    // Sammle alle Boundary-Punkte (Start und Ende jedes Highlights/Formates)
    const boundaries = new Set<number>();
    boundaries.add(0);
    boundaries.add(text.length);

    for (const hl of groupHighlights) {
      const start = Math.max(0, Math.min(hl.localStartOffset, text.length));
      const end = Math.max(0, Math.min(hl.localEndOffset, text.length));
      boundaries.add(start);
      boundaries.add(end);
    }

    for (const fmt of groupFormats) {
      const start = Math.max(0, Math.min(fmt.localStartOffset, text.length));
      const end = Math.max(0, Math.min(fmt.localEndOffset, text.length));
      boundaries.add(start);
      boundaries.add(end);
    }

    // Sortiere Boundaries
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    // Erstelle Segmente zwischen allen Boundaries
    const result: TextSegment[] = [];

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const segStart = sortedBoundaries[i];
      const segEnd = sortedBoundaries[i + 1];

      if (segStart >= segEnd) continue;

      // Finde alle Highlights die dieses Segment abdecken
      const coveringHighlights = groupHighlights.filter(hl => {
        const hlStart = Math.max(0, Math.min(hl.localStartOffset, text.length));
        const hlEnd = Math.max(0, Math.min(hl.localEndOffset, text.length));
        return hlStart <= segStart && hlEnd >= segEnd;
      });

      const isBold = groupFormats.some(fmt => {
        const fmtStart = Math.max(0, Math.min(fmt.localStartOffset, text.length));
        const fmtEnd = Math.max(0, Math.min(fmt.localEndOffset, text.length));
        return fmtStart <= segStart && fmtEnd >= segEnd;
      });

      const endingHighlightIds = coveringHighlights
        .filter((hl) => {
          const isEndGroup = !hl.span || hl.span.endGroupId === groupId;
          const hlEnd = Math.max(0, Math.min(hl.localEndOffset, text.length));
          return isEndGroup && hlEnd === segEnd;
        })
        .map((hl) => hl.id);

      result.push({
        text: text.slice(segStart, segEnd),
        highlightIds: coveringHighlights.map(h => h.id),
        highlightColors: coveringHighlights.map(h => h.color),
        isBold,
        startOffset: segStart,
        endOffset: segEnd,
        endHighlightIds: endingHighlightIds,
      });
    }

    return result;
  }, [text, highlights, formats, groupId]);

  // Berechne CSS-Klasse basierend auf Überlappungsgrad
  const getHighlightClass = (colors: number[]): string => {
    if (colors.length === 0) return "";
    if (colors.length === 1) return `highlight-mark mark-${colors[0]}`;
    if (colors.length === 2) return "highlight-mark highlight-overlap-2";
    return "highlight-mark highlight-overlap-3";
  };

  return (
    <span className="highlighted-text">
      {segments.map((seg, idx) => {
        const className = getHighlightClass(seg.highlightColors);
        const primaryId = seg.highlightIds[0];
        const isLastSegment = idx === segments.length - 1;
        
        // Zero-Width Space nach mark-Elementen, um Browser-Erweiterung zu verhindern
        // Der Browser würde sonst neuen Text IN das mark-Element einfügen
        const needsZeroWidthSpace = className && isLastSegment;
        
        const content = seg.isBold ? <strong>{seg.text}</strong> : seg.text;
        const responseSpace = seg.endHighlightIds.reduce((maxSpace, id) => {
          const value = responseSpacing[id] || 0;
          return value > maxSpace ? value : maxSpace;
        }, 0);
        const markContent = (
          <mark
            className={className}
            data-highlight-id={primaryId}
            data-highlight-ids={seg.highlightIds.join(",")}
            data-overlap-count={seg.highlightColors.length}
            title={seg.highlightColors.length > 1
              ? `${seg.highlightColors.length} overlapping highlights`
              : undefined}
          >
            {content}
          </mark>
        );
        const responseGap = responseSpace > 0 ? (
          <span
            className="inline-response-gap"
            style={{ height: responseSpace }}
            contentEditable={false}
            aria-hidden="true"
          />
        ) : null;

        return className ? (
          <span 
            key={primaryId ? `${primaryId}-${idx}` : idx}
            className={responseGap ? "highlight-segment-with-gap" : undefined}
          >
            {markContent}
            {needsZeroWidthSpace && <span className="zwsp">{"\u200B"}</span>}
            {responseGap}
          </span>
        ) : seg.isBold ? (
          <span key={idx}><strong>{seg.text}</strong></span>
        ) : (
          <span key={idx}>{seg.text}</span>
        );
      })}
    </span>
  );
});
