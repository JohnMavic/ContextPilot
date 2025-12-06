import { memo, useMemo } from "react";
import type { Highlight } from "../hooks/useHighlights";

interface HighlightedTextProps {
  text: string;
  highlights: Highlight[];
  groupId: string;  // Die ID dieser Gruppe für Highlight-Filterung
}

interface TextRun {
  text: string;
  highlightColor?: number;
  highlightId?: string;
}

/**
 * Rendert Text mit Highlights als <mark> Elemente.
 * State-basiert: Highlights werden aus dem React-State gelesen,
 * nicht via DOM-Manipulation.
 * 
 * Verwendet LOKALE Offsets relativ zum groupId.
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  highlights,
  groupId,
}: HighlightedTextProps) {
  
  // Splitte den Text in Runs basierend auf Highlight-Offsets
  const runs = useMemo(() => {
    if (!text) {
      return [{ text: "" }] as TextRun[];
    }
    
    // Filtere nur Highlights für DIESE Gruppe
    const groupHighlights = highlights.filter(h => h.groupId === groupId);
    
    if (groupHighlights.length === 0) {
      return [{ text }] as TextRun[];
    }

    // Sortiere Highlights nach localStartOffset
    const sortedHighlights = [...groupHighlights]
      .filter(h => h.localStartOffset < text.length && h.localEndOffset > 0)
      .sort((a, b) => a.localStartOffset - b.localStartOffset);

    if (sortedHighlights.length === 0) {
      return [{ text }] as TextRun[];
    }

    const result: TextRun[] = [];
    let currentPos = 0;

    for (const hl of sortedHighlights) {
      // Clamp offsets to text bounds
      const start = Math.max(0, Math.min(hl.localStartOffset, text.length));
      const end = Math.max(0, Math.min(hl.localEndOffset, text.length));

      if (start >= end) continue;

      // Text vor dem Highlight
      if (currentPos < start) {
        result.push({
          text: text.slice(currentPos, start),
        });
      }

      // Das Highlight selbst
      if (start < text.length) {
        result.push({
          text: text.slice(start, end),
          highlightColor: hl.color,
          highlightId: hl.id,
        });
      }

      currentPos = end;
    }

    // Restlicher Text nach dem letzten Highlight
    if (currentPos < text.length) {
      result.push({
        text: text.slice(currentPos),
      });
    }

    return result;
  }, [text, highlights, groupId]);

  return (
    <span className="highlighted-text">
      {runs.map((run, idx) => 
        run.highlightColor ? (
          <mark
            key={run.highlightId || idx}
            className={`highlight-mark mark-${run.highlightColor}`}
            data-highlight-id={run.highlightId}
          >
            {run.text}
          </mark>
        ) : (
          <span key={idx}>{run.text}</span>
        )
      )}
    </span>
  );
});
