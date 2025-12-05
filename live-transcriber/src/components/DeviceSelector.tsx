import { useEffect, useState } from "react";

export type SpeakerSource = "none" | "device" | "tab";

type Props = {
  onSelect: (micId?: string, speakerId?: string) => void;
  onSpeakerSourceChange: (source: SpeakerSource) => void;
  tabCaptureActive?: boolean;
  tabCaptureError?: string | null;
};

export function DeviceSelector({ 
  onSelect, 
  onSpeakerSourceChange,
  tabCaptureActive = false,
  tabCaptureError = null,
}: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [speakerId, setSpeakerId] = useState<string>("");
  const [speakerSource, setSpeakerSource] = useState<SpeakerSource>("none");

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) =>
        setDevices(list.filter((d) => d.kind === "audioinput")),
      )
      .catch((err) => {
        console.error("enumerateDevices failed", err);
      });
  }, []);

  useEffect(() => {
    // Nur Device-ID weitergeben wenn auch Device-Modus gewählt
    const effectiveSpeakerId = speakerSource === "device" ? speakerId : undefined;
    onSelect(micId || undefined, effectiveSpeakerId);
  }, [micId, speakerId, speakerSource, onSelect]);

  useEffect(() => {
    onSpeakerSourceChange(speakerSource);
  }, [speakerSource, onSpeakerSourceChange]);

  return (
    <div className="device-selectors">
      <label className="field">
        <span>🎤 Mikrofon</span>
        <select
          value={micId}
          onChange={(e) => setMicId(e.target.value)}
        >
          <option value="">-- Nicht verwenden --</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Audio Input"}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>🔊 System-Audio Quelle</span>
        <div className="speaker-source-selector">
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="none"
              checked={speakerSource === "none"}
              onChange={() => setSpeakerSource("none")}
            />
            <span>Nicht verwenden</span>
          </label>
          
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="tab"
              checked={speakerSource === "tab"}
              onChange={() => setSpeakerSource("tab")}
            />
            <span>🌐 Tab Audio Capture</span>
            <span className="badge recommended">Empfohlen</span>
          </label>
          
          <label className="radio-option">
            <input
              type="radio"
              name="speakerSource"
              value="device"
              checked={speakerSource === "device"}
              onChange={() => setSpeakerSource("device")}
            />
            <span>📟 Audio-Device (VB-Cable etc.)</span>
          </label>
        </div>
      </div>

      {/* Tab Capture Info */}
      {speakerSource === "tab" && (
        <div className="tab-capture-info">
          {tabCaptureActive ? (
            <p className="success">✅ Tab-Audio wird erfasst</p>
          ) : (
            <p className="hint">
              Beim Start wirst du aufgefordert, einen Browser-Tab auszuwählen.
              <br />
              <strong>Wichtig:</strong> Aktiviere "Tab-Audio teilen" im Dialog!
            </p>
          )}
          {tabCaptureError && (
            <p className="error">{tabCaptureError}</p>
          )}
        </div>
      )}

      {/* Device Selector für VB-Cable Fallback */}
      {speakerSource === "device" && (
        <label className="field">
          <span>Audio-Device auswählen</span>
          <select
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          >
            <option value="">-- Device wählen --</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Audio Input"}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 4, fontSize: 12 }}>
            Nutze ein virtuelles Device wie "VB-Cable" oder "Stereo Mix"
          </p>
        </label>
      )}
    </div>
  );
}
