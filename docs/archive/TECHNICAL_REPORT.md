# Technischer Bericht: OpenAI Realtime Transcription API - Problem mit fehlender Transkription

**Datum:** 5. Dezember 2025  
**Status:** Blockiert - Transkription wird nicht aktiviert  
**Ziel:** Live-Audio-Transkription mit OpenAI Realtime API (intent=transcription, gpt-4o-transcribe)

---

## AKTUELLER STAND (Update 12:30 Uhr)

### Letzter Versuch - mit `session` wrapper UND `type: "transcription"`:

**Gesendet:**
```json
{
  "type": "transcription_session.update",
  "session": {
    "input_audio_format": "pcm16",
    "input_audio_transcription": {
      "type": "transcription",
      "model": "gpt-4o-transcribe",
      "language": "de",
      "prompt": ""
    },
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "silence_duration_ms": 500
    }
  }
}
```

**Server-Antwort (transcription_session.created):**
```json
{
  "type": "transcription_session.created",
  "session": {
    "input_audio_format": "pcm16",
    "input_audio_transcription": null,   // <-- IMMER NOCH NULL!
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "prefix_padding_ms": 300,
      "silence_duration_ms": 200
    }
  }
}
```

**NEUER FEHLER direkt danach:**
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "code": "unknown_parameter",
    "message": "Unknown parameter: 'session.input_audio_transcription.type'.",
    "param": "session.input_audio_transcription.type"
  }
}
```

### KRITISCHE ERKENNTNIS:
Der Parameter `type: "transcription"` innerhalb von `input_audio_transcription` ist **UNGÜLTIG**!
Der Server kennt diesen Parameter nicht und lehnt ihn ab.

---

## VOLLSTÄNDIGE VERSUCHSHISTORIE

| # | Format | Ergebnis |
|---|--------|----------|
| 1 | `transcription_session.update` + `session: { input_audio_transcription: { model: ... } }` | `input_audio_transcription: null` |
| 2 | `transcription_session.update` + top-level Felder ohne session wrapper | `input_audio_transcription: null` |
| 3 | `session.update` (falscher Event-Typ) | ERROR: "not allowed for transcription session" |
| 4 | `transcription_session.update` + top-level + `type: "transcription"` | ERROR: "Missing required parameter: 'session'." |
| 5 | `transcription_session.update` + `session: { input_audio_transcription: { type: "transcription", model: ... } }` | **ERROR: "Unknown parameter: 'session.input_audio_transcription.type'."** |

### Zusammenfassung:
- ✅ `transcription_session.update` ist der richtige Event-Typ
- ✅ Felder müssen in `session` wrapper sein
- ❌ `type: "transcription"` ist ein **ungültiger Parameter**
- ❌ `input_audio_transcription` bleibt IMMER `null`

---

## FRAGE AN DEN BERATER

**Was sind die korrekten Parameter für `input_audio_transcription`?**

Laut unserem Test akzeptiert der Server nur:
- `model` 
- `language`
- `prompt`

ABER: Auch mit nur diesen Parametern bleibt `input_audio_transcription: null`!

```json
// Das haben wir probiert (Versuch 1):
{
  "type": "transcription_session.update",
  "session": {
    "input_audio_transcription": {
      "model": "gpt-4o-transcribe",
      "language": "de",
      "prompt": ""
    }
  }
}
// Ergebnis: input_audio_transcription: null
```

**Mögliche Ursachen:**
1. Falsches Modell? Gibt es ein anderes Modell für intent=transcription?
2. Fehlender Parameter, den wir nicht kennen?
3. Bug in der OpenAI API?
4. Muss die Session anders initialisiert werden (z.B. erst verbinden, dann updaten)?

---

## 1. Projektübersicht

### 1.1 Was die App macht
Eine React/Vite-Webanwendung für Live-Audio-Transkription:
1. Erfasst Audio vom Mikrofon (oder virtuellem Audio-Device)
2. Konvertiert zu PCM16 (24 kHz, mono) via AudioWorklet
3. Sendet Audio-Chunks über WebSocket an OpenAI Realtime API
4. Erwartet Transkriptions-Events und zeigt Text live an

### 1.2 Architektur
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Browser (Vite) │────▶│  Proxy (Node)   │────▶│  OpenAI API     │
│  localhost:5174 │     │  localhost:8080 │     │  Realtime WS    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │ WebSocket             │ WebSocket + Auth Header
        │ (kein Auth)           │ Authorization: Bearer <key>
        │                       │ OpenAI-Beta: realtime=v1
```

