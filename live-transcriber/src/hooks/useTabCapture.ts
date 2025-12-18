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
 * Hook for tab audio capture via getDisplayMedia.
 * Lets us capture audio from a browser tab without virtual cable.
 * Supports:
 * - Chrome/Edge: tab audio
 * - Firefox: system audio (limited)
 */
export function useTabCapture(): TabCaptureResult {
  const [state, setState] = useState<TabCaptureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCapture = useCallback(async (): Promise<MediaStream | null> => {
    try {
      setError(null);
      setState("capturing");

      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("getDisplayMedia is not supported by this browser.");
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        // IMPORTANT: do not restrict to browser tabs only.
        // Leaving `video` unconstrained lets the picker offer tabs, windows, and entire screen.
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // @ts-ignore Chrome-specific
          suppressLocalAudioPlayback: false,
        },
        // @ts-ignore Chrome-specific
        // Do NOT prefer the current tab; user should be able to choose any tab/window/screen.
        preferCurrentTab: false,
        // @ts-ignore Chrome-specific
        selfBrowserSurface: "include",
        // @ts-ignore Chrome-specific
        systemAudio: "include",
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error(
          "No audio track found. Please enable 'Share tab audio' in the dialog."
        );
      }

      console.log("[TabCapture] Audio Track:", audioTracks[0].label);
      console.log("[TabCapture] Audio Settings:", audioTracks[0].getSettings());

      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

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
          setError("Tab audio access denied. Please allow screen sharing.");
        } else if (err.name === "NotFoundError") {
          setError("No suitable tab found.");
        } else if (err.name === "NotSupportedError") {
          setError("Tab audio capture is not supported in this browser.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Unknown error during tab audio capture.");
      }

      return null;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
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
