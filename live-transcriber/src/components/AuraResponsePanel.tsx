import type { HighlightColor } from "../hooks/useHighlights";

// Farben passend zu den Highlight-Klassen
const colorMap: Record<HighlightColor, string> = {
  1: "#ef4444", // rot
  2: "#22c55e", // grün
  3: "#f97316", // orange
  4: "#facc15", // gelb
  5: "#3b82f6", // blau
};

// Formatiert eine einzelne Zeile: Bold, Links, Quellenangaben, Sub-Tags
function formatLine(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let keyIndex = 0;
  
  // Regex für verschiedene Markdown-Elemente
  // Reihenfolge: Sub-Tags, Links, Quellenangaben (【...】), Bold
  const combinedRegex = /(<sub>(.+?)<\/sub>)|(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|(【[^】]+】)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = combinedRegex.exec(text)) !== null) {
    // Text vor dem Match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    if (match[1]) {
      // <sub>...</sub> - match[2] ist der Text
      parts.push(<sub key={keyIndex++} className="aura-sub">{match[2]}</sub>);
    } else if (match[3]) {
      // **Bold** - match[4] ist der Text
      parts.push(<strong key={keyIndex++}>{match[4]}</strong>);
    } else if (match[5]) {
      // [text](url) - match[6] ist Text, match[7] ist URL
      parts.push(
        <a 
          key={keyIndex++} 
          href={match[7]} 
          target="_blank" 
          rel="noopener noreferrer"
          className="aura-link"
        >
          {match[6]}
        </a>
      );
    } else if (match[8]) {
      // 【Quellenangabe】 - als kleine Badge darstellen
      parts.push(
        <span key={keyIndex++} className="aura-source-badge">
          {match[8]}
        </span>
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Rest anhängen
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
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
  return /^\s+<sub>/.test(line);
}

// Rendert den formatierten Result-Text
function renderFormattedResult(result: string): React.ReactNode {
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
          {formatLine(block.lines[0])}
        </HeadingTag>
      );
    } else if (block.type === "bullet") {
      elements.push(
        <div key={i} className="aura-bullet-item">
          <span className="bullet-marker">{block.bullet}</span>
          <span className="bullet-text">
            {block.lines.map((l, j) => (
              <span key={j}>{formatLine(l)}</span>
            ))}
          </span>
        </div>
      );
    } else {
      elements.push(
        <p key={i} className="aura-paragraph">
          {block.lines.map((l, j) => (
            <span key={j}>{formatLine(l)}</span>
          ))}
        </p>
      );
    }
  }
  
  return elements;
}

interface AuraResponsePanelProps {
  id: string;
  sourceText: string;
  color: HighlightColor;
  result: string | null;
  loading: boolean;
  error: string | null;
  statusNote?: string;
  onClose: (id: string) => void;
}

export function AuraResponsePanel({
  id,
  sourceText,
  color,
  result,
  loading,
  error,
  statusNote,
  onClose,
}: AuraResponsePanelProps) {
  const borderColor = colorMap[color];

  return (
    <div
      className="aura-response-panel"
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
        <button 
          className="aura-panel-btn aura-panel-close" 
          onClick={() => onClose(id)}
          title="Löschen"
        >
          ×
        </button>
      </div>

      {/* Source Quote - kurz */}
      <div className="aura-source-quote">
        <span className="quote-mark" style={{ color: borderColor }}>"</span>
        <span className="quote-text">
          {sourceText.length > 60 ? sourceText.slice(0, 57) + "…" : sourceText}
        </span>
        <span className="quote-mark" style={{ color: borderColor }}>"</span>
      </div>

      {/* Content */}
      <div className="aura-panel-content">
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
            {renderFormattedResult(result)}
          </div>
        )}
        
        {!loading && !error && !result && (
          <div className="aura-placeholder">
            Warte auf Antwort...
          </div>
        )}
      </div>
    </div>
  );
}