### 1.3 Warum ein Proxy?
Browser-WebSockets können **keine Custom Headers** setzen. Die OpenAI Realtime API akzeptiert den API-Key als Query-Parameter nicht mehr (Fehler: "Missing bearer or basic authentication in header"). Daher leitet ein Node.js-Proxy die Verbindung weiter und fügt den Authorization Header hinzu.

---

## 2. Authentifizierung

### 2.1 API-Key
- Gespeichert in `.env.local` als `VITE_OPENAI_API_KEY`
- Key ist **validiert** (GET `/v1/models` gibt Status 200)

### 2.2 Proxy-Verbindung zu OpenAI
```javascript
const openaiUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
const openaiWs = new WebSocket(openaiUrl, {
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "OpenAI-Beta": "realtime=v1",
  },
});
```

---

## 3. Session-Initialisierung

### 3.1 Gesendetes Session-Update (nach WS Connect)
```json
{
  "type": "transcription_session.update",
  "input_audio_format": "pcm16",
  "input_audio_transcription": {
    "model": "gpt-4o-transcribe",
    "prompt": "",
    "language": ""
  },
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.5,
    "silence_duration_ms": 500
  }
}
```

### 3.2 Server-Antwort (transcription_session.created)
```json
{
  "type": "transcription_session.created",
  "event_id": "event_CjLzD1qIfjgtTIEqe74Vk",
  "session": {
    "object": "realtime.transcription_session",
    "id": "sess_CjLzDshru7xelWOpxKJxf",
    "expires_at": 1764928911,
    "input_audio_noise_reduction": null,
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "prefix_padding_ms": 300,
      "silence_duration_ms": 200
    },
    "input_audio_format": "pcm16",
    "input_audio_transcription": null,    // <-- PROBLEM: null!
    "client_secret": null,
    "include": null
  }
}
```

**Problem:** `input_audio_transcription` bleibt `null`, obwohl wir es im Update setzen!

---

## 4. Audio-Streaming

### 4.1 Audio-Pipeline
1. `navigator.mediaDevices.getUserMedia()` - 24 kHz, mono
2. `AudioContext` mit `sampleRate: 24000`
3. `AudioWorkletNode` ("pcm16-processor") - sammelt 4800 Samples (~200ms)
4. Float32 → Int16 → Base64 Konvertierung
5. WebSocket Send:
```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64-encoded-pcm16>"
}
```

### 4.2 Audio-Chunk Details
- Chunk-Größe: 4800 Samples = 200ms @ 24 kHz
- Base64-Länge: 12800 Zeichen pro Chunk
- Kontinuierliches Streaming (alle ~200ms)

---

## 5. Empfangene Events (was funktioniert)

| Event | Status | Beschreibung |
|-------|--------|--------------|
| `transcription_session.created` | ✅ | Session wird erstellt |
| `input_audio_buffer.speech_started` | ✅ | VAD erkennt Sprachbeginn |
| `input_audio_buffer.speech_stopped` | ✅ | VAD erkennt Sprachende |
| `input_audio_buffer.committed` | ✅ | Audio-Buffer wird committed |
| `conversation.item.created` | ✅ | Conversation Item erstellt |

---

## 6. Das Kernproblem

### 6.1 Fehlende Transkription
Im `conversation.item.created` Event:
```json
{
  "item": {
    "content": [
      {
        "type": "input_audio",
        "transcript": null    // <-- SOLLTE TEXT ENTHALTEN!
      }
    ]
  }
}
```

### 6.2 Erwartete Events (kommen NICHT)
- `transcription.output_text.delta` - Streaming-Text
- `transcription.output_text.done` - Fertiger Text
- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`

---

## 7. Was wir getestet haben

### 7.1 Session-Update Formate (ALLE GESCHEITERT)

| Versuch | Format | Ergebnis |
|---------|--------|----------|
| 1 | `transcription_session.update` mit `session: { input_audio_transcription: {...} }` (verschachtelt) | `input_audio_transcription: null` |
| 2 | `transcription_session.update` mit top-level `input_audio_transcription: {...}` | `input_audio_transcription: null` |
| 3 | `session.update` mit `session: { input_audio_transcription: {...} }` | **ERROR: "Passing a realtime session update event to a transcription session is not allowed."** |

### 7.2 Beobachtung
- Der Server akzeptiert `turn_detection` und `input_audio_format` korrekt
- Nur `input_audio_transcription` wird ignoriert/nicht übernommen
- VAD funktioniert (speech_started/stopped Events kommen)
- Aber keine Transkriptions-Events (kein transcript in den Items)

### 7.3 Andere Versuche
- `input_audio_buffer.clear` vor Session-Update
- Manueller `input_audio_buffer.commit` alle 2 Sekunden
- Verschiedene `turn_detection` Konfigurationen
- Mit/ohne `language`, `prompt` Parameter

---

## 8. Relevante Dateien

### 8.1 Projektstruktur
```
live-transcriber/
├── .env.local                          # VITE_OPENAI_API_KEY=sk-proj-...
├── proxy-server.js                     # WebSocket-Proxy (Port 8080)
├── src/
│   ├── hooks/
│   │   └── useRealtime.ts              # WebSocket-Logik, Event-Handler
│   ├── App.tsx                         # UI-Komponente
│   └── components/
│       └── DeviceSelector.tsx          # Audio-Device Auswahl
└── public/
    └── worklets/
        └── pcm16-processor.js          # AudioWorklet für PCM16
