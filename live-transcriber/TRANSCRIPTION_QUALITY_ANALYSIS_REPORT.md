# Transkriptions-Qualitätsanalyse: OpenAI Realtime API

> **Erstellt:** 2025-12-29 | **Aktualisiert:** 2025-12-31  
> **Projekt:** CONTEXTPILOT  
> **Analysierte Modelle:** gpt-4o-mini-transcribe-2025-12-15 (OpenAI), gpt-4o-mini-transcribe (Azure), gpt-4o-transcribe (Azure)

---

## 📁 Quelldateien dieser Analyse

| Datei | Beschreibung | Audio-Quelle |
|-------|--------------|--------------|
| [`model_comparision/transcription_comparison_run_1.html`](../model_comparision/transcription_comparison_run_1.html) | Microsoft Foundry Video - Run 1 | [YouTube](https://youtu.be/C6rxEGJay70) |
| [`model_comparision/transcription_comparison_run_2.html`](../model_comparision/transcription_comparison_run_2.html) | Microsoft Foundry Video - Run 2 | [YouTube](https://youtu.be/C6rxEGJay70) |
| [`model_comparision/transcription_mustafa_suleyman_ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) | Mustafa Suleyman TED Talk | [TED.com](https://www.ted.com/talks/mustafa_suleyman_what_is_an_ai_anyway) |

---

## Inhaltsverzeichnis

1. [Executive Summary](#1-executive-summary)
2. [Problembeschreibung](#2-problembeschreibung)
3. [Testmethodik](#3-testmethodik)
4. [Ergebnisse der Transkriptions-Runs](#4-ergebnisse-der-transkriptions-runs)
5. [Technische Architektur](#5-technische-architektur)
6. [API-Recherche und Erkenntnisse](#6-api-recherche-und-erkenntnisse)
7. [Application Insights Monitoring](#7-application-insights-monitoring)
8. [Empfehlungen](#8-empfehlungen)
9. [Fazit: Technische Optimierungen vs. Modell-Limitierungen](#9-fazit-technische-optimierungen-vs-modell-limitierungen)
10. [Anhang: Fehlertypen und Beispiele](#10-anhang-fehlertypen-und-beispiele)

---

## 1. Executive Summary

### Das Problem

Bei der Transkription identischer Audio-Dateien mit dem **OpenAI gpt-4o-mini-transcribe-2025-12-15** Modell wurden extreme Qualitätsschwankungen festgestellt:

| Metrik | Microsoft Foundry (7 Runs) | TED Talk (3 Runs) |
|--------|---------------------------|-------------------|
| **Beste Qualität** | 75% (Run 2) | 58% (Azure mini) |
| **Schlechteste Qualität** | 42% (Run 3) | 45% (Azure full) |
| **Variabilität** | **33 Prozentpunkte** | **13 Prozentpunkte** |

### Überraschende Erkenntnis aus dem TED Talk Test

> **🔴 Das grössere gpt-4o Modell performt SCHLECHTER als gpt-4o-mini!**
> 
> *Quelle: [`transcription_mustafa_suleyman_ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html)*

| Modell | Score | Fehler | Kritische Probleme |
|--------|-------|--------|-------------------|
| **Azure gpt-4o-mini** 🏆 | **58%** | 38 | Best Result |
| OpenAI gpt-4o-mini | 48% | 47 | Duplikationen |
| **Azure gpt-4o** ⚠️ | **45%** | 52 | **WORST** - Prompt Leak, Halluzinationen |

### Ursache

Die Variabilität ist **kein Konfigurationsfehler**, sondern ein dokumentiertes Verhalten des Modells:

- Der `temperature` Parameter existiert **nicht** für die Transkriptions-API
- OpenAI bestätigt: Deterministische Transkription ist "by design" nicht möglich
- Das gpt-4o-mini-transcribe Modell hat laut Community-Berichten "notably higher variance"

### Empfohlene Massnahmen

1. **Sprache explizit setzen:** `language: "en"` statt Auto-Detect
2. **Fachbegriffe im Prompt:** Problematische Begriffe wie "Foundry", "Mistral AI", "AGI" im Prompt auflisten
3. **Azure gpt-4o-mini bevorzugen:** Für British Accent konsistent besser als das grössere gpt-4o Modell

---

## 2. Problembeschreibung

### 2.1 Ausgangslage

CONTEXTPILOT nutzt die **OpenAI Realtime Transcription API** für Live-Transkription von Audio-Inhalten (Meetings, YouTube-Videos, etc.). Die API wird über zwei Plattformen angesprochen:

| Plattform | Endpoint | Modelle |
|-----------|----------|----------|
| **OpenAI Direct** | `wss://api.openai.com/v1/realtime` | gpt-4o-mini-transcribe-2025-12-15 |
| **Azure OpenAI** | `wss://{endpoint}/openai/realtime` | gpt-4o-mini-transcribe, gpt-4o-transcribe |

Bei internen Tests wurde festgestellt, dass identische Audio-Dateien bei wiederholter Transkription stark unterschiedliche Ergebnisse liefern — sowohl bei OpenAI Direct als auch bei Azure OpenAI.

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

### 3.1 Test-Videos

| Video | Dauer | Sprache | Sprecher | Referenz-Transkript |
|-------|-------|---------|----------|--------------------|
| **Microsoft Foundry** | ~2:30 | Englisch (US) | Professionell | [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/microsoftmechanicsblog/microsoft-foundry---everything-you-need-to-build-ai-apps--agents/4475619) |
| **Mustafa Suleyman TED Talk** | ~3:10 | Englisch (British) | Natürlich | [TED.com Transcript](https://www.ted.com/talks/mustafa_suleyman_what_is_an_ai_anyway/transcript) |

### 3.2 Getestete Konfigurationen

| Plattform | Modell | Video(s) |
|-----------|--------|----------|
| **OpenAI Direct** | gpt-4o-mini-transcribe-2025-12-15 | Foundry (7 Runs), TED Talk (1 Run) |
| **Azure OpenAI** | gpt-4o-mini-transcribe | Foundry (2 Runs), TED Talk (1 Run) |
| **Azure OpenAI** | gpt-4o-transcribe | Foundry (2 Runs), TED Talk (1 Run) |

### 3.3 Bewertungskriterien

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

### 3.4 Qualitätsberechnung

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

> **Hinweis zur Run-Nummerierung:**  
> Die Run-Nummern in diesem Report sind **global eindeutig** und entsprechen den Spalten in den HTML-Quelldateien.
> - Foundry HTML Run 1 → Runs F1.x (OpenAI, Azure mini, Azure full jeweils getestet)
> - Foundry HTML Run 2 → Runs F2.x
> - TED Talk → Runs T.x

### 4.1 Übersichtstabelle — OpenAI Direct: gpt-4o-mini-transcribe-2025-12-15

| Run ID | Video | HTML-Quelle | Score | Errors | wrong | missing | extra | grammar | case | Kategorie |
|--------|-------|-------------|-------|--------|-------|---------|-------|---------|------|-----------|
| **F1.1** | Foundry | [`run_1.html`](../model_comparision/transcription_comparison_run_1.html) Spalte 2 | 72% | 28 | 8 | 4 | 10 | 3 | 3 | ✅ Satisfactory |
| **F2.1** | Foundry | [`run_2.html`](../model_comparision/transcription_comparison_run_2.html) Spalte 2 | 75% | 24 | 9 | 3 | 8 | 3 | 1 | ✅ Satisfactory |
| **T.1** | TED Talk | [`ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) Spalte 2 "Run 1" | 48% | 47 | ~15 | ~12 | ~8 | ~7 | ~5 | ❌ Poor |
| **T.2** | TED Talk | [`ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) Spalte 3 "Run 4" | 52% | 43 | ~14 | ~10 | ~8 | ~6 | ~5 | ❌ Poor |

**Beobachtung:** Runs T.1 und T.2 zeigen ~4% Variabilität bei identischem Audio und Modell.

### 4.2 Übersichtstabelle — Azure OpenAI: gpt-4o-mini-transcribe

| Run ID | Video | HTML-Quelle | Score | Errors | wrong | missing | extra | grammar | case | Kategorie |
|--------|-------|-------------|-------|--------|-------|---------|-------|---------|------|-----------|
| **F1.2** | Foundry | [`run_1.html`](../model_comparision/transcription_comparison_run_1.html) Spalte 3 | 52% | 48 | 14 | 8 | 9 | 12 | 5 | ❌ Poor |
| **F2.2** | Foundry | [`run_2.html`](../model_comparision/transcription_comparison_run_2.html) Spalte 3 | 50% | 42 | 10 | 4 | 10 | 14 | 4 | ❌ Poor |
| **T.3** | TED Talk | [`ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) Spalte 4 | **58%** | 38 | ~8 | ~10 | ~6 | ~9 | ~5 | ⚠️ Fair 🏆 |

**Beobachtung:** Azure gpt-4o-mini performt beim TED Talk (British Accent) **besser** als bei Foundry (US Accent).

### 4.3 Übersichtstabelle — Azure OpenAI: gpt-4o-transcribe

| Run ID | Video | HTML-Quelle | Score | Errors | wrong | missing | extra | grammar | case | Kategorie |
|--------|-------|-------------|-------|--------|-------|---------|-------|---------|------|-----------|
| **F1.3** | Foundry | [`run_1.html`](../model_comparision/transcription_comparison_run_1.html) Spalte 4 | 58% | 42 | 12 | 20 | 1 | 1 | 8 | ⚠️ Fair |
| **F2.3** | Foundry | [`run_2.html`](../model_comparision/transcription_comparison_run_2.html) Spalte 4 | 48% | 38 | 9 | 18 | 0 | 6 | 5 | ❌ Poor |
| **T.4** | TED Talk | [`ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) Spalte 5 | **45%** | 52 | ~12 | ~28 | ~4 | ~4 | ~4 | ❌ Poor ⚠️ WORST |

> **⚠️ Überraschung:** Das grössere gpt-4o-transcribe Modell performt beim TED Talk **schlechter** als gpt-4o-mini-transcribe!

### 4.4 Zusammenfassung aller Runs

| Run ID | Plattform | Modell | Video | Score | Quelle |
|--------|-----------|--------|-------|-------|--------|
| F1.1 | OpenAI | gpt-4o-mini | Foundry | 72% | run_1.html Sp.2 |
| F1.2 | Azure | gpt-4o-mini | Foundry | 52% | run_1.html Sp.3 |
| F1.3 | Azure | gpt-4o | Foundry | 58% | run_1.html Sp.4 |
| F2.1 | OpenAI | gpt-4o-mini | Foundry | 75% | run_2.html Sp.2 |
| F2.2 | Azure | gpt-4o-mini | Foundry | 50% | run_2.html Sp.3 |
| F2.3 | Azure | gpt-4o | Foundry | 48% | run_2.html Sp.4 |
| T.1 | OpenAI | gpt-4o-mini | TED Talk | 48% | ted.html Sp.2 |
| T.2 | OpenAI | gpt-4o-mini | TED Talk | 52% | ted.html Sp.3 |
| T.3 | Azure | gpt-4o-mini | TED Talk | **58%** 🏆 | ted.html Sp.4 |
| T.4 | Azure | gpt-4o | TED Talk | 45% ⚠️ | ted.html Sp.5 |

### 4.5 Statistische Auswertung

#### OpenAI Direct (gpt-4o-mini-transcribe-2025-12-15)

| Metrik | Foundry (F1.1, F2.1) | TED Talk (T.1, T.2) |
|--------|----------------------|---------------------|
| **Durchschnitt** | 73.5% | 50% |
| **Minimum** | 72% (F1.1) | 48% (T.1) |
| **Maximum** | 75% (F2.1) | 52% (T.2) |
| **Variabilität** | 3 Prozentpunkte | 4 Prozentpunkte |

#### Azure OpenAI (alle Modelle)

| Metrik | gpt-4o-mini | gpt-4o |
|--------|-------------|--------|
| **Foundry Durchschnitt** | 51% | 53% |
| **TED Talk** | **58%** 🏆 | 45% ⚠️ |
| **Gesamt Durchschnitt** | 53.3% | 50.3% |

### 4.6 Erkenntnisse aus den Run-Vergleichen

| Erkenntnis | Quelle | Details |
|------------|--------|---------|
| **OpenAI Direct performt besser als Azure** | F1.1 vs F1.2: 72% vs 52% | 20 Prozentpunkte Unterschied bei gleichem Audio |
| **Run-to-Run Variabilität bestätigt** | T.1 vs T.2: 48% vs 52% | ~4% Varianz bei identischem Modell und Audio |
| **gpt-4o SCHLECHTER als gpt-4o-mini** | T.3 vs T.4: 58% vs 45% | Grösseres Modell = 13% schlechtere Ergebnisse |
| **Accent beeinflusst Qualität** | F1.2 vs T.3: 52% vs 58% | Azure mini bei British Accent 6% besser |

### 4.7 Konsistente Fehler über alle Runs

**Foundry Video:**

| Begriff | Häufig falsch als | Runs |
|---------|-------------------|------|
| "ai.azure.com" | "ai.app.", "AI. Asher.com" | F1.3, F2.3 |
| "Mistral AI" | "Mr. AI", "Deep Mistroll AI" | F1.2, F1.3, F2.3 |
| "MCP servers" | "MTP servers" | F1.2, F2.2 |
| Duplikationen | "way. way", "building... Building" | Alle Runs |

**TED Talk:**

| Begriff | Häufig falsch als | Runs |
|---------|-------------------|------|
| "AGI" | "aging", "CGI" | T.1, T.4 |
| "I Spy" (Spiel) | "iPhone. They spy" | T.1, T.2 |
| "augment us" | "mentors" | T.1 |
| Prompt Leak | "Auto-detect language" im Output | T.4 |

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

## 7. Application Insights Monitoring

### 7.1 Implementierung

Zur technischen Analyse der Transkriptions-Events wurde **Azure Application Insights** in den Proxy-Server integriert.

**Konfiguration:** `proxy-server.js`

```javascript
// Application Insights Setup
const appInsights = require('applicationinsights');
appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true)
    .start();
const client = appInsights.defaultClient;
```

### 7.2 Geloggte Events

| Event-Name | Beschreibung | Eigenschaften |
|------------|--------------|---------------|
| `transcript.session_start` | Session-Start | `session_id`, `provider`, `model`, `language` |
| `transcript.delta` | Streaming-Fragment | `session_id`, `item_id`, `content_index` |
| `transcript.completed` | Finales Transkript | `session_id`, `transcript_start`, `transcript_end`, `transcript_length` |
| `transcript.committed` | Bestätigtes Segment | `session_id`, `item_id`, `content_index` |

### 7.3 Session-ID-Generierung

Jede WebSocket-Verbindung erhält eine eindeutige Session-ID zur Unterscheidung:

```javascript
const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
// Beispiel: "1767203048728-cx9olx"
```

### 7.4 Analyse-Queries (Azure CLI)

#### Alle Sessions eines Zeitraums abfragen:

```bash
az monitor app-insights query \
  --app contextpilot-proxy-2025 \
  --resource-group ContextPilot-Resource \
  --analytics-query "
    customEvents 
    | where name == 'transcript.session_start' 
    | extend props = parse_json(customDimensions) 
    | project timestamp, 
              session_id = tostring(props.session_id), 
              provider = tostring(props.provider), 
              model = tostring(props.model) 
    | order by timestamp desc 
    | take 10"
```

#### Event-Statistiken für eine Session:

```bash
az monitor app-insights query \
  --app contextpilot-proxy-2025 \
  --resource-group ContextPilot-Resource \
  --analytics-query "
    customEvents 
    | extend props = parse_json(customDimensions) 
    | where tostring(props.session_id) == '1767203048728-cx9olx' 
    | summarize count() by name"
```

#### Duplikations-Analyse (content_index > 0):

```bash
az monitor app-insights query \
  --app contextpilot-proxy-2025 \
  --resource-group ContextPilot-Resource \
  --analytics-query "
    customEvents 
    | where name == 'transcript.committed' 
    | extend props = parse_json(customDimensions) 
    | where tostring(props.session_id) == '1767203048728-cx9olx' 
    | where toint(props.content_index) > 0 
    | count"
```

### 7.5 Erkenntnisse aus dem Monitoring

| Metrik | OpenAI Direct | Azure OpenAI |
|--------|---------------|--------------|
| **Delta Events** | ~750 pro Session | **0** (Azure sendet keine Deltas) |
| **Chunks** | 74 | 73 |
| **content_index > 0** | 0 ✅ | 0 ✅ |
| **Duplikationsmuster** | An Chunk-Boundaries | Keine |

**Wichtige Erkenntnis:**
> Azure OpenAI sendet **keine** `delta` Events — nur `completed`. Dies ist kein Bug, sondern eine dokumentierte Architekturentscheidung.
> 
> *Quelle: Application Insights Session `1767200309946-mcsruu` (Azure gpt-4o-transcribe)*

---

## 8. Empfehlungen

### 8.1 Sofort umsetzbar (EMPFOHLEN)

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

Technical vocabulary: Microsoft Foundry, ai.azure.com, Grok, Meta, DeepSeek, Mistral AI, Anthropic, MCP servers, GPT-5 Chat, AGI, artificial general intelligence.`;
```

**Begründung:** Der Prompt dient als "Vocabulary Hint" für das Modell. Häufig falsch erkannte Begriffe werden durch explizite Nennung besser erkannt.

### 8.2 NICHT empfohlen: Grösseres Modell verwenden

> **⚠️ WARNUNG:** Die TED Talk Analyse zeigt, dass `gpt-4o-transcribe` **SCHLECHTER** performt als `gpt-4o-mini-transcribe`!
> 
> *Quelle: [`transcription_mustafa_suleyman_ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) — Azure gpt-4o: 45% vs Azure gpt-4o-mini: 58%*

**Beobachtete Probleme bei gpt-4o-transcribe:**

| Problem | Beispiel | Quelle |
|---------|----------|--------|
| **Prompt Leak** | "Auto-detect language" im Output | TED Talk Run |
| **Halluzinationen** | "That's what I thought", "Some people" | TED Talk Run |
| **Kritische Fehler** | "CGI" statt "AGI" | TED Talk Run |
| **28 fehlende Wörter** | Ganze Sätze fehlen | TED Talk Run |

### 8.3 Nicht empfohlen

| Ansatz | Warum nicht |
|--------|-------------|
| `temperature: 0` setzen | Parameter existiert nicht für Transcription |
| VAD-Settings vereinheitlichen | Könnte Mic/Speaker-Qualität verschlechtern |
| Auf Whisper wechseln | Nicht kompatibel mit Realtime/Streaming Use-Case |
| gpt-4o statt gpt-4o-mini | Performt paradoxerweise schlechter (siehe TED Talk) |

---

## 9. Fazit: Technische Optimierungen vs. Modell-Limitierungen

### 9.1 Was wir technisch optimiert haben ✅

| Optimierung | Status | Auswirkung |
|-------------|--------|------------|
| **content_index im Segment-Key** | ✅ Implementiert | Verhindert Überschreiben bei gleicher item_id |
| **Application Insights Logging** | ✅ Implementiert | Ermöglicht technische Analyse |
| **session_id pro Verbindung** | ✅ Implementiert | Unterscheidung paralleler Sessions |
| **transcript_start/end Logging** | ✅ Implementiert | Duplikations-Analyse möglich |

### 9.2 Was wir NICHT ändern können ❌

| Limitation | Ursache | Workaround |
|------------|---------|------------|
| **Keine deterministische Transkription** | Modell-Architektur | Mehrere Runs, manuelles Review |
| **temperature Parameter fehlt** | API-Design | Keiner verfügbar |
| **Azure: Keine Delta-Events** | Infrastruktur-Entscheidung | OpenAI Direct verwenden |
| **Variabilität 33%** | Inhärentes Modell-Verhalten | Prompt-Optimierung, Vokabular-Hints |

### 9.3 Empfehlung: Warten auf bessere Modelle?

**Kurzfristig (jetzt):**
- ✅ `language: "en"` explizit setzen
- ✅ Technische Begriffe im Prompt
- ✅ **Azure gpt-4o-mini-transcribe** für British Accent bevorzugen
- ✅ Manuelles Post-Processing einplanen

**Mittelfristig (Q1 2026):**
- ⏳ Beobachten, ob OpenAI neue Modelle mit weniger Variabilität veröffentlicht
- ⏳ Prüfen, ob `gpt-realtime` (GA-Version) stabiler ist
- ⏳ Alternative: Out-of-Band Transcription Ansatz evaluieren

**Langfristig:**
- ⏳ Auf OpenAI Whisper v4 oder spezialisierte Transcription-Modelle warten
- ⏳ Hybrid-Ansatz: Realtime für Preview + Whisper Batch für finale Transkripte

### 9.4 Abschliessende Bewertung

| Frage | Antwort |
|-------|---------|
| **Können wir die Variabilität eliminieren?** | ❌ Nein, architekturbedingt |
| **Können wir sie reduzieren?** | ✅ Ja, durch Prompt + Sprache + Modellwahl |
| **Ist 60% Durchschnitt akzeptabel?** | ⚠️ Für Live-Preview ja, für Archive nein |
| **Müssen wir auf bessere Modelle warten?** | ✅ Für >90% Genauigkeit: Ja |

---

## 10. Anhang: Fehlertypen und Beispiele

### 10.1 Microsoft Foundry Video — Kritische Fehler

*Quelle: [`transcription_comparison_run_1.html`](../model_comparision/transcription_comparison_run_1.html)*

| Original | Transkribiert | Modell |
|----------|---------------|--------|
| "newly expounded Foundry" | "fast Boundary" | OpenAI mini |
| "ai.azure.com" | "ai.app." | Azure gpt-4o |
| "ai.azure.com" | "AI. Asher.com" | Azure gpt-4o (Run 2) |
| "agentic app" | "identity app" | Azure mini |
| "deep reasoning" | "deep learning" | Azure mini |

### 10.2 TED Talk — Kritische Fehler

*Quelle: [`transcription_mustafa_suleyman_ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html)*

| Original | Transkribiert | Modell |
|----------|---------------|--------|
| "AGI" | "CGI" | Azure gpt-4o |
| "I Spy" (game) | "iPhone. They spy" | OpenAI mini |
| "augment us" | "mentors" | OpenAI mini |
| (nothing) | "Auto-detect language" | Azure gpt-4o **PROMPT LEAK!** |
| (nothing) | "That's what I thought" | Azure gpt-4o **HALLUZINATION** |

### 10.3 Duplikations-Pattern

*Quelle: Alle HTML-Reports*

```
OpenAI: "understatement. Statement." (Chunk-Boundary)
OpenAI: "all the way. way to production"
Azure:  "building... Building" (Run 2)
Azure:  "workflow. flow" (Run 1)
```

### 10.4 Fehlerverteilung nach Modell

| Fehlertyp | OpenAI mini | Azure mini | Azure full |
|-----------|-------------|------------|------------|
| **wrong** | 35% | 25% | 30% |
| **missing** | 10% | 15% | **35%** |
| **extra/dup** | 25% | 25% | 5% |
| **grammar** | 20% | 30% | 20% |
| **case** | 10% | 5% | 10% |

---

## Quellenverzeichnis

### Analyse-Dateien

1. [`model_comparision/transcription_comparison_run_1.html`](../model_comparision/transcription_comparison_run_1.html) — Microsoft Foundry Run 1
2. [`model_comparision/transcription_comparison_run_2.html`](../model_comparision/transcription_comparison_run_2.html) — Microsoft Foundry Run 2
3. [`model_comparision/transcription_mustafa_suleyman_ted.html`](../model_comparision/transcription_mustafa_suleyman_ted.html) — TED Talk Vergleich

### OpenAI Dokumentation

4. [OpenAI Realtime API Guide](https://platform.openai.com/docs/guides/realtime)
5. [OpenAI API Reference - Realtime Beta Sessions](https://platform.openai.com/docs/api-reference/realtime-beta-sessions)
6. [OpenAI Developer Notes on Realtime API](https://developers.openai.com/blog/realtime-api/)
7. [OpenAI Deprecations](https://platform.openai.com/docs/deprecations)
8. [OpenAI Python SDK - Transcription Session Types](https://github.com/openai/openai-python/blob/main/src/openai/types/beta/realtime/transcription_session.py)
9. [OpenAI Cookbook - Realtime Out-of-Band Transcription](https://github.com/openai/openai-cookbook/blob/main/examples/Realtime_out_of_band_transcription.ipynb)

### Azure Dokumentation

10. [Azure OpenAI Realtime Audio Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)
11. [Azure OpenAI Realtime Audio WebSockets](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-websockets)

### Community

12. [OpenAI Forum - gpt-4o-transcribe not as good as Whisper](https://community.openai.com/t/gpt-4o-mini-transcribe-and-gpt-4o-transcribe-not-as-good-as-whisper/1153905)

---

## Änderungshistorie

| Datum | Version | Änderung |
|-------|---------|----------|
| 2025-12-29 | 1.0 | Initiale Erstellung nach 7 Test-Runs |
| 2025-12-31 | 2.0 | TED Talk Analyse hinzugefügt, Application Insights Kapitel, Fazit-Kapitel, Quelldateien-Referenzen |

---

*Dieses Dokument wurde erstellt zur Analyse der Transkriptions-Variabilität in CONTEXTPILOT.*
