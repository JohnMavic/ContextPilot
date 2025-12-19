import { useEffect, useMemo, useRef, useState } from "react";
import type { HighlightColor } from "../hooks/useHighlights";

interface HighlightMenuProps {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  highlightColor?: HighlightColor;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onExpand: (useWebSearch: boolean) => void;
  onFacts: (useWebSearch: boolean) => void;
  onCustomPrompt: (prompt: string, useWebSearch: boolean) => void;
  isLoading?: boolean;
  disableDelete?: boolean;
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
  highlightColor,
  onClose,
  onCopy,
  onDelete,
  onExpand,
  onFacts,
  onCustomPrompt,
  isLoading: _isLoading,
  disableDelete,
}: HighlightMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [webSearchExpand, setWebSearchExpand] = useState(true);
  const [webSearchFacts, setWebSearchFacts] = useState(true);
  const [webSearchCustom, setWebSearchCustom] = useState(true);

  const barColor = highlightColor ? colorHexMap[highlightColor] : "#60a5fa";
  const barBackground = useMemo(() => hexToRgba(barColor, 0.4), [barColor]);

  // Close on click outside / escape
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

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  // Reset custom prompt when bar reopened
  useEffect(() => {
    if (visible) {
      setCustomPrompt("");
      setWebSearchExpand(true);
      setWebSearchFacts(true);
      setWebSearchCustom(true);
    }
  }, [visible]);

  if (!visible) return null;

  const handleCustomSubmit = () => {
    if (!customPrompt.trim()) return;
    onCustomPrompt(customPrompt.trim(), webSearchCustom);
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
          disabled={disableDelete}
        >
          🗑️ Delete
        </button>
        <div className="action-row">
          <button
            className="action-btn"
            onClick={() => onExpand(webSearchExpand)}
          >
            Show more details
          </button>
          <label className="websearch-toggle">
            <input
              type="checkbox"
              checked={webSearchExpand}
              onChange={(e) => setWebSearchExpand(e.target.checked)}
            />
            <span>Web Search</span>
          </label>
        </div>
        <div className="action-row">
          <button
            className="action-btn"
            onClick={() => onFacts(webSearchFacts)}
          >
            Find similar examples
          </button>
          <label className="websearch-toggle">
            <input
              type="checkbox"
              checked={webSearchFacts}
              onChange={(e) => setWebSearchFacts(e.target.checked)}
            />
            <span>Web Search</span>
          </label>
        </div>
        <div className="action-row action-row-custom">
          <div className="action-custom">
            <textarea
              value={customPrompt}
              rows={2}
              placeholder="Custom instruction + Ctrl+Enter"
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
            />
          </div>
          <label className="websearch-toggle">
            <input
              type="checkbox"
              checked={webSearchCustom}
              onChange={(e) => setWebSearchCustom(e.target.checked)}
            />
            <span>Web Search</span>
          </label>
        </div>
      </div>
    </div>
  );
}