```

### 8.2 Proxy-Server (proxy-server.js)
```javascript
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY;
const PORT = 8080;

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs) => {
  const openaiUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
  const openaiWs = new WebSocket(openaiUrl, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // Bidirektionales Message-Forwarding
  openaiWs.on("message", (data) => clientWs.send(data.toString()));
  clientWs.on("message", (data) => openaiWs.send(data.toString()));
});

server.listen(PORT);
```

### 8.3 Session-Update Code (useRealtime.ts)
```javascript
ws.onopen = () => {
  const sessionUpdate = {
    type: "transcription_session.update",
    input_audio_format: "pcm16",
    input_audio_transcription: {
      model: "gpt-4o-transcribe",
      prompt: "",
      language: "",
    },
    turn_detection: {
      type: "server_vad",
      threshold: 0.5,
      silence_duration_ms: 500,
    },
  };
  ws.send(JSON.stringify(sessionUpdate));
};
```

---

## 9. Fragen an den Spezialisten

1. **Was ist das korrekte Format für `transcription_session.update`?**
   - Wir haben sowohl verschachtelt (`session: { input_audio_transcription: {...} }`) als auch top-level versucht
   - Beide Varianten führen zu `input_audio_transcription: null` in der Antwort
   - Welche Felder/Struktur erwartet der `intent=transcription` Endpoint?

2. **Warum wird `session.update` abgelehnt?**
   - Fehler: "Passing a realtime session update event to a transcription session is not allowed."
   - Das bedeutet bei `intent=transcription` ist nur `transcription_session.update` erlaubt
   - Aber dieses Update scheint `input_audio_transcription` nicht zu setzen

3. **Ist ein separater Aktivierungs-Request nötig?**
   - Muss nach `transcription_session.created` noch ein spezieller Event gesendet werden?
   - Gibt es einen `transcription.enable` oder ähnlichen Event-Typ?

4. **Ist der Endpoint korrekt?**
   - Wir verbinden zu: `wss://api.openai.com/v1/realtime?intent=transcription`
   - Sollte ein anderer Query-Parameter oder Endpoint verwendet werden?

5. **Fehlt ein spezifischer Parameter?**
   - Braucht `input_audio_transcription` ein `enabled: true` Feld?
   - Oder muss das Modell anders spezifiziert werden?

6. **Dokumentation?**
   - Wo ist die offizielle Dokumentation für den `intent=transcription` Endpoint?
   - Die Standard Realtime API Docs scheinen für `intent=conversation` zu sein

---

## 10. Referenzen

- OpenAI Realtime API Docs: https://platform.openai.com/docs/api-reference/realtime
- Verwendetes Modell: `gpt-4o-transcribe`
- API-Version: OpenAI-Beta: realtime=v1

---

## 11. Reproduktion

```bash
# 1. In das Projektverzeichnis wechseln
cd e:\ContextPilot\live-transcriber

# 2. Dependencies installieren (falls nicht vorhanden)
npm install

# 3. Proxy starten (Terminal 1)
node proxy-server.js

# 4. Vite Dev-Server starten (Terminal 2)
npm run dev

# 5. Browser öffnen: http://localhost:5174
# 6. Audio-Device wählen, Start klicken, sprechen
# 7. Browser Console (F12) beobachten
```

---

**Zusammenfassung:** Die WebSocket-Verbindung funktioniert, Audio wird gesendet und VAD erkennt Sprache. Aber die Transkription ist nicht aktiviert (`input_audio_transcription: null` in der Session), daher kommen keine Text-Events zurück.
