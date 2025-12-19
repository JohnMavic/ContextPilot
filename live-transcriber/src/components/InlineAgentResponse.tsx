import { HighlightedText } from "./HighlightedText";
import type { HighlightColor, Highlight } from "../hooks/useHighlights";

// Farben passend zu den Highlight-Klassen
const colorMap: Record<HighlightColor, string> = {
  1: "#ef4444", // rot
  2: "#22c55e", // grün
  3: "#f97316", // orange
  4: "#facc15", // gelb
  5: "#3b82f6", // blau
};

// Formatiert eine einzelne Zeile: Bold, Links, Quellenangaben, Sub-Tags
// Rendert mit klickbaren Links und Markdown-Formatierung
const normalizeInlineTags = (value: string) =>
  value
    .replace(/&lt;(\/?)(small|sub)&gt;/gi, (_, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`)
    .replace(/<(\/?)(small|sub)>/gi, (_, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`);

function formatLineWithLinks(text: string, keyPrefix: string = ""): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let keyIndex = 0;
  const normalizedText = normalizeInlineTags(text);
  
  // Regex für: <sub>, **bold**, [text](url), 【source】, plain URLs
  const combinedRegex = /(<small>(.+?)<\/small>)|(<sub>(.+?)<\/sub>)|(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|(【[^】]+】)|(https?:\/\/[^\s<>]+)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = combinedRegex.exec(normalizedText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(normalizedText.slice(lastIndex, match.index));
    }
    
    if (match[1]) {
      // <small>...</small>
      parts.push(<small key={`${keyPrefix}-${keyIndex++}`} className="aura-sub">{match[2]}</small>);
    } else if (match[3]) {
      // <sub>...</sub>
      parts.push(<sub key={`${keyPrefix}-${keyIndex++}`} className="aura-sub">{match[4]}</sub>);
    } else if (match[5]) {
      // **Bold**
      parts.push(<strong key={`${keyPrefix}-${keyIndex++}`}>{match[6]}</strong>);
    } else if (match[7]) {
      // [text](url) - Markdown Link
      parts.push(
        <a 
          key={`${keyPrefix}-${keyIndex++}`} 
          href={match[9]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="aura-link"
          onClick={(e) => e.stopPropagation()}
        >
          {match[8]}
        </a>
      );
    } else if (match[10]) {
      // 【Quellenangabe】
      parts.push(<span key={`${keyPrefix}-${keyIndex++}`} className="aura-source-badge">{match[10]}</span>);
    } else if (match[11]) {
      // Plain URL (https://...)
      parts.push(
        <a 
          key={`${keyPrefix}-${keyIndex++}`} 
          href={match[11]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="aura-link"
          onClick={(e) => e.stopPropagation()}
        >
          {match[11]}
        </a>
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < normalizedText.length) {
    parts.push(normalizedText.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
}

function isBulletLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed);
}

function isHeadingLine(line: string): { level: number; text: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(#{1,3})\s+(.*)$/);
  return match ? { level: match[1].length, text: match[2] } : null;
}

function parseBulletLine(line: string): { bullet: string; text: string } {
  const trimmed = line.trim();
  const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
  if (numMatch) return { bullet: numMatch[1], text: numMatch[2] };
  const bulletMatch = trimmed.match(/^([-•*])\s+(.*)$/);
  if (bulletMatch) return { bullet: "•", text: bulletMatch[2] };
  return { bullet: "", text: trimmed };
}

function isIndentedSubLine(line: string): boolean {
  return /^\s*<(sub|small)>/.test(line) || /^\s+Source:/.test(line);
}

interface InlineAgentResponseProps {
  responseId: string;
  taskLabel: string;
  taskDetail?: string;
  result: string | null;
  loading: boolean;
  error: string | null;
  color: HighlightColor;
  highlights: Highlight[];
  onClose: (id: string) => void;
}

export function InlineAgentResponse({
  responseId,
  taskLabel,
  taskDetail,
  result,
  loading,
  error,
  color,
  highlights,
  onClose,
}: InlineAgentResponseProps) {
  const borderColor = colorMap[color];
  const groupId = `response-${responseId}`;
  const taskGroupId = `${groupId}-task`;
  const taskText = taskDetail ? `${taskLabel}: ${taskDetail}` : taskLabel;
  
  // Rendert den formatierten Result-Text mit Links und Markdown
  const renderFormattedResult = (resultText: string): React.ReactNode => {
    const lines = resultText.split("\n");
    const elements: React.ReactNode[] = [];
    
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
      
      if (isIndentedSubLine(line) && currentBlock) {
        currentBlock.lines.push(line.trim());
        continue;
      }
      
      const heading = isHeadingLine(line);
      if (heading) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { 
          type: "heading", 
          headingLevel: heading.level, 
          lines: [heading.text]
        };
      } else if (isBulletLine(line)) {
        if (currentBlock) blocks.push(currentBlock);
        const { bullet, text } = parseBulletLine(line);
        currentBlock = { 
          type: "bullet", 
          bullet, 
          lines: [text]
        };
      } else {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { 
          type: "paragraph", 
          lines: [line.trim()]
        };
      }
    }
    if (currentBlock) blocks.push(currentBlock);
    
    // Blöcke rendern mit formatLineWithLinks für klickbare Links
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      if (block.type === "heading") {
        const HeadingTag = `h${(block.headingLevel || 1) + 2}` as keyof JSX.IntrinsicElements;
        elements.push(
          <HeadingTag key={i} className="aura-heading inline-response-heading">
            <span data-group-id={groupId}>
              {block.lines.map((l, j) => (
                <span key={j}>{formatLineWithLinks(l, `h-${i}-${j}`)}</span>
              ))}
            </span>
          </HeadingTag>
        );
      } else if (block.type === "bullet") {
        elements.push(
          <div key={i} className="aura-bullet-item inline-response-bullet">
            <span className="bullet-marker">{block.bullet}</span>
            <span className="bullet-text">
              <span data-group-id={groupId}>
                {block.lines.map((l, j) => (
                  <span key={j}>{formatLineWithLinks(l, `b-${i}-${j}`)}{j < block.lines.length - 1 ? " " : ""}</span>
                ))}
              </span>
            </span>
          </div>
        );
      } else {
        elements.push(
          <p key={i} className="aura-paragraph inline-response-paragraph">
            <span data-group-id={groupId}>
              {block.lines.map((l, j) => (
                <span key={j}>{formatLineWithLinks(l, `p-${i}-${j}`)}</span>
              ))}
            </span>
          </p>
        );
      }
    }
    
    return elements;
  };

  return (
    <div 
      className="inline-agent-response"
      style={{ 
        borderLeftColor: borderColor,
        "--response-color": borderColor 
      } as React.CSSProperties}
      data-response-id={responseId}
    >
      {/* Header mit Icon und Close Button */}
      <div className="inline-response-header">
        <span className="inline-response-icon" style={{ color: borderColor }}>✨</span>
        <span className="inline-response-label">CONTEXT PILOT</span>
        <button 
          className="inline-response-close"
          onClick={() => onClose(responseId)}
          title="Löschen"
        >
          ×
        </button>
      </div>
      
      {/* Content - markierbarer Text */}
      <div className="inline-response-content" data-group-id={groupId}>
        <div className="inline-response-task">
          <span className="inline-response-task-label">Task:</span>{" "}
          <span data-group-id={taskGroupId}>
            <HighlightedText text={taskText} highlights={highlights} groupId={taskGroupId} />
          </span>
        </div>
        {loading && (
          <div className="inline-response-loading">
            <span className="aura-spinner" style={{ color: borderColor }}>◌</span>
            <span>Analysiert...</span>
          </div>
        )}
        
        {error && (
          <div className="inline-response-error">
            <span>⚠ {error}</span>
          </div>
        )}
        
        {!loading && !error && result && (
          <div className="inline-response-result">
            {renderFormattedResult(result)}
          </div>
        )}
      </div>
    </div>
  );
}
