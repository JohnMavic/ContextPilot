import { memo, useMemo } from "react";
import type { Highlight } from "../hooks/useHighlights";

interface HighlightedTextProps {
  text: string;
  highlights: Highlight[];
  groupId: string;  // Die ID dieser Gruppe für Highlight-Filterung
}

interface TextSegment {
  text: string;
  highlightIds: string[];      // Alle Highlight-IDs die dieses Segment abdecken
  highlightColors: number[];   // Alle Farben die dieses Segment abdecken
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
  groupId,
}: HighlightedTextProps) {
  
  // Erstelle Segmente mit Überlappungserkennung
  const segments = useMemo(() => {
    if (!text) {
      return [{ text: "", highlightIds: [], highlightColors: [] }] as TextSegment[];
    }
    
    // Filtere nur Highlights für DIESE Gruppe
    // Highlights dieser Gruppe ODER Multi-Group-Spannen, die diese Gruppe berühren
    const groupHighlights = highlights
      .filter(h => {
        if (h.groupId === groupId && h.span === undefined) return true;
        if (!h.span) return false;
        return (
          h.span.startGroupId === groupId ||
          h.span.endGroupId === groupId
        );
      })
      .map(h => {
        // Auf diese Gruppe projizieren
        if (!h.span) {
          return h;
        }
        // Innerhalb der Spanne: für jede Gruppe eigene Offsets
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
        // Mittlere Gruppen (falls je später erweitert)
        return null;
      })
      .filter((h): h is Highlight => h !== null)
      .filter(h => h.localStartOffset < text.length && h.localEndOffset > 0);
    
    if (groupHighlights.length === 0) {
      return [{ text, highlightIds: [], highlightColors: [] }] as TextSegment[];
    }

    // Sammle alle Boundary-Punkte (Start und Ende jedes Highlights)
    const boundaries = new Set<number>();
    boundaries.add(0);
    boundaries.add(text.length);
    
    for (const hl of groupHighlights) {
      const start = Math.max(0, Math.min(hl.localStartOffset, text.length));
      const end = Math.max(0, Math.min(hl.localEndOffset, text.length));
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
      
      result.push({
        text: text.slice(segStart, segEnd),
        highlightIds: coveringHighlights.map(h => h.id),
        highlightColors: coveringHighlights.map(h => h.color),
      });
    }
    
    return result;
  }, [text, highlights, groupId]);

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
        
        return className ? (
          <mark
            key={primaryId ? `${primaryId}-${idx}` : idx}
            className={className}
            data-highlight-id={primaryId}
            data-highlight-ids={seg.highlightIds.join(",")}
            data-overlap-count={seg.highlightColors.length}
            title={seg.highlightColors.length > 1 
              ? `${seg.highlightColors.length} overlapping highlights` 
              : undefined}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        );
      })}
    </span>
  );
});
