import { useEffect, useState, useCallback } from "react";
import { VolumeMeter } from "./VolumeMeter";

export type SpeakerSource = "none" | "device" | "tab";

type Props = {
  onSelect: (micId?: string, speakerId?: string) => void;
  onSpeakerSourceChange: (source: SpeakerSource) => void;
  tabCaptureError?: string | null;
  // Volume levels and mute controls
  micLevel?: number;
  spkLevel?: number;
  micMuted?: boolean;
  spkMuted?: boolean;
  onMicMuteToggle?: () => void;
  onSpkMuteToggle?: () => void;
  isRunning?: boolean;
};

export function DeviceSelector({ 
  onSelect, 
  onSpeakerSourceChange,
  tabCaptureError = null,
  micLevel = 0,
  spkLevel = 0,
  micMuted = false,
  spkMuted = false,
  onMicMuteToggle,
  onSpkMuteToggle,
  isRunning = false,
}: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("default"); // Default: Windows Standard-Gerät
  const [speakerId, setSpeakerId] = useState<string>("");
  const [speakerSource, setSpeakerSource] = useState<SpeakerSource>("tab");
  const [defaultDeviceLabel, setDefaultDeviceLabel] = useState<string>("");

  // Funktion zum Auslesen der Geräte - wiederverwendbar
  const refreshDevices = useCallback(async () => {
    try {
      // Erst Permission anfragen um Labels zu bekommen
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stream sofort stoppen, wir brauchen nur die Permission
      stream.getTracks().forEach(track => track.stop());
      
      // Jetzt Geräte mit Labels auflisten
      const list = await navigator.mediaDevices.enumerateDevices();
      let audioInputs = list.filter((d) => d.kind === "audioinput");
      
      // Entferne "Communications - X" Duplikate wenn "X" bereits existiert
      // Windows erstellt für Bluetooth-Geräte oft beide Endpunkte
      const nonCommDevices = audioInputs.filter(d => !d.label.startsWith("Communications - "));
      const commDevices = audioInputs.filter(d => d.label.startsWith("Communications - "));
      
      // Behalte Communications-Gerät nur wenn kein äquivalentes Nicht-Comm-Gerät existiert
      const filteredCommDevices = commDevices.filter(commDev => {
        const baseName = commDev.label.replace("Communications - ", "");
        // Prüfe ob es ein äquivalentes Gerät ohne "Communications" gibt
        return !nonCommDevices.some(d => 
          d.label === baseName || 
          d.label.includes(baseName) || 
          baseName.includes(d.label.split(" (")[0])
        );
      });
      
      audioInputs = [...nonCommDevices, ...filteredCommDevices];
      setDevices(audioInputs);
      
      // Finde das Default-Gerät (hat deviceId "default" oder ist das erste)
      const defaultDevice = audioInputs.find(d => d.deviceId === "default");
      if (defaultDevice && defaultDevice.label) {
        // Extrahiere den echten Gerätenamen aus "Default - Gerätename (Hersteller)"
        const match = defaultDevice.label.match(/^Default\s*-?\s*(.+)$/i);
        if (match) {
          setDefaultDeviceLabel(match[1].trim());
        } else {
          setDefaultDeviceLabel(defaultDevice.label);
        }
      } else {
        setDefaultDeviceLabel("");
      }
      
      console.log("[DeviceSelector] Devices refreshed, default:", defaultDevice?.label);
    } catch (err) {
      console.error("enumerateDevices failed", err);
      // Fallback: Versuche ohne Permission
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "audioinput"));
      } catch (e) {
        console.error("Fallback enumerate failed", e);
      }
    }
  }, []);

  // Initial und bei Device-Änderungen auslesen
  useEffect(() => {
    // Sofort beim Mount auslesen
    refreshDevices();
    
    // Listener für Gerätewechsel (z.B. wenn USB-Gerät angeschlossen wird)
    const handleDeviceChange = () => {
      console.log("[DeviceSelector] Device change detected, refreshing...");
      refreshDevices();
    };
    
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  useEffect(() => {
    const effectiveSpeakerId = speakerSource === "device" ? speakerId : undefined;
    onSelect(micId || undefined, effectiveSpeakerId);
  }, [micId, speakerId, speakerSource, onSelect]);

  useEffect(() => {
    onSpeakerSourceChange(speakerSource);
  }, [speakerSource, onSpeakerSourceChange]);

  // Formatiere Device-Label für Anzeige
  const formatDeviceLabel = (device: MediaDeviceInfo): string => {
    if (!device.label) return "Audio input";
    // Kürze lange Labels
    if (device.label.length > 50) {
      return device.label.slice(0, 47) + "...";
    }
    return device.label;
  };

  return (
    <div className="device-selectors">
      <label className="field">
        <span>Mic</span>
        <select
          value={micId}
          onChange={(e) => setMicId(e.target.value)}
        >
          <option value="">-- Do not use --</option>
          <option value="default">
            🎤 Windows Default{defaultDeviceLabel ? ` (${defaultDeviceLabel})` : ""}
          </option>
          {devices
            .filter(d => d.deviceId !== "default") // Default nicht doppelt anzeigen
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {formatDeviceLabel(d)}
              </option>
            ))}
        </select>
      </label>

      {/* MIC Volume Meter with Mute Button */}
      <div className="volume-meter-row">
        <VolumeMeter level={micMuted ? 0 : micLevel} label="MIC" />
        <button 
          className={`mic-mute-btn ${micMuted ? 'muted' : 'recording'}`}
          onClick={onMicMuteToggle}
          title={micMuted ? "Start recording" : "Stop recording"}
          disabled={!isRunning}
        >
          <div className="mic-icon-wrapper">
            {micMuted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mic-icon-svg">
                <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 7v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="12" cy="14" r="1" fill="currentColor"/>
                <line x1="7" y1="7" x2="17" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mic-icon-svg">
                <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity="0.4"/>
                <rect x="10" y="6" width="4" height="8" rx="2" fill="currentColor"/>
                <path d="M8 12a4 4 0 0 0 8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="12" y1="16" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </div>
        </button>
      </div>

      <div className="field">
        <h4 className="field-header">System Audio Source</h4>
        <div className="speaker-source-selector">
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="none"
              checked={speakerSource === "none"}
              onChange={() => setSpeakerSource("none")}
            />
            <span>Do not use</span>
          </label>
          
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="tab"
              checked={speakerSource === "tab"}
              onChange={() => setSpeakerSource("tab")}
            />
            <span>Tab audio capture</span>
            <span className="badge recommended">Recommended</span>
          </label>
          
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="device"
              checked={speakerSource === "device"}
              onChange={() => setSpeakerSource("device")}
            />
            <span>Audio device (VB-Cable etc.)</span>
          </label>
        </div>
      </div>

      {/* SPK Volume Meter with Mute Button */}
      {speakerSource !== "none" && (
        <div className="volume-meter-row">
          <VolumeMeter level={spkMuted ? 0 : spkLevel} label="SPK" />
          <button 
            className={`spk-mute-btn ${spkMuted ? 'muted' : 'active'}`}
            onClick={onSpkMuteToggle}
            title={spkMuted ? "Unmute speaker" : "Mute speaker"}
            disabled={!isRunning}
          >
            <div className="spk-icon-wrapper">
              {spkMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="spk-icon-svg">
                  <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 9.5v5l4 3v-11l-4 3z" fill="currentColor"/>
                  <line x1="7" y1="7" x2="17" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="spk-icon-svg">
                  <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity="0.4"/>
                  <path d="M8 9.5v5l4 3v-11l-4 3z" fill="currentColor"/>
                  <path d="M14 9.5c1 .5 1.5 1.5 1.5 2.5s-.5 2-1.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M15.5 7.5c1.5 1 2.5 2.5 2.5 4.5s-1 3.5-2.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </div>
          </button>
        </div>
      )}

      {speakerSource === "tab" && tabCaptureError && (
        <p className="error">{tabCaptureError}</p>
      )}

      {speakerSource === "device" && (
        <label className="field">
          <span>Select audio device</span>
          <select
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          >
            <option value="">-- Choose device --</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Audio input"}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 4, fontSize: 12 }}>
            Use a virtual device like "VB-Cable" or "Stereo Mix".
          </p>
        </label>
      )}
    </div>
  );
}
