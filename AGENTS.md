# AGENTS.md – ContextPilot

> **Format:** [agents.md](https://agents.md) – Ein offenes Format für KI-Coding-Agenten  
> **Zuletzt aktualisiert:** Januar 2026

---

## 🎯 Projektübersicht

**ContextPilot** ist eine Live-Transkriptions-Anwendung mit integrierter KI-Agent-Unterstützung. Sie ermöglicht Echtzeit-Audio-Transkription und kontextbezogene Analyse durch Azure AI Foundry Agents.

### Kernfunktionen
- **Live-Transkription:** Echtzeit-Audio-zu-Text via OpenAI/Azure OpenAI WebSocket Realtime API
- **Multi-Agent-Orchestrierung (MFA):** Intelligentes Routing von Anfragen durch spezialisierte Agents
- **Text-Highlighting:** Markieren und Analysieren von Transkript-Passagen
- **AURA Agents:** Integration mit Azure AI Foundry für kontextbezogene KI-Antworten

---

## 🏗️ Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React/Vite)                        │
│                     http://localhost:5173                        │
│  - App.tsx: Haupt-UI mit Transkription + Agent-Interaktion      │
│  - useDualRealtime.ts: WebSocket-Hook für Audio-Streaming       │
│  - useAuraAgent.ts: Hook für Agent-Kommunikation                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP/WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PROXY SERVER (Node.js)                          │
│                  http://localhost:3001                           │
│  - proxy-server.js: Routing + Auth + WebSocket-Relay            │
│  - Routed: /agent, /agents, /ws (OpenAI Realtime)               │
│  - Azure AD Token via DefaultAzureCredential                    │
└───────────────┬─────────────────────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌──────────────────────────┐    ┌────────────────────────────────┐
│  Azure AI Foundry        │    │  Azure Function (Python/MAF)   │
│  (Agents, Workflows)     │    │  http://localhost:7071         │
│  - AURAContext           │    │  - /api/mfa: Multi-Agent Flow  │
│  - AURAContextPilotWeb   │    │  - /api/healthz: Health Check  │
│  - AURAContextPilotQuick │    │  - Microsoft Agent Framework   │
└──────────────────────────┘    └────────────────────────────────┘
```

### Datenfluss bei Agent-Anfragen

```
Frontend → POST /agent → Proxy Server
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
     type: "agent"      type: "workflow"    type: "mfa"
           │                  │                  │
           ▼                  ▼                  ▼
    Azure AI Foundry    Azure AI Foundry    Azure Function
    (Direkt-Agent)      (Sequenziell)       (MFA Workflow)
                                                 │
                                                 ▼
                                           ┌─────────────┐
                                           │ AURATriage  │
                                           └──────┬──────┘
                                     ┌────────────┼────────────┐
                                     ▼            ▼            ▼
                                 [direct]      [web]      [context]
                                     │            │            │
                                  Quick       WebSearch    Context
                                  Agent        Agent        Agent
                                     │            │            │
                                     └────────────┴────────────┘
                                                 │
                                                 ▼
                                         AURASynthesizer
                                     (nur wenn beide Agents)
```

---

## 📁 Projektstruktur

```
E:\ContextPilot\
├── AGENTS.md                          # Diese Datei
├── AZURE_DEPLOYMENT_GUIDE.md          # Azure Deployment Dokumentation
├── docs/                              # Projektdokumentation
│   ├── CONTEXTPILOT_MFA_KONZEPT_v2.md # Hauptkonzept, Architektur, Startanleitungen
│   ├── AURA_FOUNDRY_API_GUIDE.md      # Azure AI Foundry API Referenz
│   ├── CONTEXTPILOT_CODE_REFERENCE.md # Code-Referenz für alle MFA-Dateien
│   ├── AUTHENTICATION.md              # Auth-Setup (AAD + GitHub)
│   └── SECURITY_RISK_ASSESSMENT*.md   # Security Audit
│
├── live-transcriber/                  # Frontend + Proxy Server
│   ├── package.json                   # npm dependencies
│   ├── proxy-server.js                # Node.js Proxy (Port 3001)
│   ├── index.html                     # HTML Entry Point
│   ├── .env.local                     # Lokale Secrets (NICHT COMMITTEN!)
│   ├── src/
│   │   ├── App.tsx                    # React Haupt-Komponente
│   │   ├── main.tsx                   # React Entry Point
│   │   ├── components/                # UI-Komponenten
│   │   ├── hooks/                     # React Hooks
│   │   │   ├── useDualRealtime.ts     # Audio WebSocket Hook
│   │   │   ├── useAuraAgent.ts        # Agent-Kommunikation Hook
│   │   │   └── useHighlights.ts       # Text-Highlighting Hook
│   │   └── utils/                     # Utility-Funktionen
│   └── public/                        # Static Assets
│
└── contextpilot-mfa-function/         # Azure Function (Python)
    ├── function_app.py                # HTTP Endpoints (/api/mfa, /api/healthz)
    ├── mfa_workflow.py                # MFA Orchestrierungslogik
    ├── requirements.txt               # Python dependencies (inkl. MAF)
    ├── host.json                      # Azure Functions Config
    ├── local.settings.json            # Lokale Settings (NICHT COMMITTEN!)
    └── local.settings.json.template   # Template für local.settings.json
```

---

## 🚀 Lokale Entwicklungsumgebung

### Voraussetzungen

| Tool | Version | Installation |
|------|---------|--------------|
| Node.js | 22.x | https://nodejs.org |
| Python | 3.11+ | https://python.org |
| Azure Functions Core Tools | 4.x | `npm install -g azure-functions-core-tools@4` |
| Azure CLI | Latest | https://aka.ms/install-azure-cli |

### Erste Einrichtung

```powershell
# 1. Repository klonen
git clone https://github.com/JohnMavic/ContextPilot.git
cd ContextPilot

# 2. Azure Login (für DefaultAzureCredential)
az login

# 3. Frontend Dependencies installieren
cd live-transcriber
npm install

# 4. .env.local erstellen (siehe Template unten)

# 5. Python Virtual Environment einrichten
cd ..\contextpilot-mfa-function
python -m venv ..\.venv
..\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 6. local.settings.json erstellen (aus Template)
copy local.settings.json.template local.settings.json
# → Werte in local.settings.json anpassen!
```

### .env.local Template (live-transcriber/)

```env
# Azure OpenAI / OpenAI
OPENAI_API_KEY=sk-...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini-transcribe
AZURE_OPENAI_API_KEY=...

# Azure AI Foundry (für Agents)
AZURE_AI_PROJECT_ENDPOINT=https://your-resource.services.ai.azure.com/api/projects/your-project

# Application Insights (optional)
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...

# MFA Function Key (für lokale Function)
MFA_X_FUNCTION_KEY=local-dev-key
```

---

## ⚡ Alle Komponenten starten

> **WICHTIG:** Es werden **drei separate Terminal-Fenster** benötigt!

### Terminal 1: Frontend (Vite Dev Server)

```powershell
cd E:\ContextPilot\live-transcriber
npm run dev
```

**Erwartete Ausgabe:**
```
VITE v7.2.4  ready in 500 ms
➜  Local:   http://localhost:5173/
```

**URL:** http://localhost:5173/

---

### Terminal 2: Proxy Server (Node.js)

> **Empfehlung:** In einem **externen PowerShell-Fenster** starten (nicht im VS Code Terminal), damit es nicht versehentlich geschlossen wird.

```powershell
cd E:\ContextPilot\live-transcriber
npm start
```

**Oder direkt:**
```powershell
node proxy-server.js
```

**Erwartete Ausgabe:**
```
[Proxy] Server listening on port 3001
[Proxy] Loaded 2 agents, 1 workflow, 1 MFA
```

**URL:** http://localhost:3001/

---

### Terminal 3: Azure Function (Python + MAF)

> **Empfehlung:** In einem **externen PowerShell-Fenster** starten.

```powershell
cd E:\ContextPilot\contextpilot-mfa-function

# Python Virtual Environment aktivieren
..\.venv\Scripts\Activate.ps1

# Function starten
func start --port 7071 --verbose
```

**Erwartete Ausgabe:**
```
Azure Functions Core Tools
...
Functions:
    healthz: [GET] http://localhost:7071/api/healthz
    mfa_endpoint: [POST] http://localhost:7071/api/mfa
```

**Health Check Test:**
```powershell
Invoke-RestMethod -Uri "http://localhost:7071/api/healthz"
# Erwartung: {"ok": true, "version": "2.5"}
```

---

### Zusammenfassung: Drei Terminals

| Terminal | Ordner | Befehl | Port | Empfehlung |
|----------|--------|--------|------|------------|
| 1 - Frontend | `live-transcriber` | `npm run dev` | 5173 | VS Code Terminal ✓ |
| 2 - Proxy | `live-transcriber` | `npm start` | 3001 | Externes PowerShell ⚡ |
| 3 - Function | `contextpilot-mfa-function` | `func start --port 7071` | 7071 | Externes PowerShell ⚡ |

### Wichtige lokale URLs

| Komponente | URL | Zweck |
|------------|-----|-------|
| Frontend | http://localhost:5173/ | React App (UI) |
| Proxy Agents | http://localhost:3001/agents | Agent-Liste abrufen |
| Function Health | http://localhost:7071/api/healthz | Function-Status prüfen |
| Function MFA | http://localhost:7071/api/mfa | MFA-Endpoint (POST) |

---

## 🔧 VS Code Tasks

Das Projekt enthält vorkonfigurierte Tasks in `.vscode/tasks.json`:

```json
{
  "label": "func: host start",
  "type": "func",
  "command": "host start",
  "dependsOn": "pip install (functions)"
}
```

**Verwendung:** `Ctrl+Shift+B` → Task auswählen

---

## 🐛 Troubleshooting

| Problem | Lösung |
|---------|--------|
| `func: command not found` | `npm install -g azure-functions-core-tools@4` |
| Function zeigt "0 Functions" | `local.settings.json` prüfen – alle ENV Vars gesetzt? |
| Proxy Error "ECONNREFUSED 7071" | Function läuft nicht? `func start` in Terminal 3 |
| Frontend zeigt keine Agents | Proxy läuft nicht? `.env.local` korrekt? |
| `az login` Token abgelaufen | `az login` erneut ausführen |
| CORS Errors im Browser | Nur über http://localhost:5173 zugreifen |
| Python Import Errors | `.venv` aktiviert? `pip install -r requirements.txt` |

---

## 📋 Coding Conventions

### TypeScript/React (Frontend)

- **React 18.3** mit Functional Components und Hooks
- **TypeScript** mit strikten Types
- **Naming:** camelCase für Variablen/Funktionen, PascalCase für Komponenten
- **Hooks:** Prefix `use` (z.B. `useAuraAgent`, `useDualRealtime`)
- **Imports:** Named Exports bevorzugt

```tsx
// ✓ Empfohlen
import { useState, useCallback } from "react";
import { useAuraAgent } from "./hooks/useAuraAgent";

// ✗ Vermeiden
import React from "react";
```

### Python (Azure Function)

- **Python 3.11+** mit Type Hints
- **Async/Await** für alle I/O-Operationen
- **Microsoft Agent Framework (MAF)** für Agent-Aufrufe
- **Logging:** Keine Prompts/PII in Logs (Security!)

```python
# ✓ Empfohlen
async def run_mfa_workflow(prompt: str) -> dict[str, Any]:
    async with DefaultAzureCredential() as credential:
        # ...

# ✗ Vermeiden
logging.info(f"Prompt: {prompt}")  # Kein PII in Logs!
```

### Node.js (Proxy Server)

- **ES Modules** (`"type": "module"` in package.json)
- **Native fetch** (keine axios Dependency)
- **DefaultAzureCredential** für Azure Auth

---

## 🔐 Security Hinweise

> **Vollständige Details:** Siehe [docs/SECURITY_RISK_ASSESSMENT_2026-01.md](docs/SECURITY_RISK_ASSESSMENT_2026-01.md)

### Wichtige Punkte

1. **Secrets nie committen:**
   - `.env.local` → in `.gitignore`
   - `local.settings.json` → in `.gitignore`
   - `appservice-appsettings.generated.json` → in `.gitignore`

2. **CORS:** Nur `http://localhost:5173` erlaubt (nicht `*`)

3. **Function Auth:** `AuthLevel.FUNCTION` erfordert `x-functions-key`

4. **Azure Auth:** AAD + GitHub auf 2 spezifische Accounts beschränkt

---

## 🤖 Hinweise für KI-Agenten

### Kontext verstehen

1. **MFA ≠ Multi-Factor Authentication!** Hier bedeutet MFA "Multi-Agent Flow Architecture"
2. **MAF = Microsoft Agent Framework** (offizielles SDK)
3. Das Projekt nutzt **Azure AI Foundry** für Agent-Hosting

### Wichtige Dateien für Code-Änderungen

| Bereich | Primäre Datei(en) |
|---------|-------------------|
| MFA Logik | `contextpilot-mfa-function/mfa_workflow.py` |
| HTTP Endpoints | `contextpilot-mfa-function/function_app.py` |
| Agent-Kommunikation | `live-transcriber/src/hooks/useAuraAgent.ts` |
| Transkription | `live-transcriber/src/hooks/useDualRealtime.ts` |
| Proxy Routing | `live-transcriber/proxy-server.js` |
| Haupt-UI | `live-transcriber/src/App.tsx` |

### Agent-Namen in Azure AI Foundry

| Agent | Zweck |
|-------|-------|
| `AURATriage` | Routing-Entscheidung (direct/web/context) |
| `AURAContextPilotQuick` | Schnelle Antworten (Übersetzungen, Allgemeinwissen) |
| `AURAContextPilotWeb` | Web-Suche für aktuelle Daten |
| `AURAContextPilot` | Interner Business-Index |
| `AURAContextPilotResponseSynthesizer` | Zusammenführung bei Multi-Agent-Antworten |

### Vor Code-Änderungen prüfen

1. **Dokumentation lesen:** `docs/CONTEXTPILOT_MFA_KONZEPT_v2.md` enthält alle Details
2. **API-Format:** `docs/AURA_FOUNDRY_API_GUIDE.md` für Foundry API
3. **Bestehende Tests:** Keine automatisierten Tests vorhanden (Prototyp-Status)
4. **Security:** Keine Secrets in Code/Logs, CORS nicht auf `*` setzen

### Typischer Workflow für Änderungen

```
1. Relevante Dokumentation in docs/ lesen
2. Betroffene Komponente identifizieren (Frontend/Proxy/Function)
3. Code-Änderung implementieren
4. Lokal testen mit allen 3 Terminals
5. Bei MFA-Änderungen: Function Health Check prüfen
```

---

## 📚 Weiterführende Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [docs/CONTEXTPILOT_MFA_KONZEPT_v2.md](docs/CONTEXTPILOT_MFA_KONZEPT_v2.md) | Hauptkonzept, Architektur, lokale Entwicklung |
| [docs/AURA_FOUNDRY_API_GUIDE.md](docs/AURA_FOUNDRY_API_GUIDE.md) | Azure AI Foundry Responses API |
| [docs/CONTEXTPILOT_CODE_REFERENCE.md](docs/CONTEXTPILOT_CODE_REFERENCE.md) | Vollständiger Code aller MFA-Dateien |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Auth-Setup für Azure Static Web Apps |
| [docs/SECURITY_RISK_ASSESSMENT_2026-01.md](docs/SECURITY_RISK_ASSESSMENT_2026-01.md) | Security Audit und Mitigations |

---

## 📞 Kontakt

| Rolle | Kontakt |
|-------|---------|
| **Auftraggeber** | Martin Hämmerli |
| **Repository** | https://github.com/JohnMavic/ContextPilot |
