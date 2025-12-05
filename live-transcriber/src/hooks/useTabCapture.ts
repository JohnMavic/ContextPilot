import { useCallback, useRef, useState } from "react";

export type TabCaptureState = "idle" | "capturing" | "error";

export interface TabCaptureResult {
  state: TabCaptureState;
  stream: MediaStream | null;
  error: string | null;
  startCapture: () => Promise<MediaStream | null>;
  stopCapture: () => void;
}

/**
 * Hook für Tab Audio Capture via getDisplayMedia API.
 * Ermöglicht das Erfassen von Audio aus einem Browser-Tab ohne VB-Cable.
 * 
 * Unterstützt:
 * - Chrome/Edge: Tab Audio direkt
 * - Firefox: System Audio (begrenzt)
 */
export function useTabCapture(): TabCaptureResult {
  const [state, setState] = useState<TabCaptureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    try {
      setError(null);
      setState("capturing");

      // Prüfe ob getDisplayMedia verfügbar ist
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("getDisplayMedia wird von diesem Browser nicht unterstützt");
      }

      // Request Display Media mit Audio
      // preferCurrentTab: true priorisiert den aktuellen Tab (Chrome 107+)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser", // Bevorzugt Browser-Tabs
        } as MediaTrackConstraints,
        audio: {
          // Chrome-spezifische Einstellungen für bessere Audio-Qualität
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // @ts-ignore - Chrome-spezifisch
          suppressLocalAudioPlayback: false, // Audio weiter abspielen
        },
        // @ts-ignore - Chrome 107+ spezifisch
        preferCurrentTab: false, // User soll Tab wählen können
        // @ts-ignore - Chrome spezifisch
        selfBrowserSurface: "include", // Eigenen Tab auch anbieten
        // @ts-ignore - Chrome spezifisch
        systemAudio: "include", // System Audio wenn möglich
      });

      // Prüfe ob Audio-Track vorhanden ist
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        // User hat wahrscheinlich "Audio teilen" nicht aktiviert
        stream.getTracks().forEach(t => t.stop());
        throw new Error(
          "Kein Audio-Track gefunden. Bitte aktiviere 'Tab-Audio teilen' im Dialog!"
        );
      }

      console.log("[TabCapture] Audio Track:", audioTracks[0].label);
      console.log("[TabCapture] Audio Settings:", audioTracks[0].getSettings());

      // Video-Track stoppen - wir brauchen nur Audio
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach(track => {
        track.stop();
        stream.removeTrack(track);
      });

      // Event Handler für wenn User das Sharing beendet
      audioTracks[0].onended = () => {
        console.log("[TabCapture] Audio sharing stopped by user");
        stopCapture();
      };

      streamRef.current = stream;
      return stream;

    } catch (err) {
      console.error("[TabCapture] Error:", err);
      setState("error");
      
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setError("Tab-Audio-Zugriff verweigert. Bitte erlaube die Bildschirmfreigabe.");
        } else if (err.name === "NotFoundError") {
          setError("Kein geeigneter Tab gefunden.");
        } else if (err.name === "NotSupportedError") {
          setError("Tab Audio Capture wird von diesem Browser nicht unterstützt.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Unbekannter Fehler beim Tab-Audio-Capture");
      }
      
      return null;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setState("idle");
    setError(null);
  }, []);

  return {
    state,
    stream: streamRef.current,
    error,
    startCapture,
    stopCapture,
  };
}
