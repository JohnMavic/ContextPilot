import { useState, useEffect, useRef, memo } from "react";

interface TypewriterTextProps {
  text: string;
  wordsPerSecond?: number; // Wie viele Wörter pro Sekunde angezeigt werden
}

/**
 * Zeigt Text Wort für Wort mit sanfter Animation an.
 * Neue Wörter werden flüssig angehängt, nicht als Block.
 */
export const TypewriterText = memo(function TypewriterText({ 
  text, 
  wordsPerSecond = 8 
}: TypewriterTextProps) {
  const [displayedWordCount, setDisplayedWordCount] = useState(0);
  const previousTextRef = useRef("");
  const words = text.split(/\s+/).filter(Boolean);
  
  useEffect(() => {
    // Wenn sich der Text geändert hat
    if (text !== previousTextRef.current) {
      const prevWords = previousTextRef.current.split(/\s+/).filter(Boolean);
      
      // Prüfen wie viele Wörter vom alten Text noch übereinstimmen
      let matchingWords = 0;
      for (let i = 0; i < Math.min(prevWords.length, words.length); i++) {
        if (prevWords[i] === words[i]) {
          matchingWords++;
        } else {
          break;
        }
      }
      
      // Behalte bereits angezeigte Wörter, aber nie mehr als matching
      const startFrom = Math.max(0, Math.min(displayedWordCount, matchingWords));
      setDisplayedWordCount(startFrom);
      previousTextRef.current = text;
    }
  }, [text, words.length, displayedWordCount]);
  
  useEffect(() => {
    // Animiere neue Wörter mit leichter Variation für natürlicheres Gefühl
    if (displayedWordCount < words.length) {
      // Basis-Delay + kleine Zufallsvariation (±20%)
      const baseDelay = 1000 / wordsPerSecond;
      const variation = baseDelay * 0.2 * (Math.random() - 0.5);
      const delay = baseDelay + variation;
      
      const timer = setTimeout(() => {
        setDisplayedWordCount((c) => Math.min(c + 1, words.length));
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [displayedWordCount, words.length, wordsPerSecond]);
  
  // Zeige alle Wörter sofort an (kein Typewriter-Cursor hier, wird extern gesteuert)
  const displayedText = words.slice(0, displayedWordCount).join(" ");
  
  return (
    <span className="typewriter-text">
      {displayedText}
    </span>
  );
});
