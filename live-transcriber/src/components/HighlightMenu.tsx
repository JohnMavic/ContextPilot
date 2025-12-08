import { useEffect, useMemo, useRef, useState } from "react";
import type { HighlightColor } from "../hooks/useHighlights";

interface HighlightMenuProps {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  selectedText: string;
  highlightColor?: HighlightColor;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onExpand: (useWeb: boolean) => void;
  onFacts: (useWeb: boolean) => void;
  onCustomPrompt: (prompt: string, useWeb: boolean) => void;
  isLoading?: boolean;
}

const colorHexMap: Record<HighlightColor, string> = {
  1: "#ef4444",
  2: "#22c55e",
  3: "#f97316",
  4: "#facc15",
  5: "#3b82f6",
};

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function HighlightMenu({
  visible,
  x,
  y,
  width,
  selectedText: _selectedText,
  highlightColor,
  onClose,
  onCopy,
  onDelete,
  onExpand,
  onFacts,
  onCustomPrompt,
  isLoading,
}: HighlightMenuProps) {
  void _selectedText;
  const menuRef = useRef<HTMLDivElement>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [expandUseWeb, setExpandUseWeb] = useState(true);
  const [factsUseWeb, setFactsUseWeb] = useState(true);
  const [customUseWeb, setCustomUseWeb] = useState(true);

  const barColor = highlightColor ? colorHexMap[highlightColor] : "#60a5fa";
  const barBackground = useMemo(() => hexToRgba(barColor, 0.4), [barColor]);

  // Close on click outside / escape / delete
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        // Delete-Taste löscht den markierten Text
        e.preventDefault();
        onDelete();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, onClose, onDelete]);

  // Reset custom prompt when bar reopened
  useEffect(() => {
    if (visible) {
      setCustomPrompt("");
      setExpandUseWeb(true);
      setFactsUseWeb(true);
      setCustomUseWeb(true);
    }
  }, [visible]);

  if (!visible) return null;

  const handleCustomSubmit = () => {
    if (!customPrompt.trim() || isLoading) return;
    onCustomPrompt(customPrompt.trim(), customUseWeb);
  };

  return (
    <div
      ref={menuRef}
      className="highlight-action-bar"
      style={{
        left: x,
        top: y,
        minWidth: Math.max(width, 180),
        background: barBackground,
        borderColor: barColor,
      }}
    >
      <div className="action-buttons">
        <button
          className="action-btn action-btn-copy"
          onClick={onCopy}
          title="Copy to clipboard"
        >
          📋 Copy
        </button>
        <button
          className="action-btn action-btn-delete"
          onClick={onDelete}
          title="Delete from transcript"
        >
          🗑️ Delete
        </button>
        <button
          className="action-btn action-btn-with-web"
          onClick={() => onExpand(expandUseWeb)}
          disabled={isLoading}
        >
          <span>Show more details</span>
          <label className="web-toggle-inline" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={expandUseWeb}
              onChange={(e) => setExpandUseWeb(e.target.checked)}
            />
            <span className="web-label">Web</span>
          </label>
        </button>
        <button
          className="action-btn action-btn-with-web"
          onClick={() => onFacts(factsUseWeb)}
          disabled={isLoading}
        >
          <span>Find similar examples</span>
          <label className="web-toggle-inline" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={factsUseWeb}
              onChange={(e) => setFactsUseWeb(e.target.checked)}
            />
            <span className="web-label">Web</span>
          </label>
        </button>
        <div className="custom-input-group">
          <input
            type="text"
            value={customPrompt}
            placeholder="Custom instruction + Enter"
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomSubmit();
              }
            }}
            disabled={isLoading}
          />
          <label className="web-toggle-inline" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={customUseWeb}
              onChange={(e) => setCustomUseWeb(e.target.checked)}
            />
            <span className="web-label">Web</span>
          </label>
        </div>
      </div>
    </div>
  );
}
