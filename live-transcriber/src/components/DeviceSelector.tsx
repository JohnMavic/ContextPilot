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
  const [speakerSource, setSpeakerSource] = useState<SpeakerSource>("tab");

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
    const effectiveSpeakerId = speakerSource === "device" ? speakerId : undefined;
    onSelect(micId || undefined, effectiveSpeakerId);
  }, [micId, speakerId, speakerSource, onSelect]);

  useEffect(() => {
    onSpeakerSourceChange(speakerSource);
  }, [speakerSource, onSpeakerSourceChange]);

  return (
    <div className="device-selectors">
      <label className="field">
        <span>Mic</span>
        <select
          value={micId}
          onChange={(e) => setMicId(e.target.value)}
        >
          <option value="">-- Do not use --</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Audio input"}
            </option>
          ))}
        </select>
      </label>

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

      {speakerSource === "tab" && (
        <div className="tab-capture-info">
          {tabCaptureActive ? (
            <p className="success">Tab audio is being captured</p>
          ) : (
            <p className="hint">
              When you start, you will be asked to choose a browser tab.
              <br />
              <strong>Important:</strong> enable "Share tab audio" in the dialog.
            </p>
          )}
          {tabCaptureError && (
            <p className="error">{tabCaptureError}</p>
          )}
        </div>
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
