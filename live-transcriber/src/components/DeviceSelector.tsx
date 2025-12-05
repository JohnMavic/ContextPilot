import { useEffect, useState } from "react";

type Props = {
  onSelect: (id?: string) => void;
};

export function DeviceSelector({ onSelect }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<string>("");

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

  return (
    <label className="field">
      <span>Audioquelle</span>
      <select
        value={selected}
        onChange={(e) => {
          const id = e.target.value;
          setSelected(id);
          onSelect(id || undefined);
        }}
      >
        <option value="">System-Standard</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || "Audio Input"}
          </option>
        ))}
      </select>
    </label>
  );
}
