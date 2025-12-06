import { useEffect, useRef } from "react";
import type { HighlightColor } from "../hooks/useHighlights";

interface HighlightMenuProps {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  onClose: () => void;
  onHighlight: (color?: HighlightColor) => void;
  onHighlightAndExpand: () => void;  // Kombiniert: Highlight + Expand
  onHighlightAndFacts: () => void;   // Kombiniert: Highlight + Facts
  isLoading?: boolean;
}

export function HighlightMenu({
  visible,
  x,
  y,
  selectedText,
  onClose,
  onHighlight,
  onHighlightAndExpand,
  onHighlightAndFacts,
  isLoading,
}: HighlightMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const preview =
    selectedText.length > 80
      ? selectedText.slice(0, 77) + "..."
      : selectedText;

  return (
    <div
      ref={menuRef}
      className="highlight-context-menu"
      style={{ left: x, top: y }}
    >
      <div className="menu-header">
        <div className="selected-preview">"{preview}"</div>
      </div>

      {/* Mark Only - ohne Agent */}
      <button
        className="menu-btn"
        onClick={() => {
          onHighlight();
        }}
      >
        <span className="icon">✏️</span>
        <span className="label">Nur markieren</span>
      </button>

      {/* AURA Actions */}
      <button
        className="menu-btn"
        onClick={() => {
          onHighlightAndExpand();
        }}
        disabled={isLoading}
      >
        <span className="icon">🔍</span>
        <span className="label">Show more details</span>
      </button>

      <button
        className="menu-btn"
        onClick={() => {
          onHighlightAndFacts();
        }}
        disabled={isLoading}
      >
        <span className="icon">🔗</span>
        <span className="label">Find similar examples</span>
      </button>
    </div>
  );
}
