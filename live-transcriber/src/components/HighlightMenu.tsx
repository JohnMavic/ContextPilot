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
  onExpand: () => void;
  onFacts: () => void;
  onCustomPrompt: (prompt: string) => void;
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
  selectedText,
  highlightColor,
  onClose,
  onCopy,
  onExpand,
  onFacts,
  onCustomPrompt,
  isLoading,
}: HighlightMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [customPrompt, setCustomPrompt] = useState("");

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
    }
  }, [visible]);

  if (!visible) return null;

  const handleCustomSubmit = () => {
    if (!customPrompt.trim() || isLoading) return;
    onCustomPrompt(customPrompt.trim());
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
          className="action-btn"
          onClick={onExpand}
          disabled={isLoading}
        >
          Show more details
        </button>
        <button
          className="action-btn"
          onClick={onFacts}
          disabled={isLoading}
        >
          Find similar examples
        </button>
        <div className="action-custom">
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
        </div>
      </div>
    </div>
  );
}
