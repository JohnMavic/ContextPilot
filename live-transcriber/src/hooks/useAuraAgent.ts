import { useState, useCallback, useRef } from "react";
import type { HighlightColor } from "./useHighlights";

export interface AuraResponse {
  id: string;              // Eindeutige ID für diese Antwort
  highlightId: string;     // Verknüpfung zum Highlight
  sourceText: string;      // Der markierte Text
  color: HighlightColor;   // Farbe (gleich wie Highlight)
  queryType: "expand" | "facts" | "full";
  loading: boolean;
  result: string | null;
  error: string | null;
  anchorTop: number;       // Y-Position des zugehörigen Highlights
  statusNote?: string;     // z.B. Rate-Limit Hinweis
}

export function useAuraAgent() {
  const [responses, setResponses] = useState<AuraResponse[]>([]);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Generate unique ID
  const generateId = () => `aura-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Start a new query - creates a new response entry
  const queryAgent = useCallback(async (
    prompt: string,
    highlightId: string,
    sourceText: string,
    color: HighlightColor,
    anchorTop: number,
    queryType: "expand" | "facts" | "full" = "expand"
  ) => {
    if (!prompt) return;

    const responseId = generateId();
    
    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllersRef.current.set(responseId, abortController);

    // Add new response entry (loading state)
    const newResponse: AuraResponse = {
      id: responseId,
      highlightId,
      sourceText,
      color,
      queryType,
      loading: true,
      result: null,
      error: null,
      anchorTop,
      statusNote: undefined,
    };

    setResponses(prev => [...prev, newResponse]);

    try {
      const maxRetries = 3;
      let attempt = 0;
      let shouldRetry = false;

      do {
        shouldRetry = false;
        const resp = await fetch("http://localhost:8080/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, stream: true }),
          signal: abortController.signal,
        });

        if (resp.status === 429) {
          const retryAfterHeader = resp.headers.get("retry-after");
          let retryDelayMs = 0;
          if (retryAfterHeader) {
            const parsed = parseFloat(retryAfterHeader);
            if (!Number.isNaN(parsed)) {
              retryDelayMs = parsed * 1000;
            }
          }
          if (retryDelayMs === 0) {
            retryDelayMs = Math.min(8000, 1000 * Math.pow(2, attempt));
          }

          if (attempt < maxRetries) {
            attempt += 1;
            const waitSeconds = Math.round(retryDelayMs / 100) / 10;
            setResponses(prev =>
              prev.map(r =>
                r.id === responseId
                  ? { ...r, statusNote: `Rate limit, retrying in ${waitSeconds}s...` }
                  : r
              )
            );
            await new Promise(res => setTimeout(res, retryDelayMs));
            shouldRetry = true;
            continue;
          } else {
            const json = await resp.json().catch(() => null);
            const msg = json?.error || "Rate limit exceeded";
            throw new Error(msg);
          }
        }

        if (!resp.ok) {
          const json = await resp.json().catch(() => null);
          throw new Error(json?.error || `Agent request failed (${resp.status})`);
        }

        const contentType = resp.headers.get("content-type") || "";

        if (contentType.includes("text/event-stream")) {
          // STREAMING: Read SSE events
          const reader = resp.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let fullText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                try {
                  const event = JSON.parse(data);
                  if (event.done) {
                    fullText = event.output_text || fullText;
                  } else if (event.partial) {
                    fullText = event.partial;
                  }
                  // Update this specific response
                  setResponses(prev =>
                    prev.map(r =>
                      r.id === responseId ? { ...r, result: fullText, statusNote: undefined } : r
                    )
                  );
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        } else {
          // NON-STREAMING
          const json = await resp.json();
          const output = json.output_text || JSON.stringify(json);
          setResponses(prev =>
            prev.map(r =>
              r.id === responseId ? { ...r, result: output, statusNote: undefined } : r
            )
          );
        }

        // Mark as done loading
        setResponses(prev =>
          prev.map(r =>
            r.id === responseId ? { ...r, loading: false, statusNote: undefined } : r
          )
        );
      } while (shouldRetry);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Request was cancelled, remove the response
        setResponses(prev => prev.filter(r => r.id !== responseId));
        return;
      }
      // Set error state
      setResponses(prev =>
        prev.map(r =>
          r.id === responseId
            ? { ...r, loading: false, error: err instanceof Error ? err.message : String(err), statusNote: undefined }
            : r
        )
      );
    } finally {
      abortControllersRef.current.delete(responseId);
    }
  }, []);

  // Remove a single response
  const removeResponse = useCallback((responseId: string) => {
    // Cancel ongoing request if any
    const controller = abortControllersRef.current.get(responseId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(responseId);
    }
    setResponses(prev => prev.filter(r => r.id !== responseId));
  }, []);

  // Remove response by highlight ID (when highlight is deleted)
  const removeResponseByHighlight = useCallback((highlightId: string) => {
    setResponses(prev => {
      const toRemove = prev.filter(r => r.highlightId === highlightId);
      toRemove.forEach(r => {
        const controller = abortControllersRef.current.get(r.id);
        if (controller) {
          controller.abort();
          abortControllersRef.current.delete(r.id);
        }
      });
      return prev.filter(r => r.highlightId !== highlightId);
    });
  }, []);

  // Clear all responses
  const clearAllResponses = useCallback(() => {
    // Cancel all ongoing requests
    abortControllersRef.current.forEach(controller => controller.abort());
    abortControllersRef.current.clear();
    setResponses([]);
  }, []);

  return {
    responses,
    queryAgent,
    removeResponse,
    removeResponseByHighlight,
    clearAllResponses,
  };
}
