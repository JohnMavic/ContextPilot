# Transkriptions-Qualitätsanalyse: OpenAI Realtime API

> **Erstellt:** 2025-12-29  
> **Projekt:** CONTEXTPILOT  
> **Analysierte Modelle:** gpt-4o-mini-transcribe-2025-12-15 (OpenAI), gpt-4o-mini-transcribe (Azure), gpt-4o-transcribe (Azure)  
> **Test-Audio:** Microsoft Foundry Präsentationsvideo ([YouTube](https://youtu.be/C6rxEGJay70?si=hiv5YQxYr9Dq278v))  
> **Referenz-Transkript:** [Microsoft Tech Community Blog](https://techcommunity.microsoft.com/blog/microsoftmechanicsblog/microsoft-foundry---everything-you-need-to-build-ai-apps--agents/4475619)

---

## Inhaltsverzeichnis

1. [Executive Summary](#1-executive-summary)
2. [Problembeschreibung](#2-problembeschreibung)
3. [Testmethodik](#3-testmethodik)
4. [Ergebnisse der Transkriptions-Runs](#4-ergebnisse-der-transkriptions-runs)
5. [Technische Architektur](#5-technische-architektur)
6. [API-Recherche und Erkenntnisse](#6-api-recherche-und-erkenntnisse)
7. [Empfehlungen](#7-empfehlungen)
8. [Anhang: Fehlertypen und Beispiele](#8-anhang-fehlertypen-und-beispiele)

---

## 1. Executive Summary

### Das Problem

Bei der Transkription identischer Audio-Dateien mit dem **OpenAI gpt-4o-mini-transcribe-2025-12-15** Modell wurden extreme Qualitätsschwankungen festgestellt:

| Metrik | Wert |
|--------|------|
| **Beste Qualität** | 75% (Run 2) |
| **Schlechteste Qualität** | 42% (Run 3) |
| **Variabilität** | **33 Prozentpunkte** |
| **Durchschnitt (7 Runs)** | 60.0% |

### Ursache

Die Variabilität ist **kein Konfigurationsfehler**, sondern ein dokumentiertes Verhalten des Modells:

- Der `temperature` Parameter existiert **nicht** für die Transkriptions-API
- OpenAI bestätigt: Deterministische Transkription ist "by design" nicht möglich
- Das gpt-4o-mini-transcribe Modell hat laut Community-Berichten "notably higher variance"

### Empfohlene Massnahmen

1. **Sprache explizit setzen:** `language: "en"` statt Auto-Detect
2. **Fachbegriffe im Prompt:** Problematische Begriffe wie "Foundry", "Mistral AI", "MCP" im Prompt auflisten
3. **Optional:** Wechsel zu `gpt-4o-transcribe` (grösseres Modell, potenziell stabiler)

---

## 2. Problembeschreibung

### 2.1 Ausgangslage

CONTEXTPILOT nutzt die OpenAI Realtime Transcription API für Live-Transkription von Audio-Inhalten (Meetings, YouTube-Videos, etc.). Bei internen Tests wurde festgestellt, dass identische Audio-Dateien bei wiederholter Transkription stark unterschiedliche Ergebnisse liefern.

### 2.2 Beobachtete Symptome

1. **Inkonsistente Worterkennungen:**
   - "Foundry" → "Boundary", "fast Boundary" (Run 3/4)
   - "automatically" → "auto- Dramatically", "out- Dramatically" (Run 3/4)
   - "Mistral AI" → "Mr. LeI", "Mr. Leite", "Mistralay" (verschiedene Runs)

2. **Variierende Fehleranzahl:**
   - Run 2: 24 Fehler
   - Run 3: 51 Fehler (mehr als doppelt so viele)

3. **Drei "Modi" der Performance:**
   - **Gut (72-75%):** Runs 1, 2
   - **Mittel (60-65%):** Runs 5, 6, 7
   - **Schlecht (42-44%):** Runs 3, 4

### 2.3 Auswirkungen

- Unzuverlässige Transkripte für Endbenutzer
- Keine Reproduzierbarkeit für Qualitätssicherung
- Kritische Begriffe (Produktnamen, URLs) werden falsch transkribiert

---

## 3. Testmethodik

### 3.1 Test-Setup

| Aspekt | Details |
|--------|---------|
| **Audio-Quelle** | YouTube Video: Microsoft Foundry Präsentation |
| **Dauer** | ~2:30 Minuten |
| **Sprache** | Englisch |
| **Sprecher** | Professionelle Aufnahme, klare Aussprache |
| **Referenz** | Offizielles Transkript von Microsoft Tech Community |

### 3.2 Bewertungskriterien

Fehlertypen mit Gewichtung:

| Fehlertyp | Beschreibung | Beispiel |
|-----------|--------------|----------|
| **wrong** | Falsches Wort | "Boundary" statt "Foundry" |
| **missing** | Fehlender Text | URL "ai.azure.com" nicht erkannt |
| **extra** | Zusätzlicher Text | Duplikationen "high high-quality" |
| **extra (dup)** | Wort-Verdopplung | "way. way to production" |
| **grammar** | Grammatikfehler | Falsche Satzstruktur |
| **grammar (struct)** | Satzbruch | "agent. Factory, with" |
| **case** | Gross-/Kleinschreibung | "foundry" statt "Foundry" |

### 3.3 Qualitätsberechnung

```
Qualität = 100% - (Fehleranzahl × Gewichtungsfaktor)
```

Gewichtung basierend auf Schwere:
- wrong: 1.5
- missing: 1.5
- extra: 1.0
- grammar: 1.0
- case: 0.5

---

## 4. Ergebnisse der Transkriptions-Runs

### 4.1 Übersichtstabelle — OpenAI gpt-4o-mini-transcribe-2025-12-15

| Run | Score | Errors | wrong | missing | extra | grammar | case | Kategorie |
|-----|-------|--------|-------|---------|-------|---------|------|-----------|
| **Run 1** | 72% | 28 | 8 | 4 | 10 | 3 | 3 | ✅ Satisfactory |
| **Run 2** | 75% | 24 | 9 | 3 | 8 | 3 | 1 | ✅ Satisfactory |
| **Run 3** | 42% | 51 | 16 | 6 | 9 | 18 | 2 | ❌ Poor |
| **Run 4** | 44% | 49 | 17 | 5 | 9 | 16 | 2 | ❌ Poor |
| **Run 5** | 62% | 38 | 14 | 4 | 8 | 10 | 2 | ⚠️ Fair |
| **Run 6** | 60% | 36 | 13 | 3 | 11 | 7 | 2 | ⚠️ Fair |
| **Run 7** | 65% | 32 | 14 | 2 | 6 | 9 | 1 | ⚠️ Fair |

### 4.2 Statistische Auswertung

| Metrik | Wert |
|--------|------|
| **Durchschnitt** | 60.0% |
| **Median** | 62% |
| **Minimum** | 42% (Run 3) |
| **Maximum** | 75% (Run 2) |
| **Standardabweichung** | ~12.5% |
| **Variabilität (Max-Min)** | 33 Prozentpunkte |

### 4.3 Verteilung der Ergebnisse

```
Poor (40-50%):       ████████████████ 2 Runs (29%)
Fair (55-70%):       ████████████████████████ 3 Runs (43%)
Satisfactory (70%+): ████████████████ 2 Runs (29%)
```

### 4.4 Konsistente Fehler über alle Runs

Diese Fehler traten in fast allen Runs auf:

| Begriff | Häufig falsch als | Häufigkeit |
|---------|-------------------|------------|
| "feature tools" | "future tools", "Check your tools" | 6/7 (86%) |
| "outerwear" | "AutoWare", "outerware", "Applications" | 5/7 (71%) |
| "Mistral AI" | "Mr. LeI", "Mr. Leite", "Mistralay", "Mera" | 5/7 (71%) |
| Duplikationen | "way. way", "high high-quality" | 7/7 (100%) |

### 4.5 Run 1 vs Run 2 — Azure OpenAI Vergleich

Zusätzlich wurden Azure OpenAI Modelle getestet:

| Modell | Run 1 | Run 2 |
|--------|-------|-------|
| **Azure gpt-4o-mini-transcribe** | 52% (48 Errors) | 50% (42 Errors) |
| **Azure gpt-4o-transcribe** | 58% (42 Errors) | 48% (38 Errors) |

**Erkenntnis:** Azure-Versionen zeigen ähnliche Variabilität, jedoch generell schlechtere Ergebnisse als OpenAI Direct.

---

## 5. Technische Architektur

### 5.1 Datenfluss

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│    Frontend     │────▶│  Proxy Server   │────▶│  OpenAI/Azure   │
│  (Browser)      │     │  (Node.js)      │     │  WebSocket API  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     │                        │                        │
     │ Audio Capture          │ Model Override         │ Transcription
     │ (24kHz PCM16)          │ (nur OpenAI)           │ Processing
     │                        │                        │
     ▼                        ▼                        ▼
useDualRealtime.ts      proxy-server.js         OpenAI Realtime API
```

### 5.2 OpenAI Direct Konfiguration

| Aspekt | Wert | Quelle |
|--------|------|--------|
| **Endpoint** | `wss://api.openai.com/v1/realtime?intent=transcription` | proxy-server.js:1023 |
| **Auth Header** | `Authorization: Bearer {key}` | proxy-server.js:1025 |
| **Beta Header** | `OpenAI-Beta: realtime=v1` | proxy-server.js:1025 |
| **Model (Default)** | `gpt-4o-mini-transcribe-2025-12-15` | proxy-server.js:56 |
| **Model Fallbacks** | `gpt-4o-mini-transcribe`, `gpt-4o-transcribe` | proxy-server.js:57 |

### 5.3 Azure OpenAI Konfiguration

| Aspekt | Wert | Quelle |
|--------|------|--------|
| **Endpoint** | `wss://{ENDPOINT}/openai/realtime?api-version=...&deployment=...&intent=transcription` | proxy-server.js:1013 |
| **Auth Header** | `api-key: {key}` | proxy-server.js |
| **API Version (Code)** | `2024-12-01-preview` | proxy-server.js:75 |
| **API Version (Deployment)** | `2025-04-01-preview` | Azure App Settings |
| **Deployment** | `gpt-4o-transcribe` | Azure App Settings |

### 5.4 Session Update Message (aktuell)

```typescript
// useDualRealtime.ts Zeile 270-296
const sessionUpdate = {
  type: "transcription_session.update",
  session: {
    input_audio_transcription: {
      model: modelName,
      prompt: transcriptionPrompt,
      // language: NICHT GESETZT (Auto-Detect)
      // temperature: EXISTIERT NICHT für Transcription API
    },
    turn_detection: {
      type: "server_vad",
      threshold: 0.28,        // 0.29 für Speaker
      prefix_padding_ms: 450, // 900 für Speaker
      silence_duration_ms: 1000, // 1550 für Speaker
    },
  },
};
```

### 5.5 Aktueller Transkriptions-Prompt

```
Auto-detect language. Produce verbatim transcripts (no summaries), keep names and numbers exactly as spoken. Merge adjacent fragments into complete, coherent sentences when they clearly belong together; lightly fix punctuation and obvious word breaks; do not add, omit, or change facts.
```

### 5.6 Audio-Processing

| Aspekt | Wert |
|--------|------|
| **Sample Rate** | 24.000 Hz |
| **Format** | PCM16 (Float32 → Int16 → Base64) |
| **Channels** | Mono |
| **Noise Reduction** | Keine |
| **Normalisierung** | Keine (nur Gain) |
| **Input Gain** | Mic: 2x, Speaker/Tab: 1x |

---

## 6. API-Recherche und Erkenntnisse

### 6.1 Kernfrage: Kann `temperature: 0` die Variabilität beheben?

**Antwort: NEIN**

Der `temperature` Parameter existiert **nicht** für die Transkriptions-Konfiguration der Realtime API.

#### Verfügbare Parameter für `input_audio_transcription`:

| Parameter | Verfügbar | Beschreibung |
|-----------|-----------|--------------|
| `model` | ✅ | Modell-Name |
| `language` | ✅ | ISO-639-1 Sprachcode |
| `prompt` | ✅ | Kontext-Hinweise |
| `temperature` | ❌ | **Existiert nicht** |

#### Quellen:

- [OpenAI Realtime API Dokumentation](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Python SDK - TranscriptionSession](https://github.com/openai/openai-python/blob/main/src/openai/types/beta/realtime/transcription_session.py)
- [OpenAI Developer Notes](https://developers.openai.com/blog/realtime-api/)

### 6.2 Warum ist deterministische Transkription nicht möglich?

OpenAI erklärt offiziell:

> "There isn't a way to make these audio responses deterministic with low temperatures" due to the model architecture.

> "The transcript may diverge somewhat from the model's interpretation, and should be treated as a rough guide" because transcription runs on a **separate ASR model** from the main realtime model.

**Quelle:** [OpenAI Developer Notes on Realtime API](https://developers.openai.com/blog/realtime-api/)

### 6.3 API-Status (Stand Dezember 2025)

| Aspekt | Status |
|--------|--------|
| **OpenAI Realtime API** | General Availability (seit September 2025) |
| **Beta Header erforderlich** | Nein (für GA), aber noch unterstützt |
| **Beta Deprecation** | 27. Februar 2026 |
| **Empfohlenes Modell** | `gpt-realtime` (nicht mehr `gpt-4o-realtime-preview`) |

**Quelle:** [OpenAI Deprecations](https://platform.openai.com/docs/deprecations)

### 6.4 Azure-spezifische Einschränkungen

| Einschränkung | Beschreibung |
|---------------|--------------|
| **Keine Partial Transcription** | Azure sendet keine `delta` Events für Streaming |
| **Nur Final Results** | Transkript erst nach Segment-Ende verfügbar |
| **Dokumentierte Entscheidung** | Kein Bug, sondern "intentional infrastructure decision" |

**Quelle:** [Azure OpenAI Realtime Audio Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)

### 6.5 Community-Berichte zu gpt-4o-mini-transcribe Variabilität

> "gpt-4o-mini-transcribe outperforms both Whisper and Universal in overall accuracy, though with **notably higher variance**. One moment it's transcribing with surgical precision, the next it's inventing words."

**Dokumentierte Probleme:**

| Problem | Beispiel |
|---------|----------|
| **Word Dropping** | "Uh, will this work?" → "Will this work?" |
| **Language Switching** | Wechselt Sprache trotz `language` Parameter |
| **WER Varianz** | 1% bis 50% Word Error Rate |
| **Latenz** | 2016ms (vs. Whisper 857ms) |

**Quelle:** [OpenAI Community Forum - gpt-4o-transcribe vs Whisper](https://community.openai.com/t/gpt-4o-mini-transcribe-and-gpt-4o-transcribe-not-as-good-as-whisper/1153905)

### 6.6 Alternative Ansätze

#### Out-of-Band Transcription

OpenAI's Cookbook dokumentiert einen alternativen Ansatz, bei dem das Realtime-Modell selbst für Transkription verwendet wird (statt dem separaten ASR-Modell):

- Bessere Instruction Following
- Session-Kontext wird berücksichtigt
- Vermeidet 1024-Token Input-Limit

**Quelle:** [OpenAI Cookbook - Realtime Out-of-Band Transcription](https://github.com/openai/openai-cookbook/blob/main/examples/Realtime_out_of_band_transcription.ipynb)

---

## 7. Empfehlungen

### 7.1 Sofort umsetzbar (EMPFOHLEN)

#### A) Sprache explizit setzen

**Datei:** `useDualRealtime.ts` Zeile ~278

```typescript
// VORHER:
input_audio_transcription: {
  model: modelName,
  prompt: transcriptionPrompt,
},

// NACHHER:
input_audio_transcription: {
  model: modelName,
  prompt: transcriptionPrompt,
  language: "en",  // ← HINZUFÜGEN
},
```

**Begründung:** Auto-Detect ist eine dokumentierte Quelle für Variabilität. Feste Sprache reduziert Unsicherheit.

**Einschränkung:** Für mehrsprachige Inhalte muss die Sprache dynamisch gesetzt werden (z.B. über UI-Auswahl).

#### B) Fachbegriffe im Prompt ergänzen

**Datei:** `useDualRealtime.ts` Zeile ~260

```typescript
const transcriptionPrompt = `Auto-detect language. Produce verbatim transcripts (no summaries), keep names and numbers exactly as spoken. Merge adjacent fragments into complete, coherent sentences when they clearly belong together; lightly fix punctuation and obvious word breaks; do not add, omit, or change facts.

Technical vocabulary: Microsoft Foundry, ai.azure.com, Grok, Meta, DeepSeek, Mistral AI, Anthropic, MCP servers, GPT-5 Chat, outerwear, Foundry Local, workflow automation, multi-agentic, knowledge base.`;
```

**Begründung:** Der Prompt dient als "Vocabulary Hint" für das Modell. Häufig falsch erkannte Begriffe werden durch explizite Nennung besser erkannt.

### 7.2 Optional (bei anhaltenden Problemen)

#### C) Grösseres Modell verwenden

Wechsel von `gpt-4o-mini-transcribe` zu `gpt-4o-transcribe`:

**Datei:** `proxy-server.js` Zeile 56

```javascript
// VORHER:
const OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe-2025-12-15";

// NACHHER:
const OPENAI_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
```

**Trade-offs:**

| Aspekt | gpt-4o-mini-transcribe | gpt-4o-transcribe |
|--------|------------------------|-------------------|
| **Kosten** | Günstiger | ~2-3x teurer |
| **Latenz** | ~2000ms | ~2500ms |
| **Variabilität** | Höher | Potenziell niedriger |
| **Genauigkeit** | Gut (wenn stabil) | Konsistenter |

#### D) Für beide Provider (OpenAI + Azure) anwenden

Die Änderungen sollten für beide Provider gelten. Da Azure aktuell keine Override-Funktion hat:

**Option 1:** Änderung nur im Frontend (`useDualRealtime.ts`) — gilt automatisch für beide

**Option 2:** Proxy erweitern, um auch Azure-Messages zu modifizieren

### 7.3 Nicht empfohlen

| Ansatz | Warum nicht |
|--------|-------------|
| `temperature: 0` setzen | Parameter existiert nicht für Transcription |
| VAD-Settings vereinheitlichen | Könnte Mic/Speaker-Qualität verschlechtern |
| Auf Whisper wechseln | Nicht kompatibel mit Realtime/Streaming Use-Case |

---

## 8. Anhang: Fehlertypen und Beispiele

### 8.1 Kritische Fehler (Run 3/4)

Diese Fehler machten den Text teilweise unverständlich:

| Original | Transkribiert | Fehlertyp |
|----------|---------------|-----------|
| "newly expounded Foundry" | "fast Boundary" | wrong |
| "automatically routes" | "out- Dramatically routes" | wrong |
| "automatically routes" | "auto- Dramatically routes" | wrong |
| "ai.azure.com" | "AI." / "ai.microsoft.com" | wrong/missing |
| "unified AI app" | "Fight AI app" | wrong |
| "Mistral AI" | "Mr. LeI" / "Mr. Leite" | wrong |

### 8.2 Häufige Fehler (alle Runs)

| Original | Häufig transkribiert als |
|----------|--------------------------|
| "feature tools" | "future tools" |
| "outerwear" | "AutoWare", "outerware" |
| "Meta, DeepSeek" | "Mera, DeepSig", "Mera, Tipsy" |
| "GPT-5 Chat" | "GPT-5 ChatGPT", "ChatGPT-5 Chat" |
| "Foundry Local" | "Foundry Learn" |
| "MCP servers" | "MTP servers", "MCP search" |

### 8.3 Duplikations-Pattern

Fast alle Runs enthielten Wort-Duplikationen:

```
"all the way. way to production"
"high high-quality results"
"tools. Tools that you can"
"experience. experience helps"
"solutions. Solution templates"
```

### 8.4 Fehlerverteilung nach Kategorie (Durchschnitt aller Runs)

```
wrong:    ████████████████████████████████ 39% (häufigstes Problem)
grammar:  ████████████████████████ 28%
extra:    ████████████████████ 23%
missing:  ████████ 9%
case:     ██ 3%
```

---

## Quellenverzeichnis

### OpenAI Dokumentation

1. [OpenAI Realtime API Guide](https://platform.openai.com/docs/guides/realtime)
2. [OpenAI API Reference - Realtime Beta Sessions](https://platform.openai.com/docs/api-reference/realtime-beta-sessions)
3. [OpenAI Developer Notes on Realtime API](https://developers.openai.com/blog/realtime-api/)
4. [OpenAI Deprecations](https://platform.openai.com/docs/deprecations)
5. [OpenAI Python SDK - Transcription Session Types](https://github.com/openai/openai-python/blob/main/src/openai/types/beta/realtime/transcription_session.py)
6. [OpenAI Cookbook - Realtime Out-of-Band Transcription](https://github.com/openai/openai-cookbook/blob/main/examples/Realtime_out_of_band_transcription.ipynb)

### Azure Dokumentation

7. [Azure OpenAI Realtime Audio Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)
8. [Azure OpenAI Realtime Audio WebSockets](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-websockets)

### Community

9. [OpenAI Forum - gpt-4o-transcribe not as good as Whisper](https://community.openai.com/t/gpt-4o-mini-transcribe-and-gpt-4o-transcribe-not-as-good-as-whisper/1153905)

---

## Änderungshistorie

| Datum | Version | Änderung |
|-------|---------|----------|
| 2025-12-29 | 1.0 | Initiale Erstellung nach 7 Test-Runs |

---

*Dieses Dokument wurde erstellt zur Analyse der Transkriptions-Variabilität in CONTEXTPILOT.*
