import { useMemo, useState } from "react";
import { DeviceSelector } from "./components/DeviceSelector";
import { useRealtime } from "./hooks/useRealtime";

const apiKeyFromEnv = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) || "";

function statusLabel(status: string) {
  switch (status) {
    case "connecting":
      return "Verbindung wird aufgebaut...";
    case "running":
      return "Live";
    case "error":
      return "Fehler";
    default:
      return "Bereit";
  }
}

export default function App() {
  const [deviceId, setDeviceId] = useState<string>();
  const {
    status,
    error,
    transcript,
    start,
    stop,
    resetTranscript,
    stats,
  } = useRealtime();

  const mergedTranscript = useMemo(
    () => transcript.map((t) => t.text).join(""),
    [transcript],
  );

  return (
    <div className="layout">
      <header>
        <div>
          <p className="eyebrow">React/Vite x OpenAI Realtime</p>
          <h1>Live-Transkription</h1>
          <p className="muted">
            Mikro + Systemsound via virtuelles Device einspeisen, per WebSocket an
            den intent=transcription Endpoint schicken und Text live anzeigen.
          </p>
        </div>
        <div className={`status-pill status-${status}`}>
          <span className="dot" />
          {statusLabel(status)}
        </div>
      </header>

      <section className="panel">
        <div className="controls">
          <div className="hint">
            OpenAI API Key wird aus <code>.env.local</code> gelesen. Kein Key im UI nötig.
          </div>

          <DeviceSelector onSelect={setDeviceId} />

          <div className="buttons">
            <button
              onClick={() => start(apiKeyFromEnv, deviceId)}
              disabled={!apiKeyFromEnv || status === "running" || status === "connecting"}
            >
              Start
            </button>
            <button onClick={() => stop()}>Stop</button>
            <button onClick={() => resetTranscript()}>Leeren</button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="hint">
            Tipp: Wenn die Verbindung nicht aufgebaut wird, pruefe Mixed
            Content/HTTPS und ob das virtuelle Audio-Device als Standardaufnahme
            gesetzt ist. Browser kann keine Auth-Header im WS-Handshake senden;
            Query-Key nur in gesicherten Dev-Umgebungen nutzen.
          </div>
        </div>
      </section>

      <section className="panel transcript">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Transkript</p>
            <h2>Livetext</h2>
          </div>
          <div className="muted" style={{ textAlign: "right", fontSize: 13 }}>
            Frames gesendet: {stats.framesSent} | Bytes gesendet: {stats.bytesSent} | Letztes Event:{" "}
            {stats.lastEventType || "—"}
          </div>
        </div>
        <div className="transcript-box">
          {transcript.length === 0 && (
            <p className="muted">Noch keine Eingaben. Starte die Transkription.</p>
          )}
          {transcript.map((t) => (
            <div key={t.id} className={t.isFinal ? "final-line" : "live-line"}>
              {t.text}
            </div>
          ))}
        </div>
        <details className="raw">
          <summary>Rohtext (zusammengefuehrt)</summary>
          <pre>{mergedTranscript}</pre>
        </details>
      </section>
    </div>
  );
}
