import { useMemo, useState } from "react";
import { HighlightedText } from "./HighlightedText";
import type { AuraFollowUp } from "../hooks/useAuraAgent";
import type { Highlight, HighlightColor } from "../hooks/useHighlights";

// Farben passend zu den Highlight-Klassen
const colorMap: Record<HighlightColor, string> = {
  1: "#ef4444", // rot
  2: "#22c55e", // grün
  3: "#f97316", // orange
  4: "#facc15", // gelb
  5: "#3b82f6", // blau
};

// Formatiert eine einzelne Zeile: Bold, Links, Quellenangaben, Sub-Tags
const normalizeInlineTags = (value: string) =>
  value
    .replace(/&lt;(\/?)(small|sub)&gt;/gi, (_, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`)
    .replace(/<(\/?)(small|sub)>/gi, (_, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`);

function formatLine(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let keyIndex = 0;
  const normalizedText = normalizeInlineTags(text);
  
  // Regex für verschiedene Markdown-Elemente
  // Reihenfolge: Sub-Tags, Bold, Markdown-Links, Quellenangaben (【...】), Plain URLs
  const combinedRegex = /(<small>(.+?)<\/small>)|(<sub>(.+?)<\/sub>)|(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|(【[^】]+】)|(https?:\/\/[^\s<>]+)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = combinedRegex.exec(normalizedText)) !== null) {
    // Text vor dem Match
    if (match.index > lastIndex) {
      parts.push(normalizedText.slice(lastIndex, match.index));
    }
    
    if (match[1]) {
      // <small>...</small> - match[2] ist der Text
      parts.push(<small key={keyIndex++} className="aura-sub">{formatLine(match[2])}</small>);
    } else if (match[3]) {
      // <sub>...</sub> - match[4] ist der Text
      parts.push(<sub key={keyIndex++} className="aura-sub">{formatLine(match[4])}</sub>);
    } else if (match[5]) {
      // **Bold** - match[6] ist der Text
      parts.push(<strong key={keyIndex++}>{match[6]}</strong>);
    } else if (match[7]) {
      // [text](url) - match[8] ist Text, match[9] ist URL
      const linkText = match[8];
      const linkUrl = match[9];
      parts.push(
        <a 
          key={keyIndex++} 
          href={linkUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="aura-link"
          style={{ pointerEvents: 'auto', cursor: 'pointer', position: 'relative', zIndex: 10 }}
          onClick={(e) => {
            e.stopPropagation();
            window.open(linkUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          {linkText}
        </a>
      );
    } else if (match[10]) {
      // 【Quellenangabe】 - als kleine Badge darstellen
      parts.push(
        <span key={keyIndex++} className="aura-source-badge">
          {match[10]}
        </span>
      );
    } else if (match[11]) {
      // Plain URL (https://...)
      const plainUrl = match[11];
      parts.push(
        <a 
          key={keyIndex++} 
          href={plainUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="aura-link"
          style={{ pointerEvents: 'auto', cursor: 'pointer', position: 'relative', zIndex: 10 }}
          onClick={(e) => {
            e.stopPropagation();
            window.open(plainUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          {plainUrl}
        </a>
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Rest anhängen
  if (lastIndex < normalizedText.length) {
    parts.push(normalizedText.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
}

// Prüft ob eine Zeile ein Bullet Point ist
function isBulletLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("- ") || 
         trimmed.startsWith("• ") || 
         trimmed.startsWith("* ") ||
         /^\d+\.\s/.test(trimmed);  // Nummerierte Listen
}

// Prüft ob eine Zeile ein Heading ist (# oder ##)
function isHeadingLine(line: string): { level: number; text: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(#{1,3})\s+(.*)$/);
  if (match) {
    return { level: match[1].length, text: match[2] };
  }
  return null;
}

// Extrahiert Bullet-Zeichen und Text
function parseBulletLine(line: string): { bullet: string; text: string } {
  const trimmed = line.trim();
  
  // Nummerierte Liste: "1. Text"
  const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
  if (numMatch) {
    return { bullet: numMatch[1], text: numMatch[2] };
  }
  
  // Bullet: "- Text" oder "• Text" oder "* Text"
  const bulletMatch = trimmed.match(/^([-•*])\s+(.*)$/);
  if (bulletMatch) {
    return { bullet: "•", text: bulletMatch[2] };
  }
  
  return { bullet: "", text: trimmed };
}

// Prüft ob eine Zeile eine eingerückte Sub-Zeile ist (gehört zum vorherigen Element)
function isIndentedSubLine(line: string): boolean {
  // Zeile beginnt mit Leerzeichen und enthält <sub>
  return /^\s*<(sub|small)>/.test(line);
}

// Rendert den formatierten Result-Text
function renderFormattedResult(result: string, groupId: string): React.ReactNode {
  const lines = result.split("\n");
  const elements: React.ReactNode[] = [];
  
  // Sammle zusammengehörende Zeilen (Bullet + folgende Sub-Zeilen)
  interface ParsedBlock {
    type: "heading" | "bullet" | "paragraph";
    headingLevel?: number;
    bullet?: string;
    lines: string[];
  }
  
  const blocks: ParsedBlock[] = [];
  let currentBlock: ParsedBlock | null = null;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Eingerückte Sub-Zeile gehört zum vorherigen Block
    if (isIndentedSubLine(line) && currentBlock) {
      currentBlock.lines.push(line.trim());
      continue;
    }
    
    // Neuer Block starten
    const heading = isHeadingLine(line);
    if (heading) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "heading", headingLevel: heading.level, lines: [heading.text] };
    } else if (isBulletLine(line)) {
      if (currentBlock) blocks.push(currentBlock);
      const { bullet, text } = parseBulletLine(line);
      currentBlock = { type: "bullet", bullet, lines: [text] };
    } else {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "paragraph", lines: [line.trim()] };
    }
  }
  if (currentBlock) blocks.push(currentBlock);
  
  // Blöcke rendern
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    
    if (block.type === "heading") {
      const HeadingTag = `h${(block.headingLevel || 1) + 2}` as keyof JSX.IntrinsicElements;
      elements.push(
        <HeadingTag key={i} className="aura-heading">
          <span data-group-id={groupId}>
            {formatLine(block.lines[0])}
          </span>
        </HeadingTag>
      );
    } else if (block.type === "bullet") {
      elements.push(
        <div key={i} className="aura-bullet-item">
          <span className="bullet-marker">{block.bullet}</span>
          <span className="bullet-text">
            <span data-group-id={groupId}>
              {block.lines.map((l, j) => (
                <span key={j}>{formatLine(l)}</span>
              ))}
            </span>
          </span>
        </div>
      );
    } else {
      elements.push(
        <p key={i} className="aura-paragraph">
          <span data-group-id={groupId}>
            {block.lines.map((l, j) => (
              <span key={j}>{formatLine(l)}</span>
            ))}
          </span>
        </p>
      );
    }
  }
  
  return elements;
}

interface AuraResponsePanelProps {
  id: string;
  sourceText: string;
  taskLabel: string;
  taskDetail?: string;
  color: HighlightColor;
  result: string | null;
  loading: boolean;
  error: string | null;
  statusNote?: string;
  prompt: string;
  onClose: (id: string) => void;
  onAskFollowUp: (id: string, question: string, options?: { webSearch?: boolean }) => void;
  highlights: Highlight[];
  sourceGroupId: string;
  followUps: AuraFollowUp[];
}

export function AuraResponsePanel({
  id,
  sourceText,
  taskLabel,
  taskDetail,
  color,
  result,
  loading,
  error,
  statusNote,
  prompt,
  onClose,
  onAskFollowUp,
  highlights,
  sourceGroupId,
  followUps,
}: AuraResponsePanelProps) {
  const borderColor = colorMap[color];
  const [followUpText, setFollowUpText] = useState("");
  const [followUpWebSearch, setFollowUpWebSearch] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const taskText = useMemo(() => {
    return taskDetail ? `${taskLabel}: ${taskDetail}` : taskLabel;
  }, [taskLabel, taskDetail]);

  return (
    <div
      className="aura-response-panel"
      data-response-id={id}
      style={{
        borderColor: borderColor,
        borderLeftColor: borderColor,
      }}
    >
      {/* Header with close button */}
      <div className="aura-panel-header" style={{ borderBottomColor: `${borderColor}33` }}>
        <div className="aura-panel-title" style={{ color: borderColor }}>
          <span className="aura-icon">✨</span>
          <span>CONTEXT PILOT</span>
        </div>
        <div className="aura-panel-actions">
          <button
            className="aura-panel-btn aura-panel-collapse"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? "Expand" : "Collapse"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "+" : "–"}
          </button>
          <button 
            className="aura-panel-btn aura-panel-close" 
            onClick={() => onClose(id)}
            title="Löschen"
          >
            ×
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="aura-panel-body">
          {/* Source Quote - kurz */}
      <div className="aura-source-quote">
        <span className="quote-mark" style={{ color: borderColor }}>"</span>
        <span className="quote-text" data-group-id={sourceGroupId}>
          <HighlightedText text={sourceText} highlights={highlights} groupId={sourceGroupId} />
        </span>
        <span className="quote-mark" style={{ color: borderColor }}>"</span>
      </div>

      {/* Task */}
      <div className="aura-task">
        <div className="aura-task-head" style={{ color: borderColor }}>
          <span className="aura-task-icon">⌁</span>
          <span>Task</span>
        </div>
        <div className="aura-task-body" data-group-id={`aura-task-${id}`}>
          <HighlightedText text={taskText} highlights={highlights} groupId={`aura-task-${id}`} />
        </div>
      </div>

      {/* Content */}
      <div className="aura-panel-content">
        {prompt && (
          <details className="aura-prompt">
            <summary>Prompt</summary>
            <pre>{prompt}</pre>
          </details>
        )}
        {loading && (
          <div className="aura-loading">
            <span className="aura-spinner" style={{ color: borderColor }}>◌</span>
            <span>{statusNote || "Analysiert..."}</span>
          </div>
        )}
        
        {error && (
          <div className="aura-error">
            <span className="error-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}
        
        {!loading && !error && result && (
          <div className="aura-result">
            {renderFormattedResult(result, `aura-result-${id}`)}
          </div>
        )}
        
        {!loading && !error && !result && (
          <div className="aura-placeholder">
            Warte auf Antwort...
          </div>
        )}

        {/* Follow-up Thread */}
        {followUps.length > 0 && (
          <div className="aura-followups">
            {followUps.map((fu, idx) => (
              <div key={fu.id} className="aura-followup">
                <div className="aura-followup-q">
                  <span className="aura-followup-badge">Q{idx + 1}</span>
                  <span data-group-id={`aura-fu-q-${id}-${fu.id}`}>
                    <HighlightedText
                      text={fu.question}
                      highlights={highlights}
                      groupId={`aura-fu-q-${id}-${fu.id}`}
                    />
                  </span>
                </div>
                <div className="aura-followup-a">
                  <span className="aura-followup-badge">A{idx + 1}</span>
                  {fu.error ? (
                    <span className="aura-followup-error">{fu.error}</span>
                  ) : (
                    <div className="aura-followup-answer">
                      {renderFormattedResult(
                        fu.answer || (fu.loading ? "Thinking..." : ""),
                        `aura-fu-a-${id}-${fu.id}`,
                      )}
                    </div>
                  )}
                </div>
                {fu.prompt && (
                  <details className="aura-prompt aura-prompt-followup">
                    <summary>Prompt</summary>
                    <pre>{fu.prompt}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ask follow-up (right column only) */}
        <div className="aura-followup-input">
          <textarea
            value={followUpText}
            rows={2}
            placeholder="Ask a follow-up question about this context + Ctrl+Enter"
            onChange={(e) => setFollowUpText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const q = followUpText.trim();
                if (!q) return;
                onAskFollowUp(id, q, { webSearch: followUpWebSearch });
                setFollowUpText("");
              }
            }}
          />
          <label className="websearch-toggle">
            <input
              type="checkbox"
              checked={followUpWebSearch}
              onChange={(e) => setFollowUpWebSearch(e.target.checked)}
            />
            <span>Web Search</span>
          </label>
          <button
            className="aura-followup-btn"
            onClick={() => {
              const q = followUpText.trim();
              if (!q) return;
              onAskFollowUp(id, q, { webSearch: followUpWebSearch });
              setFollowUpText("");
            }}
            disabled={!followUpText.trim()}
            title="Send follow-up"
          >
            Send
          </button>
        </div>
      </div>
        </div>
      )}
    </div>
  );
}


