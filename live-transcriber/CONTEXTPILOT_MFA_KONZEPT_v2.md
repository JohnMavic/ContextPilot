# CONTEXTPILOT MFA-Konzept v2.1
## Umstellung auf Azure Function mit Microsoft Agent Framework

**Version:** 2.1  
**Datum:** 24. Dezember 2025  
**Status:** Validiert (MAF) – Entwurf zur Umsetzung  
**Technologie-Stack:** Azure Function (Python) + Microsoft Agent Framework (MAF)

---

### Projektbeteiligte

| Rolle | Name/Tool |
|-------|-----------|
| **Auftraggeber** | Martin Hämmerli |
| **Entwickler** | GitHub Copilot / Claude Opus 4.5 |
| **Berater** | ChatGPT 5.2 / Extended Thinking |

**GitHub Repository:** [https://github.com/JohnMavic/ContextPilot](https://github.com/JohnMavic/ContextPilot)

---

### Begriffserklärung: MFA vs. MAF

| Abkürzung | Bedeutung | Verwendung |
|-----------|-----------|------------|
| **MFA** | **M**ulti-Agent **F**low **A**rchitektur | Projektspezifische Bezeichnung für die Multi-Agent-Lösung in CONTEXTPILOT (Ordner, Variablen, API-Responses) |
| **MAF** | **M**icrosoft **A**gent **F**ramework | Offizielles SDK (`agent-framework-core`, `agent-framework-azure-ai`) |

> **Hinweis:** "MFA" ist **nicht** zu verwechseln mit "Multi-Factor Authentication". Im CONTEXTPILOT-Kontext bezeichnet MFA stets die Multi-Agent-Architektur, die auf dem Microsoft Agent Framework (MAF) basiert.

---

## 1. Zusammenfassung

Dieses Konzept beschreibt die Erweiterung von CONTEXTPILOT um eine **MFA-Option** (Multi-Agent Framework), die echte Parallelisierung mittels Microsoft Agent Framework in einer Azure Function implementiert.

**Kernziele:**
- ✅ Bestehende Funktionalität (Agent, Workflow) bleibt **unverändert**
- ✅ Neue MFA-Option nutzt **offizielles Microsoft Agent Framework**
- ✅ Echte Parallelität via `add_multi_selection_edge_group()` (dynamisch) + `add_fan_in_edges()` (Fan-In)
- ✅ Dynamische Agent-Auswahl durch **AURATriage**
- ✅ Stabil durch Version-Pinning + kontrollierte Updates (Upgrade nur nach Test)

---

## 2. Architektur: Vorher vs. Nachher

> **Was Sie hier lernen:** Die CONTEXTPILOT-Architektur besteht aus drei Komponenten: React-Frontend (SWA), Node.js-Proxy (App Service), und Azure AI Foundry Agents. Die MFA-Erweiterung fügt eine Python-basierte Azure Function hinzu, die parallel mehrere Agents orchestriert – ohne die bestehenden Wege (Agent/Workflow) zu verändern.

### 2.1 Bestehende Architektur (bleibt erhalten!)

```
┌─────────────────────────────────────────────────────────────────────┐
│  BESTEHEND – WIRD NICHT VERÄNDERT                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [SWA Frontend]                                                    │
│        │                                                            │
│        │ POST /agent                                                │
│        ↓                                                            │
│   [Proxy - App Service]                                             │
│        │                                                            │
│        ├─── type: "agent"    → Foundry Agent (direkt)               │
│        │                                                            │
│        └─── type: "workflow" → Foundry Workflow (sequenziell)       │
│                                    │                                │
│                                    ↓                                │
│                              CONTEXTPILOT Workflow                  │
│                              (Web → Context → Synthesizer)          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Erweiterte Architektur (NEU: MFA hinzugefügt)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ERWEITERT – NEUE MFA-OPTION                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   [SWA Frontend]                                                    │
│        │                                                            │
│        │ POST /agent                                                │
│        ↓                                                            │
│   [Proxy - App Service]                                             │
│        │                                                            │
│        ├─── type: "agent"    → Foundry Agent        (unverändert)   │
│        │                                                            │
│        ├─── type: "workflow" → Foundry Workflow     (unverändert)   │
│        │                                                            │
│        └─── type: "mfa"      → Azure Function (NEU) ───────────┐    │
│                                                                │    │
│   ┌────────────────────────────────────────────────────────────┘    │
│   │                                                                 │
│   ▼                                                                 │
│   [Azure Function - Python + MAF]                                   │
│        │                                                            │
│        │  Microsoft Agent Framework                                 │
│        │  WorkflowBuilder + fan_out/fan_in                          │
│        │                                                            │
│        ▼                                                            │
│   ┌─────────────┐                                                   │
│   │ AURATriage  │ ← Entscheidet welche Agenten                      │
│   └──────┬──────┘                                                   │
│          │                                                          │
│          │ add_multi_selection_edge_group()                         │
│          │                                                          │
│   ┌──────┴──────┬──────────────┐                                    │
│   ▼             ▼              ▼                                    │
│ [Web]       [Context]     [Future...]   ← Parallel!                 │
│   │             │              │                                    │
│   └──────┬──────┴──────────────┘                                    │
│          │                                                          │
│          │ add_fan_in_edges()                                       │
│          ▼                                                          │
│   ┌─────────────┐                                                   │
│   │ Synthesizer │ ← Fasst alles zusammen                            │
│   └─────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Warum diese Architektur die bestehenden Prozesse nicht zerstört

> **Was Sie hier lernen:** Der MFA-Weg ist vollständig isoliert vom bestehenden Code. Im `proxy-server.js` wird lediglich eine `if`-Bedingung (`if (agent.type === "mfa")`) hinzugefügt, die zu einer komplett neuen Funktion `handleMFARequest()` weiterleitet. Bestehende Funktionen `handleAgentRequest()` und `handleWorkflowRequest()` bleiben unverändert.

### 3.1 Isolationsprinzip

| Aspekt | Bestehend | MFA (Neu) | Konflikt? |
|--------|-----------|-----------|-----------|
| **Routing-Logik** | `type: "agent"` oder `type: "workflow"` | `type: "mfa"` (NEU) | ❌ Nein |
| **Endpoint** | `/agent` (gleich) | `/agent` (gleich) | ❌ Nein - Unterscheidung via `currentAgentId` |
| **Proxy-Code** | `handleAgentRequest()`, `handleWorkflowRequest()` | `handleMFARequest()` (NEU) | ❌ Separate Funktion |
| **Foundry Agenten** | Direkt aufgerufen | Indirekt via MAF | ❌ Agenten unverändert |

### 3.2 Code-Änderungen im Proxy (Minimal-invasiv)

> **Was Sie hier lernen:** Die einzige Änderung an bestehendem Code ist eine `if`-Bedingung in `handleAgentRequest()`: Wenn `agent.type === "mfa"`, wird zu `handleMFARequest()` verzweigt. Die bestehenden Pfade für `type: "agent"` und `type: "workflow"` bleiben völlig unverändert.

```javascript
// proxy-server.js - Zeile 282-288 (bestehend)
async function handleAgentRequest(req, res, body) {
  const agent = getCurrentAgent();
  
  // BESTEHEND - unverändert
  if (agent.type === "workflow") {
    return handleWorkflowRequest(req, res, body, agent);
  }
  
  // NEU - nur diese Zeilen hinzufügen
  if (agent.type === "mfa") {
    return handleMFARequest(req, res, body, agent);  // → Azure Function
  }
  
  // BESTEHEND - Rest der Agent-Logik unverändert
  // ...
}
```

### 3.3 Neue Funktion für MFA (komplett isoliert)

> **Was Sie hier lernen:** Die Funktion `handleMFARequest()` ist komplett neu und berührt keinen bestehenden Code. Sie ruft die Azure Function über HTTP auf, übergibt den User-Prompt, und gibt die Antwort zurück. Bei Fehlern (5xx, Timeout) gibt es 3 Retry-Versuche mit exponentiellem Backoff.

```javascript
// proxy-server.js - NEUE Funktion (keine Änderung an bestehendem Code)
async function handleMFARequest(req, res, body, mfaConfig) {
  console.log(`[MFA] Forwarding to Azure Function: ${mfaConfig.endpoint}`);
  
  const payload = JSON.parse(body || "{}");
  
  // Einfacher Forward an Azure Function
  const resp = await fetch(mfaConfig.endpoint, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "x-functions-key": mfaConfig.functionKey  // oder Managed Identity
    },
    body: JSON.stringify({ prompt: payload.prompt })
  });
  
  const result = await resp.json();
  
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ output_text: result.output_text }));
}
```

---

## 4. Azure Function: MAF-Implementation im Detail

> **Was Sie hier lernen:** Die Azure Function ist eine Python 3.11-Anwendung, die im Ordner `contextpilot-mfa-function/` liegt. Sie verwendet das Microsoft Agent Framework (MAF) SDK, um Azure AI Foundry Agents aufzurufen. Der Einstiegspunkt ist `function_app.py` (HTTP-Trigger), die Workflow-Logik liegt in `mfa_workflow.py`.

### 4.1 Projektstruktur

> ⚠️ **KORREKTUR (26.12.2025):** Die ursprüngliche Struktur war zu komplex. Der `agents/` Ordner wurde nicht benötigt.

<details>
<summary>❌ <span style="color:red"><b>FALSCH - Ursprüngliche Konzept-Struktur</b></span></summary>

```
contextpilot-mfa-function/
├── function_app.py          # Azure Function Entry Point
├── mfa_workflow.py          # MAF Workflow Definition
├── agents/                   ❌ NICHT BENÖTIGT
│   └── foundry_agents.py    ❌ NICHT BENÖTIGT
├── requirements.txt
├── host.json
└── local.settings.json
```
</details>

✅ **KORREKT - Tatsächliche Produktiv-Struktur:**

```
contextpilot-mfa-function/
├── function_app.py          # Azure Function Entry Point (mit Lazy Import!)
├── mfa_workflow.py          # MFA Workflow-Logik (direkt, ohne Executor-Klassen)
├── requirements.txt         # MUSS agent-framework-azure-ai enthalten!
├── host.json
├── local.settings.json.template  # Template (local.settings.json nicht committen!)
└── .gitignore
```

**Wichtige Unterschiede:**
- Kein `agents/` Ordner nötig - alle Logik in `mfa_workflow.py`
- Keine separaten Executor-Klassen - direkter async/await Flow
- `local.settings.json.template` statt der echten Datei (Secrets!)

### 4.2 requirements.txt (Version-Pinning – empfohlen)

> **Was Sie hier lernen:** Die Datei `requirements.txt` listet alle Python-Pakete, die die Azure Function benötigt. Kritisch sind zwei MAF-Pakete: `agent-framework-core` (Basis-SDK) und `agent-framework-azure-ai` (Azure AI Foundry Integration). Ohne das zweite Paket erscheint der Fehler "0 Functions registered" beim Deployment.

> Wichtig: MAF/Foundry SDKs sind teilweise Preview/Beta. **Du darfst keine unpinned `--pre`-Installationen deployen.**
> Ziel: reproduzierbares Deployment ohne "drift" durch transitive Pre-Release Updates.

```text
# Azure Functions Runtime
azure-functions==1.13.3

# Microsoft Agent Framework (MAF) – Pin auf eine getestete Version
# Empfehlung (Stand 24. Dez 2025): 1.0.0b251223
agent-framework-core==1.0.0b251223
agent-framework-azure-ai==1.0.0b251223

# Transitive Preview-Dependencies von agent-framework-azure-ai (explizit pinnen!)
# Hinweis: agent-framework-azure-ai verlangt u.a. azure-ai-projects>=2.0.0b2 und azure-ai-agents==1.2.0b5.
azure-ai-projects==2.0.0b2
azure-ai-agents==1.2.0b5

# HTTP stack (vom Azure AI Stack verwendet)
aiohttp==3.13.2

# Auth / Typing
azure-identity==1.13.0
typing-extensions==4.9.0
```

Hinweis zur Reproduzierbarkeit:
- PoC: obige Pins reichen in der Regel.
- Produktiv/Compliance: zusätzlich ein Lockfile erzeugen (z.B. `pip-tools`/`uv lock`) und exakt daraus deployen.



### 4.3 MAF Workflow Code (mfa_workflow.py)

> **Was Sie hier lernen:** Die Datei `mfa_workflow.py` enthält die Funktion `run_mfa_workflow(prompt)`, die den Multi-Agent-Flow ausführt. Der Flow ist: (1) AURATriage entscheidet das Routing, (2) je nach Routing werden AURAContextPilotWeb und/oder AURAContextPilot aufgerufen, (3) bei zwei Agents fasst der Synthesizer die Ergebnisse zusammen. Die Agents werden per `agent_name=` + `use_latest_version=True` aufgelöst.

> ⚠️ **KORREKTUR (26.12.2025):** Die Annahmen zu `agent_id` und dem Import-Pfad waren falsch!

<details>
<summary>❌ <span style="color:red"><b>FALSCH - Ursprüngliche Konzept-Annahmen</b></span></summary>

```python
"""
CONTEXTPILOT MFA Workflow (MAF, Python)
Pattern: Triage -> Fan-Out (parallel) -> Fan-In -> Synthesizer

Wichtig:
- Bestehende Foundry Agents werden als *existing agents* per agent_id verwendet.  ❌ FALSCH
- Kein "resolve by name" annehmen.  ❌ FALSCH - resolve by name funktioniert!
- SDK-default ENV VARs verwenden (AZURE_AI_PROJECT_ENDPOINT / AZURE_AI_MODEL_DEPLOYMENT_NAME).
"""
```
</details>

✅ **KORREKT - Tatsächliche Implementation:**

```python
"""
CONTEXTPILOT MFA Workflow v2.4 (MAF, Python)

Korrekte Erkenntnisse:
- Agents werden per NAME aufgelöst (nicht per agent_id!)
- AzureAIClient(..., agent_name="...", use_latest_version=True) funktioniert
- Kein WorkflowBuilder/Executor-Pattern nötig für einfache Flows
- Direkter async/await ist einfacher und funktioniert
"""

from __future__ import annotations

import json
import os
from typing import Any

from typing_extensions import Never

```

<details>
<summary>❌ <span style="color:red"><b>FALSCH - Import-Pfad und AGENT_ID</b></span></summary>

```python
from agent_framework import (
    ChatAgent,
    Executor,
    WorkflowBuilder,      # ❌ Nicht nötig für einfache Flows
    WorkflowContext,
    WorkflowOutputEvent,
    handler,
)
from agent_framework_azure_ai import AzureAIAgentClient  # ❌ FALSCHER IMPORT-PFAD!
from azure.identity.aio import DefaultAzureCredential

# ❌ FALSCH: AGENT_ID verwenden
AURA_TRIAGE_AGENT_ID = os.environ["AURA_TRIAGE_AGENT_ID"]  # ❌ IDs sind fragil!
AURA_WEB_AGENT_ID = os.environ["AURA_WEB_AGENT_ID"]
AURA_CONTEXT_AGENT_ID = os.environ["AURA_CONTEXT_AGENT_ID"]
AURA_SYNTHESIZER_AGENT_ID = os.environ["AURA_SYNTHESIZER_AGENT_ID"]
```
</details>

✅ **KORREKT - Produktiv-Code:**

```python
# Korrekter Import-Pfad!
from agent_framework.azure import AzureAIClient  # ✅ RICHTIG: agent_framework.azure
from azure.identity.aio import DefaultAzureCredential

AZURE_AI_PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
AZURE_AI_MODEL_DEPLOYMENT_NAME = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]

# ✅ KORREKT: AGENT_NAME verwenden (nicht ID!)
# Namen sind stabil, IDs ändern sich bei Agent-Updates
AURA_TRIAGE_AGENT_NAME = os.environ["AURA_TRIAGE_AGENT_NAME"]
AURA_QUICK_AGENT_NAME = os.environ.get("AURA_QUICK_AGENT_NAME", "AURAContextPilotQuick")
AURA_WEB_AGENT_NAME = os.environ["AURA_WEB_AGENT_NAME"]
AURA_CONTEXT_AGENT_NAME = os.environ["AURA_CONTEXT_AGENT_NAME"]
AURA_SYNTHESIZER_AGENT_NAME = os.environ["AURA_SYNTHESIZER_AGENT_NAME"]


# ============================================================
# EXECUTORS
# ============================================================
class TriageExecutor(Executor):
    """Ruft AURATriage auf und liefert eine Routing-Entscheidung."""

    def __init__(self, agent: ChatAgent):
        super().__init__(id="triage")
        self._agent = agent

    @handler
    async def handle(self, prompt: str, ctx: WorkflowContext) -> None:
        result = await self._agent.run(prompt)

        try:
            decision = json.loads(result.text)
        except Exception:
            # Fallback: beide Agenten aktivieren
            decision = {"agents": {"web": True, "context": True}, "reasoning": "fallback"}

        await ctx.send_message({"original_prompt": prompt, "decision": decision})


class WebAgentExecutor(Executor):
    """Ruft AURAContextPilotWeb auf."""

    def __init__(self, agent: ChatAgent):
        super().__init__(id="web_agent")
        self._agent = agent

    @handler
    async def handle(self, data: dict[str, Any], ctx: WorkflowContext) -> None:
        result = await self._agent.run(data["original_prompt"])
        await ctx.send_message({"agent": "web", "response": result.text})


class ContextAgentExecutor(Executor):
    """Ruft AURAContextPilot auf."""

    def __init__(self, agent: ChatAgent):
        super().__init__(id="context_agent")
        self._agent = agent

    @handler
    async def handle(self, data: dict[str, Any], ctx: WorkflowContext) -> None:
        result = await self._agent.run(data["original_prompt"])
        await ctx.send_message({"agent": "context", "response": result.text})


class SynthesizerExecutor(Executor):
    """Fasst alle Agent-Antworten zusammen."""

    def __init__(self, agent: ChatAgent):
        super().__init__(id="synthesizer")
        self._agent = agent

    @handler
    async def handle(
        self, results: list[dict[str, Any]], ctx: WorkflowContext[Never, str]
    ) -> None:
        prompt = self._build_synthesis_prompt(results)
        result = await self._agent.run(prompt)
        await ctx.yield_output(result.text)

    @staticmethod
    def _build_synthesis_prompt(results: list[dict[str, Any]]) -> str:
        lines: list[str] = ["Fasse die folgenden Agent-Antworten zusammen:
"]
        for r in results:
            agent_key = r.get("agent")
            if not agent_key:
                continue
            lines.append(f"=== Antwort von {str(agent_key).upper()} ===")
            lines.append(str(r.get("response", "")))
            lines.append("")
        lines.append("Erstelle eine kohärente, zusammengefasste Antwort.")
        return "
".join(lines)


# ============================================================
# WORKFLOW GRAPH
# ============================================================
# ⚠️ HINWEIS: Der WorkflowBuilder/DAG-Ansatz erwies sich als Overkill.
# Die finale Implementierung nutzt einfache if/else Logik.
# Siehe: contextpilot-mfa-function/mfa_workflow.py
# ============================================================

def select_agents(triage_output: dict[str, Any], target_ids: list[str]) -> list[str]:
    """
    Auswahlfunktion für add_multi_selection_edge_group().

    target_ids Reihenfolge entspricht der Reihenfolge der übergebenen Executor-Liste:
    [web_agent_executor.id, context_agent_executor.id]
    """
    web_id, context_id = target_ids
    decision = triage_output.get("decision", {}).get("agents", {})

    selected: list[str] = []
    if decision.get("web") is True:
        selected.append(web_id)
    if decision.get("context") is True:
        selected.append(context_id)

    return selected or [web_id, context_id]


# ⚠️ FALSCH - ÜBERKOMPLEXES PATTERN ⚠️
#
# Das folgende Pattern verwendet:
# 1. AzureAIAgentClient (veraltet) statt AzureAIClient
# 2. agent_id (starr) statt agent_name + use_latest_version
# 3. WorkflowBuilder (Overkill für diesen Use-Case)
#
# <details>
# <summary>❌ Ursprünglicher (falscher) Code</summary>
#
# async def build_mfa_workflow():
#     async with (
#         DefaultAzureCredential() as credential,
#         AzureAIAgentClient(
#             credential=credential,
#             project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
#             model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
#             agent_id=AURA_TRIAGE_AGENT_ID,  # ❌ FALSCH!
#         ).create_agent() as triage_agent,
#         # ... weitere agents mit agent_id ...
#     ):
#         workflow = WorkflowBuilder()...  # ❌ Überkomplex
#
# </details>

# ✅ KORREKTE IMPLEMENTIERUNG (einfach und stabil):
async def run_mfa_workflow(prompt: str) -> dict[str, Any]:
    """Führt den optimierten MFA-Workflow aus.
    
    Verwendet:
    - AzureAIClient (nicht AzureAIAgentClient!)
    - agent_name + use_latest_version=True (nicht agent_id!)
    - Einfache sequentielle Logik (kein WorkflowBuilder nötig)
    """
    
    async with DefaultAzureCredential() as credential:
        
        # === PHASE 1: TRIAGE ===
        async with AzureAIClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_name=AURA_TRIAGE_AGENT_NAME,  # ✅ Name statt ID!
            use_latest_version=True,             # ✅ Automatische Updates!
        ).create_agent() as triage_agent:
            triage_result = await triage_agent.run(prompt)
            routing = parse_triage_response(triage_result.text)
        
        # === PHASE 2-4: Weitere Agents nach Bedarf ===
        # Siehe vollständige Implementierung in:
        # contextpilot-mfa-function/mfa_workflow.py


async def run_mfa_workflow(prompt: str) -> str:
    """Führt den kompletten MFA-Workflow aus und liefert die finale Antwort."""
    workflow = await build_mfa_workflow()

    final_output: str | None = None
    async for event in workflow.run_stream(prompt):
        if isinstance(event, WorkflowOutputEvent):
            final_output = event.data

    return final_output or "Keine Antwort erhalten."
```

### 4.4 Azure Function Entry Point (function_app.py)

> **Was Sie hier lernen:** Die Datei `function_app.py` definiert die HTTP-Trigger der Azure Function. Sie enthält zwei Endpoints: `/api/healthz` (Health-Check ohne schwere Imports) und `/api/mfa` (der eigentliche MFA-Endpoint). **KRITISCH:** Der Import von `mfa_workflow` muss INNERHALB der Funktion erfolgen (Lazy Import), nicht am Dateianfang – sonst werden 0 Functions registriert!

> ⚠️ **KRITISCHE KORREKTUR (26.12.2025):** Der Top-Level Import von `mfa_workflow` war der Hauptgrund für das "0 Functions"-Problem!

<details>
<summary>❌ <span style="color:red"><b>FALSCH - Top-Level Import (VERURSACHT 0 FUNCTIONS!)</b></span></summary>

```python
"""
Azure Function HTTP Trigger für CONTEXTPILOT MFA.
"""

import azure.functions as func
import json
import asyncio
from mfa_workflow import run_mfa_workflow  # ❌ TOP-LEVEL IMPORT = FATAL!

app = func.FunctionApp()
```

**Warum ist das falsch?**
- Azure Functions Python v2 Model indexiert Functions durch Import von `function_app.py`
- Wenn dabei eine Exception auftritt (z.B. `ModuleNotFoundError`), werden **0 Functions** registriert
- Das Deployment zeigt "erfolgreich", aber keine Functions sind verfügbar!
- Der Health-Check `/admin/host/status` zeigt "Running" aber keine Functions
</details>

✅ **KORREKT - Lazy Import Pattern (Produktiv-Code):**

```python
"""
Azure Function HTTP Trigger für CONTEXTPILOT MFA.
"""

from __future__ import annotations

import json
import logging
import uuid

import azure.functions as func

# ✅ KEIN TOP-LEVEL IMPORT von mfa_workflow!
# Der Import erfolgt LAZY innerhalb der Funktion

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@app.route(route="healthz", methods=["GET"])
def healthz(req: func.HttpRequest) -> func.HttpResponse:
    """Health check endpoint - lädt OHNE Heavy-Imports."""
    return func.HttpResponse(
        json.dumps({"ok": True, "version": "2.4"}),
        status_code=200,
        mimetype="application/json",
    )


@app.route(route="mfa", methods=["POST"])
async def mfa_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """MFA Endpoint mit LAZY Import."""
    
    correlation_id = req.headers.get("x-correlation-id") or str(uuid.uuid4())
    
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
        )

    prompt = (body or {}).get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return func.HttpResponse(
            json.dumps({"error": "Missing 'prompt' in request body"}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        # ✅ LAZY IMPORT: Import INNERHALB der Funktion!
        # Das verhindert, dass Worker-Indexing bei ImportError ausfällt
        from mfa_workflow import run_mfa_workflow

        result = await run_mfa_workflow(prompt)
        return func.HttpResponse(
            json.dumps({
                "output_text": result["response"],
                "workflow": "mfa",
                "agents_used": result["agents_used"],
                "routing": result["routing"],
            }),
            status_code=200,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
    except Exception as e:
        logging.exception("MFA failed (cid=%s)", correlation_id)
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )

@app.route(route="mfa", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
async def mfa_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP Endpoint für MFA-Anfragen.
    
    Request Body:
    {
        "prompt": "User-Frage hier..."
    }
    
    Response:
    {
        "output_text": "Synthetisierte Antwort...",
        "workflow": "mfa"
    }
    """
    
    try:
        body = req.get_json()
        prompt = body.get("prompt", "")
        
        if not prompt:
            return func.HttpResponse(
                json.dumps({"error": "Missing 'prompt' in request body"}),
                status_code=400,
                mimetype="application/json"
            )
        
        # MAF Workflow ausführen
        result = await run_mfa_workflow(prompt)
        
        return func.HttpResponse(
            json.dumps({
                "output_text": result,
                "workflow": "mfa"
            }),
            status_code=200,
            mimetype="application/json"
        )
        
    except Exception as e:
        return func.HttpResponse(
            json.dumps({
                "error": str(e),
                "hint": "Check Azure Function logs for details"
            }),
            status_code=500,
            mimetype="application/json"
        )
```

### 4.5 Rolle von `AzureAIAgentClient` im CONTEXTPILOT-MAF Bild

> **Was Sie hier lernen:** Die Klasse `AzureAIClient` (nicht `AzureAIAgentClient`!) ist der Python-Client, der Azure AI Foundry Agents als ausführbare `ChatAgent`-Instanzen bereitstellt. Sie handhabt Authentifizierung (Managed Identity), Projekt-Endpoint-Konfiguration und Agent-Auflösung per Name.

**Kurzantwort:** `AzureAIAgentClient` ist **kein** Foundry-Agent. Es ist der **Python-SDK-Client/Adapter**, mit dem MAF einen bestehenden **Azure AI Foundry Agent** (z. B. `AURAContextPilotWeb`) als ausführbaren `ChatAgent` in Python instanziert.

**Warum brauchen wir ihn?**
- Im bestehenden Node/Proxy-Flow ruft ihr Agents/Workflows über die **Foundry Responses API** auf.
- Im neuen MAF-Flow läuft die Orchestrierung in **Python** (Azure Function). Damit die Workflow-Executors die **gleichen** Foundry-Agents nutzen können, brauchen sie einen Python-Client, der:
  - Auth (Managed Identity / Credential) handhabt,
  - `project_endpoint` + `agent_name` nutzt (~~agent_id~~ ❌),
  - eine lauffähige `ChatAgent`-Instanz erzeugt (`create_agent()`),
  - und dann `run()` auf diesem Agent erlaubt.

**So passt es ins Bild:**
- `AURAContextPilotWeb`, `AURAContextPilot`, `AURAContextPilotResponseSynthesizer` bleiben **die gleichen Foundry Agents wie heute**.
- Neu kommt `AURATriage` dazu (Foundry Agent).
- ~~`AzureAIAgentClient(..., agent_id="<AgentId>")`~~ ❌ **FALSCH!**
- ✅ **KORREKT:** `AzureAIClient(..., agent_name="<AgentName>", use_latest_version=True)` ist die **Transport-/SDK-Schicht**, um diese Agents in Python/MAF aufzurufen.

### 4.6 Timeout-Realität für HTTP Trigger (Consumption)

> **Was Sie hier lernen:** Azure Functions haben ein hartes HTTP-Response-Limit von 230 Sekunden (Azure Load Balancer Idle Timeout). Die `functionTimeout`-Einstellung in `host.json` sollte darunter liegen (210s empfohlen). Bei längeren Workloads: Durable Functions oder Async Pattern verwenden.

Für **HTTP Trigger** gilt ein praktisches Response-Limit (Load Balancer Idle Timeout). Plane konservativ:

- `host.json` → `functionTimeout`: **00:03:30** (210s) als Safe Default.
- Wenn du absehbar >230s brauchst: **Durable Functions async pattern** oder „defer work + immediate response“.

Begründung und Limits: siehe Microsoft Learn (Function app time-out duration – HTTP Trigger 230s Limit).

---

## 5. AURATriage: Entscheidungslogik

> **Was Sie hier lernen:** AURATriage ist ein Azure AI Foundry Agent, der als Routing-Entscheider fungiert. Er analysiert die Benutzeranfrage und gibt JSON zurück: `{"routing": {"direct": bool, "web": bool, "context": bool}}`. Die Funktion `parse_triage_response()` in `mfa_workflow.py` verarbeitet diese JSON-Antwort und entscheidet, welche nachfolgenden Agents aufgerufen werden.

### 5.1 Neues Pattern: Direct Response (v2.2)

**Kernprinzip:** GPT-4/5 kann viele Anfragen DIREKT beantworten - ohne Agent-Aufruf!

```
┌─────────────────────────────────────────────────────────────────────┐
│  OPTIMIERTES ROUTING (v2.2)                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Triage entscheidet:                                                │
│  ├─ "direct": true  → GPT antwortet SOFORT ⚡ (kein Agent)          │
│  ├─ "web": true     → NUR bei aktuellen Daten (Wetter, Börse, News) │
│  ├─ "context": true → NUR bei internen Business-Fragen              │
│  └─ BEIDE true      → Nur bei explizitem Vergleich intern/extern    │
│                                                                     │
│  Synthesizer:                                                       │
│  → NUR wenn BEIDE Agents (web + context) genutzt wurden             │
│  → Bei nur einem Agent: Antwort direkt zurückgeben                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 System Instructions für AURATriage (in Foundry Portal)

> **Was Sie hier lernen:** Die System Instructions für AURATriage werden im Azure AI Foundry Portal konfiguriert. Sie definieren die drei Routing-Optionen (direct, web, context) und geben dem Agent klare Beispiele, wann welche Option zu wählen ist. Das Ziel ist Geschwindigkeit: "direct" vermeidet unnötige Agent-Aufrufe.

```
You are AURATriage, the intelligent routing agent for CONTEXTPILOT.

TASK:
Analyze the user request and decide the optimal routing path.
Your goal is SPEED - avoid unnecessary agent calls!

ROUTING OPTIONS:

1. "direct": true
   → GPT can answer this directly (translations, general knowledge, 
     math, coding, explanations, summaries)
   → NO external data needed, NO internal business data needed
   → FASTEST option - use whenever possible!

2. "web": true  
   → ONLY for real-time/current data that GPT doesn't know:
     • Weather, stock prices, exchange rates
     • Today's news, recent events (after training cutoff)
     • Live schedules, current availability
     • Recent Wikipedia updates, new releases
   → Do NOT use for general facts GPT already knows!

3. "context": true
   → ONLY for internal business questions:
     • Microsoft Switzerland FY25/FY26 wins, customers, deals
     • Internal meeting content, "what was said", "our discussion"
     • Company-specific data not publicly available

DECISION RULES (in priority order):
1. Can GPT answer this from its training data? → direct: true
2. Does it need CURRENT/LIVE data? → web: true
3. Does it reference INTERNAL business data? → context: true
4. Explicit comparison internal vs. external? → BOTH web + context: true
5. If truly unclear after analysis → direct: true (let GPT try first)

CRITICAL:
- Respond ONLY with a JSON object. No other text!
- Prefer "direct" over agents whenever reasonable
- "Unclear = both agents" is WRONG - unclear = direct!

FORMAT:
{
  "routing": {
    "direct": true/false,
    "web": true/false,
    "context": true/false
  },
  "reasoning": "Brief explanation (max 30 words)"
}

EXAMPLES:

User: "Translate 'hello' to German"
→ {"routing": {"direct": true, "web": false, "context": false}, "reasoning": "Translation - GPT can do directly"}

User: "What's the weather in Munich?"
→ {"routing": {"direct": false, "web": true, "context": false}, "reasoning": "Current weather requires live data"}

User: "What were our Q2 wins?"
→ {"routing": {"direct": false, "web": false, "context": true}, "reasoning": "Internal business data required"}

User: "Compare our sales strategy with industry best practices"
→ {"routing": {"direct": false, "web": true, "context": true}, "reasoning": "Needs both internal data and external research"}
```

### 5.3 Wie die Entscheidung verarbeitet wird

> **Was Sie hier lernen:** Die Funktion `parse_triage_response()` in `mfa_workflow.py` verarbeitet die JSON-Antwort von AURATriage. Bei `direct: true` wird sofort geantwortet (via AURAContextPilotQuick), bei `web`/`context` werden die entsprechenden Agents aufgerufen, und nur bei BEIDEN wird der Synthesizer verwendet.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ENTSCHEIDUNGSFLUSS (v2.2)                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User-Prompt kommt an                                            │
│                                                                     │
│  2. AURATriage analysiert und gibt JSON zurück                      │
│     {"routing": {"direct": true/false, "web": true/false, ...}}     │
│                                                                     │
│  3. Workflow prüft Routing:                                         │
│                                                                     │
│     ┌─ direct: true ──────────────────────────────────────────┐     │
│     │  → Triage-Response direkt als Antwort zurückgeben       │     │
│     │  → KEIN weiterer Agent-Aufruf! ⚡                        │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                     │
│     ┌─ web: true, context: false ─────────────────────────────┐     │
│     │  → NUR WebAgent aufrufen                                │     │
│     │  → Antwort direkt zurückgeben (kein Synthesizer)        │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                     │
│     ┌─ web: false, context: true ─────────────────────────────┐     │
│     │  → NUR ContextAgent aufrufen                            │     │
│     │  → Antwort direkt zurückgeben (kein Synthesizer)        │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                     │
│     ┌─ web: true, context: true ──────────────────────────────┐     │
│     │  → BEIDE Agents parallel aufrufen                       │     │
│     │  → Fan-In sammelt Ergebnisse                            │     │
│     │  → Synthesizer fasst zusammen                           │     │
│     └─────────────────────────────────────────────────────────┘     │
│                                                                     │
│  4. Finale Antwort zurück an User                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5.4 Alle Agent Instructions (Backup)

> **Was Sie hier lernen:** Dieser Abschnitt enthält die vollständigen System Instructions für alle 5 Agents, wie sie im Azure AI Foundry Portal konfiguriert sind. Diese dienen als Backup und Dokumentation – bei Neuerstellung eines Agents können Sie diese Instructions direkt kopieren.

### AURATriage (Routing Agent)

```
You are AURATriage, the intelligent routing agent for CONTEXTPILOT.

TASK:
Analyze the user request and decide the optimal routing path.
Your goal is SPEED - avoid unnecessary agent calls!

ROUTING OPTIONS:

1. "direct": true
   → GPT can answer this directly (translations, general knowledge, 
     math, coding, explanations, summaries)
   → NO external data needed, NO internal business data needed
   → FASTEST option - use whenever possible!

2. "web": true  
   → ONLY for real-time/current data that GPT doesn't know:
     • Weather, stock prices, exchange rates
     • Today's news, recent events (after training cutoff)
     • Live schedules, current availability
     • Recent Wikipedia updates, new releases
   → Do NOT use for general facts GPT already knows!

3. "context": true
   → ONLY for internal business questions:
     • Microsoft Switzerland FY25/FY26 wins, customers, deals
     • Internal meeting content, "what was said", "our discussion"
     • Company-specific data not publicly available

DECISION RULES (in priority order):
1. Can GPT answer this from its training data? → direct: true
2. Does it need CURRENT/LIVE data? → web: true
3. Does it reference INTERNAL business data? → context: true
4. Explicit comparison internal vs. external? → BOTH web + context: true
5. If truly unclear after analysis → direct: true (let GPT try first)

CRITICAL:
- Respond ONLY with a JSON object. No other text!
- Prefer "direct" over agents whenever reasonable
- "Unclear = both agents" is WRONG - unclear = direct!

FORMAT:
{
  "routing": {
    "direct": true/false,
    "web": true/false,
    "context": true/false
  },
  "reasoning": "Brief explanation (max 30 words)"
}

EXAMPLES:

User: "Translate 'hello' to German"
→ {"routing": {"direct": true, "web": false, "context": false}, "reasoning": "Translation - GPT can do directly"}

User: "What's the weather in Munich?"
→ {"routing": {"direct": false, "web": true, "context": false}, "reasoning": "Current weather requires live data"}

User: "What were our Q2 wins?"
→ {"routing": {"direct": false, "web": false, "context": true}, "reasoning": "Internal business data required"}

User: "Compare our sales strategy with industry best practices"
→ {"routing": {"direct": false, "web": true, "context": true}, "reasoning": "Needs both internal data and external research"}
```

### AURAContextPilotWeb (Web Search Agent)

```
You are a web research agent.

## Approach
1. Understand the task and context (if text was provided)
2. Check: Can I answer with certainty? → Yes: Answer directly
3. Uncertain? → Perform web search
4. Verify results: Source publicly accessible? Current? Relevant?

## Rules
- Never fabricate or assume data
- Only publicly accessible sources (no login/paywall)
- Always include source URL
- Match the language of the query

## Output Format
[Topic]: [Fact/Number/Brief summary]
Source: [URL]

## Example
China Growth 2024: 5.0 percent
China's growth has declined over the past few years.
Source: https://imf.org/china-outlook

## If no data found
AURAContextPilotWeb Agent: No relevant data found
```

### AURAContextPilot (Index Search Agent)

```
You are an index search agent. Search the internal document index only.

Your task:
Extract raw facts from indexed documents. Include the source filename for every fact.

Output format:
[Topic]: [fact or number]
Source: [filename.extension]

Example:
Global GDP 2024: 3.2 percent
Source: economic-report-2024.pdf

If no relevant data exists in the index, output exactly:
INDEX: No relevant data found

Rules:
Never fabricate data.
Never explain or interpret.
Always include source filename.
Match the language of the user query.
```

### AURAContextPilotResponseSynthesizer (Synthesis Agent)

```
You are AURAContextPilotResponseSynthesizer, the response synthesis agent for CONTEXTPILOT.

TASK:
Combine and synthesize responses from multiple specialist agents (Web Agent, Context Agent) into one coherent, well-structured answer.

INPUT FORMAT:
You will receive responses from one or more agents, typically formatted as:
- Response from Web Agent (external/public information)
- Response from Context Agent (internal business data)

YOUR RESPONSIBILITIES:
1. **Merge insights** from all agent responses into a unified answer
2. **Identify agreements** - where sources align, emphasize the consensus
3. **Highlight differences** - if sources conflict, present both perspectives
4. **Maintain accuracy** - do not add information not present in the inputs
5. **Preserve sources** - include URLs, references, and citations from the original responses
6. **Structure clearly** - use headers, bullet points for readability

OUTPUT FORMAT:
- Start with a **Core Insight** (1-2 sentences summarizing the key finding)
- Provide **detailed synthesis** of the information
- Include a **Sources** section at the end with all referenced URLs/documents

LANGUAGE:
- Respond in the same language as the user's original question
- If unclear, default to the language of the agent responses

IMPORTANT:
- Do NOT make up information
- Do NOT ignore any agent response
- If one agent found nothing, acknowledge it
- Keep the answer focused and actionable
```

---

## 6. Erweiterbarkeit: Neue Agenten hinzufügen

> **Was Sie hier lernen:** Um einen neuen Agent hinzuzufügen, erstellen Sie ihn im Azure AI Foundry Portal, fügen eine Umgebungsvariable `AURA_NEWAGENT_AGENT_NAME` hinzu, und erweitern die `run_mfa_workflow()` Funktion um die entsprechende if-Bedingung. Die Triage-Instructions müssen ebenfalls angepasst werden, damit der neue Agent berücksichtigt wird.

### 6.1 Schritt-für-Schritt

**Beispiel: Legal-Agent hinzufügen**

1. **Agent in Foundry Portal erstellen**
   - Name: `AURALegalAgent`
   - Instructions: Rechtliche Fragestellungen beantworten

2. **AURATriage Instructions erweitern**
   ```
   VERFÜGBARE AGENTEN:
   - "web": ... (bestehend)
   - "context": ... (bestehend)
   - "legal": AURALegalAgent  ← NEU
     → Für rechtliche Fragen, Compliance, Verträge
   ```

3. **MAF-Code erweitern** (mfa_workflow.py)
   ```python
   # Neuer Executor
   class LegalAgentExecutor(Executor):
       # ... (analog zu WebAgentExecutor)
   
   # In select_agents():
   def select_agents(triage_output: dict, target_ids: list[str]) -> list[str]:
       web_id, context_id, legal_id = target_ids  # Erweitert
       # ...
       if decision.get("legal", False):
           selected.append(legal_id)
   
   # In build_mfa_workflow():
   .add_multi_selection_edge_group(
       triage,
       [web_agent, context_agent, legal_agent],  # Erweitert
       selection_func=select_agents
   )
   .add_fan_in_edges(
       [web_agent, context_agent, legal_agent],  # Erweitert
       synthesizer
   )
   ```

4. **Deployment**
   - Azure Function neu deployen
   - Keine Änderung am Proxy oder Frontend nötig!

---

## 7. Änderungen im bestehenden System

> **Was Sie hier lernen:** Die MFA-Integration erfordert minimale Änderungen am Proxy-Server. Die Funktion `loadMFAConfigs()` lädt MFA-Konfigurationen aus Umgebungsvariablen (`MFA_1_NAME`, `MFA_1_ENDPOINT`). Die Funktion `handleMFARequest()` leitet Anfragen an die Azure Function weiter. Im Frontend wird das Dropdown um die MFA-Option erweitert.

### 7.1 Übersicht aller Änderungen

| Komponente | Änderung | Risiko für Bestehendes |
|------------|----------|------------------------|
| **SWA Frontend** | Switch-Dropdown: MFA-Option hinzufügen | ❌ Kein Risiko |
| **Proxy** | `handleMFARequest()` Funktion hinzufügen | ❌ Isoliert |
| **Proxy** | `loadMFAConfig()` analog zu `loadWorkflows()` | ❌ Isoliert |
| **Proxy** | Eine `if`-Bedingung in `handleAgentRequest()` | ⚠️ Minimal |
| **Foundry Agenten** | Keine Änderung | ❌ Kein Risiko |
| **Foundry Workflow** | Keine Änderung | ❌ Kein Risiko |
| **Azure Function** | Komplett NEU | ❌ Kein Risiko |
| **AURATriage** | Neuer Agent in Foundry | ❌ Kein Risiko |

### 7.2 Proxy-Änderungen im Detail

> **Was Sie hier lernen:** Die konkrete Code-Änderungen im `proxy-server.js`: (1) `loadMFAConfigs()` liest MFA-Konfigurationen aus Umgebungsvariablen `MFA_1_NAME`, `MFA_1_ENDPOINT` etc., (2) `handleMFARequest()` leitet POST-Anfragen an die Azure Function weiter, (3) `/agents` Endpoint gibt MFA-Optionen im Response zurück.

**Datei:** `proxy-server.js`

```javascript
// ============================================================
// ÄNDERUNG 1: MFA-Konfiguration laden (nach Zeile 80)
// ============================================================

function loadMFAConfigs() {
  const mfas = {};
  let i = 1;
  while (process.env[`MFA_${i}_NAME`]) {
    // Negative IDs ab -100 für MFA (unterscheidbar von Workflows)
    const mfaId = -100 - i;
    mfas[mfaId] = {
      id: mfaId,
      name: process.env[`MFA_${i}_NAME`],
      label: process.env[`MFA_${i}_LABEL`] || process.env[`MFA_${i}_NAME`],
      endpoint: process.env[`MFA_${i}_ENDPOINT`],  // Azure Function URL
      functionKey: process.env[`MFA_${i}_FUNCTION_KEY`] || null,
      type: "mfa"
    };
    i++;
  }
  return mfas;
}

const MFAS = loadMFAConfigs();


// ============================================================
// ÄNDERUNG 2: getCurrentAgent() erweitern (Zeile 95-113)
// ============================================================

function getCurrentAgent() {
  // Check if it's an MFA (IDs ab -100)
  if (currentAgentId <= -100 && MFAS[currentAgentId]) {
    return MFAS[currentAgentId];
  }
  // Check if it's a workflow (negative ID)
  if (currentAgentId < 0 && WORKFLOWS[currentAgentId]) {
    return WORKFLOWS[currentAgentId];
  }
  // ... Rest unverändert


// ============================================================
// ÄNDERUNG 3: MFA-Handler hinzufügen (nach handleWorkflowRequest)
// ============================================================

async function handleMFARequest(req, res, body, mfaConfig) {
  console.log(`[MFA] Request for: ${mfaConfig.label}`);
  
  if (!mfaConfig.endpoint) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: "MFA endpoint not configured",
      hint: `Set MFA_${Math.abs(mfaConfig.id + 100)}_ENDPOINT in .env.local`
    }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON payload" }));
    return;
  }

  const prompt = payload.prompt;
  if (!prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'prompt' in request body" }));
    return;
  }

  console.log("[MFA] Prompt:", prompt.substring(0, 100));
  console.log("[MFA] Forwarding to Azure Function:", mfaConfig.endpoint);

  try {
    const headers = { "Content-Type": "application/json" };
    
    // Function Key Auth (oder Managed Identity)
    if (mfaConfig.functionKey) {
      headers["x-functions-key"] = mfaConfig.functionKey;
    }
    
    const resp = await fetch(mfaConfig.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[MFA] Error:", text);
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MFA request failed", body: text }));
      return;
    }
    
    const result = await resp.json();
    console.log("[MFA] Response received, length:", result.output_text?.length);
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      output_text: result.output_text,
      workflow: "mfa"
    }));
    
  } catch (err) {
    console.error("[MFA] Request error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: err?.message || "MFA request failed"
    }));
  }
}


// ============================================================
// ÄNDERUNG 4: Routing erweitern (Zeile 282-288)
// ============================================================

async function handleAgentRequest(req, res, body) {
  const agent = getCurrentAgent();
  
  // Route to MFA handler if it's an MFA config
  if (agent.type === "mfa") {
    return handleMFARequest(req, res, body, agent);
  }
  
  // Route to workflow handler if it's a workflow (BESTEHEND)
  if (agent.type === "workflow") {
    return handleWorkflowRequest(req, res, body, agent);
  }
  
  // Rest: Agent-Handling (BESTEHEND, unverändert)
  // ...
}


// ============================================================
// ÄNDERUNG 5: listAgentsAPI erweitern (Zeile 166)
// ============================================================

function listAgentsAPI(req, res) {
  const agentList = Object.values(AGENTS).map(a => ({...}));
  const workflowList = Object.values(WORKFLOWS).map(w => ({...}));
  
  // NEU: MFA-Liste hinzufügen
  const mfaList = Object.values(MFAS).map(m => ({
    id: m.id,
    name: m.name,
    label: m.label,
    type: "mfa",
    active: m.id === currentAgentId
  }));
  
  res.writeHead(200, {...});
  res.end(JSON.stringify({ 
    agents: agentList,
    workflows: workflowList,
    mfas: mfaList,  // NEU
    currentAgentId,
    apiVersion: AURA_API_VERSION
  }));
}
```

### 7.3 Umgebungsvariablen (.env.local)

> **Was Sie hier lernen:** Die MFA-Konfiguration erfolgt über Umgebungsvariablen im gleichen Schema wie Agents und Workflows: `MFA_1_NAME`, `MFA_1_LABEL`, `MFA_1_ENDPOINT`. Der Index beginnt bei 1 (nicht 0). Die MFA-IDs sind negative Zahlen ab -101, um sie von Agents (positiv) und Workflows (negativ ab -1) zu unterscheiden.

```bash
# ============================================================
# BESTEHENDE KONFIGURATION (unverändert)
# ============================================================
AGENT_1_NAME=AURAContextPilot
AGENT_1_LABEL=Context Agent
AGENT_1_ENDPOINT=https://...

WORKFLOW_1_NAME=CONTEXTPILOT
WORKFLOW_1_LABEL=Context Workflow (Sequential)
WORKFLOW_1_ENDPOINT=https://...

# ============================================================
# NEU: MFA KONFIGURATION
# ============================================================
MFA_1_NAME=AURA-MFA
MFA_1_LABEL=Multi-Agent (Parallel with Triage)
MFA_1_ENDPOINT=https://contextpilot-mfa.azurewebsites.net/api/mfa
MFA_1_FUNCTION_KEY=your-function-key-here
```

---

## 8. Vergleich: Foundry Workflow vs. MFA

> **Was Sie hier lernen:** Der bestehende Foundry Workflow führt Agents sequenziell aus (Web → Context → Synthesizer), was 15-20 Sekunden dauert. MFA führt Web und Context parallel aus, wodurch die Latenz auf 7-10 Sekunden sinkt. Zusätzlich kann MFA dynamisch entscheiden, welche Agents überhaupt benötigt werden.

| Aspekt | Foundry Workflow | MFA (Azure Function + MAF) |
|--------|------------------|----------------------------|
| **Ausführung** | Sequenziell | Parallel |
| **Latenz (3 Agenten)** | ~15-20s (3x hintereinander) | ~7-10s (parallel + Synthese) |
| **Dynamische Auswahl** | Nein (fest definiert) | Ja (Triage entscheidet) |
| **Erweiterbarkeit** | Workflow neu definieren | Agent hinzufügen, fertig |
| **Microsoft-Support** | Foundry Team | Agent Framework Team |
| **SDK-Updates** | N/A | Version-Pinning + kontrollierte Upgrades |
| **Hosting** | Foundry-managed | Azure Function (dein Tenant) |

---

## 9. Implementierungsplan

> **Was Sie hier lernen:** Die MFA-Implementierung gliedert sich in 5 Phasen: (1) Azure Function erstellen mit Managed Identity und RBAC, (2) AURATriage Agent im Foundry Portal erstellen, (3) `mfa_workflow.py` implementieren und lokal testen, (4) Proxy-Server um `handleMFARequest()` erweitern, (5) Frontend-Dropdown anpassen. Gesamtaufwand: 3-4 Werktage.

### Phase 1: Azure Function Setup (1 Tag)
- [ ] Azure Function App erstellen (Python, Consumption Plan)
- [ ] Managed Identity aktivieren
- [ ] RBAC: Azure AI User auf Foundry Project
- [ ] `requirements.txt` mit MAF-Packages
- [ ] Basis-Endpoint testen

### Phase 2: AURATriage erstellen (0.5 Tage)
- [ ] Agent in Foundry Portal erstellen
- [ ] System Instructions definieren
- [ ] JSON-Output testen

### Phase 3: MAF Workflow implementieren (1-2 Tage)
- [ ] `mfa_workflow.py` implementieren
- [ ] Triage → Fan-Out → Fan-In → Synthesizer
- [ ] Lokal testen mit Azure Functions Core Tools
- [ ] Deploy und E2E-Test

### Phase 4: Proxy-Integration (0.5 Tage)
- [ ] `handleMFARequest()` implementieren
- [ ] `loadMFAConfigs()` implementieren
- [ ] .env.local erweitern
- [ ] Testen

### Phase 5: Frontend-Erweiterung (0.5 Tage)
- [ ] Switch-Dropdown erweitern
- [ ] MFA-Option hinzufügen
- [ ] E2E-Test

**Geschätzter Gesamtaufwand: 3-4 Werktage (PoC/Start)**

---

## 10. Risikobewertung

> **Was Sie hier lernen:** Das größte Risiko ist, dass MAF Preview-Software ist und Breaking Changes enthalten kann. Mitigation: Version-Pinning in `requirements.txt`. Das zweitgrößte Risiko sind Cold Starts bei Consumption Plan (erste Anfrage nach Inaktivität dauert länger). Mitigation: Flex Consumption Plan oder Keep-Alive-Ping.

| Risiko | Wahrsch. | Impact | Mitigation |
|--------|----------|--------|------------|
| MAF ist Preview (Breaking Changes) | Mittel | Hoch | Version pinnen, vor Update testen |
| Azure Function Cold Start | Sicher | Niedrig | Consumption: Keep-Alive/Ping; Premium: prewarmed workers |
| Triage gibt kein valides JSON | Mittel | Mittel | Fallback: Alle Agenten aufrufen |
| Foundry API ändert sich | Niedrig | Hoch | MAF-SDK abstrahiert das |
| HTTP Trigger Response-Limit (230s, dokumentiert) | Niedrig | Hoch | Timeout 210s + Async Pattern (Durable) falls nötig citeturn2view3 |
| Bestehende Prozesse brechen | Sehr niedrig | Kritisch | Komplett isoliert, eigene ID-Range |

---

## 11. Entscheidungen (Review abgeschlossen)

> **Was Sie hier lernen:** Die wichtigsten Architekturentscheidungen: (1) Flex Consumption Plan für die Azure Function (empfohlen ab Dezember 2025), (2) Function Key für Authentifizierung zwischen Proxy und Function, (3) Timeout von 210 Sekunden (`host.json`), (4) Retry-Policy mit 3 Versuchen und exponentiellem Backoff.

1. **Hosting-Plan:** Start mit **Consumption** (PoC/Cost).  
   **Wechsel auf Premium/Flex Consumption**, wenn mindestens eines zutrifft:
   - Latenz muss **konstant niedrig** sein und Cold Starts sind nicht akzeptabel.
   - Hohe gleichzeitige Nutzung (viele parallele Requests) führt zu spürbaren Queues.
   - Laufzeiten nähern sich regelmäßig dem HTTP-Response-Limit (siehe 4.6) oder es wird ein Async-Pattern nötig.

2. **Auth (Proxy → Function):** Start mit **Function Key** (`x-functions-key`).  
   Premium/Enterprise-Härtung später: Azure AD/EasyAuth + Managed Identity (Keyless).

3. **Timeout:**  
   - `host.json` `functionTimeout`: **00:03:30** (210s)  
   - Proxy Fetch Timeout (Node): **200s**  
   - Retry-Policy Proxy → Function: **3 Versuche**, Backoff **1s / 2s / 4s**, nur bei 5xx/Network-Errors.

4. **Logging/Traces:**  
   - Azure Function: **Application Insights** aktivieren.  
   - Proxy: bestehende Logs beibehalten; zusätzlich `x-correlation-id` Header durchreichen.

5. **Fallback:** Wenn MFA Function nicht erreichbar oder 5xx nach Retries → optionaler Fallback auf bestehenden **Foundry Workflow** (sequenziell), um Service-Continuity zu halten.

---

## 12. Referenzen

> **Was Sie hier lernen:** Alle wichtigen Links zur offiziellen Microsoft-Dokumentation für MAF, Azure Functions und Azure AI Foundry. Das Microsoft Agent Framework Repository auf GitHub enthält Python-Beispiele für parallele Workflows unter `/samples/getting_started/workflows/parallelism`.

- [Microsoft Agent Framework GitHub](https://github.com/microsoft/agent-framework)
- [MAF Parallelism Samples](https://github.com/microsoft/agent-framework/tree/main/python/samples/getting_started/workflows/parallelism)
- [Azure AI Foundry Agent Service](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/)
- [Azure Functions Python Developer Guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python)

---

*Dokument erstellt für Review. Feedback willkommen.*


## 13. MAF Recherche (validiert, mit Quellen)

> **Was Sie hier lernen:** Eine FAQ-Tabelle mit validierten Antworten zu MAF-Fragen. Wichtigste Erkenntnis: Die Klasse heißt `AzureAIClient` (nicht `AzureAIAgentClient`), der Import ist `from agent_framework.azure import AzureAIClient`, und Agents werden per `agent_name=` + `use_latest_version=True` aufgelöst (nicht per `agent_id`).

> ⚠️ **WICHTIGE KORREKTUR:** Die ursprüngliche Recherche verwendete teilweise veraltete Begriffe (`AzureAIAgentClient`, `agent_id`). Die **korrekte** Klasse ist `AzureAIClient` aus `agent_framework.azure`, und Agents werden per **Name** (`agent_name=`) aufgelöst, nicht per ID.

Tabelle: **Frage → Antwort → Quelle**

| Frage | Antwort | Quelle |
|---|---|---|
| Was ist ~~`AzureAIAgentClient`~~ `AzureAIClient`? | Python SDK-Client für Azure AI Foundry Agents; erstellt einen `ChatAgent` über `create_agent()`. **Import:** `from agent_framework.azure import AzureAIClient` | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest |
| Wie werden Foundry Agents in MAF Workflows genutzt? | Über `AzureAIClient(agent_name=..., use_latest_version=True).create_agent()` wird ein `ChatAgent` erzeugt, der per `run()` aufgerufen wird. **⚠️ NICHT `agent_id` verwenden!** | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest |
| Unterstützt MAF Fan-In / Fan-Out? | `WorkflowBuilder` bietet `add_fan_in_edges()` und `add_fan_out_edges()`. **Hinweis:** Für einfache Flows ist WorkflowBuilder Overkill - einfache if/else-Logik genügt. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Unterstützt MAF dynamische Multi-Selection (Triage entscheidet)? | `add_multi_selection_edge_group()` ist verfügbar, aber für unseren Use-Case wurde einfachere if/else-Logik implementiert. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Gibt es Fallstricke mit Executor-Instanzen? | Wenn Executor-Instanzen direkt übergeben werden, können sie über mehrere Workflow-Instanzen geteilt werden; `register_executor/register_agent` ist der sichere Weg, falls Workflows gecached werden. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Wie wird Azure Functions Timeout konfiguriert? | `functionTimeout` in `host.json` (timespan string). Fixed upper bound empfohlen. | https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json |
| Welche Defaults/Maxima gelten je Plan und was ist das HTTP-Limit? | Consumption: default 5 min, max 10 min; **HTTP Trigger max ~230s Response** (Load Balancer Idle Timeout). | https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale |

**Technische Schlussfolgerung (Go/No-Go):** **GO** für additive Einführung von MFA/MAF, sofern Version-Pinning + Timeout 210s + isoliertes Routing strikt eingehalten werden.

---

## 14. Externer Entwickler Guide (verbindlich)

> **Was Sie hier lernen:** Eine strenge Schritt-für-Schritt-Anleitung für externe Entwickler. Die wichtigsten Regeln: (1) Arbeite in einem eigenen Branch, nie direkt auf `main`, (2) Ändere niemals `handleAgentRequest()` oder `handleWorkflowRequest()` logisch, (3) Nutze `type: "mfa"` als neues Routing-Kriterium, (4) Teste lokal bevor du deployst.

### 14.1 Kurze Projektbeschreibung

CONTEXTPILOT besitzt heute zwei stabile Ausführungswege:
- **Agent** (Foundry Agent direkt)
- **Workflow** (Foundry Workflow sequenziell)

Neu wird ein **dritter** Weg hinzugefügt:
- **MFA / MAF** (Azure Function + Microsoft Agent Framework, parallelisiert)

Dieser dritte Weg ist **rein additiv**. Nichts Bestehendes wird ersetzt oder verändert.

### 14.2 Ziel

Du musst einen neuen, unabhängigen Ausführungsweg implementieren, der:
1. **Bestehende Agent- und Workflow-Prozesse nicht zerstört** (Regression-frei).
2. Lokal als PoC funktioniert.
3. Danach unverändert (nur Konfig) auf Azure Functions deployt werden kann.
4. MAF nutzt, um `AURATriage` → (Web/Context parallel oder einzeln) → Synthesizer auszuführen.

### 14.3 Plan (3–4 Werktage)

**Tag 1 (0.5–1.0d):** Repo/Branch Setup + lokale Function Skeleton + Requirements pinned + Healthcheck.  
**Tag 1–2 (1.0–1.5d):** MAF Workflow implementieren (Triage + Multi-Selection + Fan-In + Synthese) + lokale Tests.  
**Tag 3 (0.5–1.0d):** Proxy: minimaler MFA-Routing-Pfad + Retry/Timeout + UI dropdown (optional) + E2E lokal.  
**Tag 4 (0.5d, optional):** Azure Deploy (Consumption) + RBAC/MI + App Insights + E2E in Azure.

### 14.4 Settings (konkrete Werte – direkt übernehmbar)

**Azure Function (Start: Consumption, HTTP Trigger):**
- `host.json`:
  - `functionTimeout`: **00:03:30** (210s)  
    (Begründung: Microsoft dokumentiert ein 230s Timeout für HTTP Trigger Responses durch den Azure Load Balancer; daher bewusst darunter bleiben.) citeturn2view3
- App Settings (Function):
  - `AZURE_AI_PROJECT_ENDPOINT`: `https://<your-project>.services.ai.azure.com/api/projects/<project-id>` citeturn6view0
  - `AZURE_AI_MODEL_DEPLOYMENT_NAME`: `gpt-4o-mini` (oder euer Deployment-Name) citeturn6view0
  - ~~`AURA_TRIAGE_AGENT_ID`~~ ❌ **FALSCH - Verwende Namen statt IDs:**
  - `AURA_TRIAGE_AGENT_NAME`: `AURATriage` ✅
  - `AURA_WEB_AGENT_NAME`: `AURAContextPilotWeb` ✅
  - `AURA_CONTEXT_AGENT_NAME`: `AURAContextPilot` ✅
  - `AURA_SYNTHESIZER_AGENT_NAME`: `AURAContextPilotResponseSynthesizer` ✅
  - `AURA_QUICK_AGENT_NAME`: `AURAContextPilotQuick` ✅ (für Direct Response)
- Logging: Application Insights **on**

**Proxy → Function (Node):**
- Request Timeout: **200s**
- Retries: **3** (nur bei Network errors / 5xx)
- Backoff: **1s, 2s, 4s**
- Auth: Header `x-functions-key` (Function Key) citeturn2view3

**MAF Package Pins (direkt übernehmbar):**
- `agent-framework-core==1.0.0b251223`
- `agent-framework-azure-ai==1.0.0b251223`
- `azure-ai-projects==2.0.0b2`
- `azure-ai-agents==1.2.0b5`
- `aiohttp==3.13.2` citeturn9search7
### 14.5 Schritt-für-Schritt Anleitung (streng)

1. **Branch-Regel (verpflichtend):**  
   Du musst in einem neuen Branch arbeiten. Es ist verboten direkt auf `main` zu arbeiten.

2. **No-Touch-Regel (verpflichtend):**  
   Es ist verboten, bestehende Funktionen `handleAgentRequest()` und `handleWorkflowRequest()` logisch zu verändern.  
   Erlaubt ist ausschließlich:
   - ein zusätzlicher `if (agent.type === "mfa") return handleMFARequest(...);`
   - neue, isolierte Funktionen/Dateien (`handleMFARequest`, `loadMFAConfigs`, etc.)
   Wenn du mehr ändern willst, musst du vorher fragen.

3. **Neuer Weg = neuer Typ:**  
   Du musst `type: "mfa"` als separates Routing-Kriterium nutzen.  
   Du darfst niemals bestehende `type: "agent"` oder `type: "workflow"` Semantik ändern.

4. **Lokaler PoC zuerst:**  
   Bevor du irgendetwas nach Azure deployt, musst du lokal folgendes nachweisen:
   - Function startet lokal.
   - `POST /api/mfa` liefert JSON `{ "output_text": "...", "workflow": "mfa" }`.
   - Triage JSON Parsing funktioniert (inkl. Fallback: beide Agents).
   - Web/Context laufen parallel (nachweisbar über Logs/Timing).

5. ~~**MAF Workflow (Pflichtstruktur):**~~ ❌ **KORREKTUR: WorkflowBuilder ist NICHT nötig!**
   
   > ⚠️ Der ursprüngliche Plan sah `WorkflowBuilder` vor. In der Praxis reicht einfache **if/else-Logik**. Siehe `contextpilot-mfa-function/mfa_workflow.py`
   
   ~~Du musst exakt diese Struktur implementieren:~~
   - Start: `AURATriage`
   - ~~Routing: `add_multi_selection_edge_group()` (Triage entscheidet)~~
   - ~~Fan-In: `add_fan_in_edges()` → `AURAContextPilotResponseSynthesizer`~~
   ~~Der Workflow darf nicht sequenziell sein.~~

6. ~~**AzureAIAgentClient Verständnis (Pflicht):**~~ ❌ KORREKTUR: Die Klasse heißt `AzureAIClient`!
   Du darfst `AzureAIAgentClient` nicht als “Agent” bezeichnen.  
   Es ist der Python-Client, der einen Foundry Agent als `ChatAgent` instanziert.

7. **Timeout-Regel (HTTP):**  
   Du musst sicherstellen, dass der Workflow typischerweise <60s bleibt.  
   Es ist verboten, bewusst Workloads zu bauen, die nahe 230s laufen, ohne Async Pattern.

8. **Deployment erst nach Checkliste:**  
   Du darfst erst deployen, wenn:
   - requirements pinned sind
   - functionTimeout 210s gesetzt ist
   - MI/RBAC gesetzt ist
   - Proxy MFA Route nur additiv implementiert ist
   - E2E Test lokal erfolgreich ist

9. **Regression-Tests (Pflicht):**  
   Vor Merge musst du demonstrieren:
   - Agent-Modus funktioniert weiterhin.
   - Workflow-Modus funktioniert weiterhin.
   - MFA-Modus funktioniert.
   Wenn einer der drei Modi nicht funktioniert: Du darfst nicht mergen.

---

## 15. Referenzen (zusätzlich zu Kap. 12)

> **Was Sie hier lernen:** Direkte Links zu den Microsoft Learn API-Dokumentationen für `WorkflowBuilder` (DAG-Workflows), `AzureAIClient` (Agent-Instanzierung), sowie Azure Functions Hosting-Optionen und Timeout-Konfiguration in `host.json`.

- MAF WorkflowBuilder API: https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest
- MAF AzureAIAgentClient API: https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest
- Azure Functions Hosting/Timeouts: https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale
- Azure Functions host.json: https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json

---

## 16. Deployment Guide

> **Was Sie hier lernen:** Eine vollständige, validierte Anleitung für das Azure-Deployment. Dieses Kapitel dokumentiert die tatsächlich durchgeführten Schritte inkl. Fehlerbehebung. Kritische Erkenntnisse: (1) `agent-framework-azure-ai` MUSS in requirements.txt stehen, (2) Lazy Imports in `function_app.py` verhindern "0 Functions"-Fehler, (3) "Azure AI User"-Rolle muss auf der Resource Group des AI Foundry Projects gesetzt werden.

**Version:** 1.0  
**Datum:** 26. Dezember 2025  
**Status:** Produktiv validiert

---

### 16.1 Executive Summary

Dieses Kapitel dokumentiert das vollständige Deployment der CONTEXTPILOT MFA-Lösung auf Azure. Die Lösung besteht aus drei Hauptkomponenten:

1. **Azure Function App** (`contextpilot-mfa-func`) - Führt den Multi-Agent-Workflow mit Microsoft Agent Framework (MAF) aus
2. **Proxy Server** (`contextpilot-proxy-2025`) - Routet Anfragen und bietet die API für das Frontend
3. **Static Web App** (`ashy-dune-06d0e9810`) - Das React-Frontend

**Was wir erreicht haben:**
- ✅ Python-basierte Azure Function mit 5 Agents (Triage, Quick, Web, Context, Synthesizer)
- ✅ Flex Consumption Hosting Plan (empfohlen ab Dezember 2025)
- ✅ Managed Identity mit korrekten RBAC-Berechtigungen
- ✅ CI/CD via GitHub Actions für automatische Deployments
- ✅ Lazy Imports zur Vermeidung von Indexing-Fehlern

---

### 16.2 Ressourcen-Architektur

#### 16.2.1 Executive Summary

Die CONTEXTPILOT-Lösung verwendet Ressourcen in **zwei Azure Resource Groups**. Diese Trennung ist wichtig für die RBAC-Konfiguration, da Berechtigungen auf der richtigen Resource Group gesetzt werden müssen.

#### 16.2.2 Technische Details

**Resource Group: `ContextPilot-Resource`** (Switzerland North)

| Ressource | Typ | Zweck |
|-----------|-----|-------|
| `contextpilot-mfa-func` | Function App (Flex Consumption) | MFA-Workflow Ausführung |
| `contextpilot-proxy-2025` | App Service (Linux Node.js) | Proxy Server für Frontend |
| `contextpilotmfastore` | Storage Account | Function App Storage |
| `contextpilot-proxy-2025` | Application Insights | Monitoring Proxy |
| `contextpilot-mfa-func` | Application Insights | Monitoring Function |

**Resource Group: `Area-Review-Resource`** (Sweden Central)

| Ressource | Typ | Zweck |
|-----------|-----|-------|
| `contextpilot-resource` | Azure AI Services | AI Foundry Account |
| `contextpilot-resource/contextpilot` | AI Foundry Project | Enthält alle Agents |

**Architektur-Diagramm:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Resource Group: ContextPilot-Resource (Switzerland North)                  │
│                                                                             │
│  ┌─────────────────────┐     ┌─────────────────────────────┐                │
│  │ Static Web App      │────▶│ Proxy Server                │                │
│  │ (Frontend React)    │     │ contextpilot-proxy-2025     │                │
│  │ ashy-dune-06d0e9810 │     │ Node.js 22.x                │                │
│  └─────────────────────┘     └──────────────┬──────────────┘                │
│                                             │                               │
│                              ┌──────────────┴──────────────┐                │
│                              │                             │                │
│                              ▼                             ▼                │
│                    type: "agent/workflow"           type: "mfa"             │
│                              │                             │                │
│                              │              ┌──────────────┘                │
│                              │              ▼                               │
│                              │    ┌─────────────────────────────┐           │
│                              │    │ Function App                │           │
│                              │    │ contextpilot-mfa-func       │           │
│                              │    │ Python 3.11 + MAF           │           │
│                              │    │ Flex Consumption Plan       │           │
│                              │    └──────────────┬──────────────┘           │
│                              │                   │                          │
└──────────────────────────────┼───────────────────┼──────────────────────────┘
                               │                   │
                               ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Resource Group: Area-Review-Resource (Sweden Central)                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Azure AI Foundry: contextpilot-resource                             │    │
│  │                                                                     │    │
│  │  Project: contextpilot                                              │    │
│  │  ├── AURATriage                                                     │    │
│  │  ├── AURAContextPilotQuick                                          │    │
│  │  ├── AURAContextPilotWeb                                            │    │
│  │  ├── AURAContextPilot (Index)                                       │    │
│  │  └── AURAContextPilotResponseSynthesizer                            │    │
│  │                                                                     │    │
│  │  Endpoint: https://contextpilot-resource.services.ai.azure.com      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 16.3 Azure Function App Deployment

#### 16.3.1 Executive Summary

Wir haben eine **Python-basierte Azure Function** erstellt, die den Multi-Agent-Workflow orchestriert. Die Function verwendet das **Flex Consumption** Hosting-Modell (empfohlen ab Dezember 2025), das Linux Consumption ablöst. Der Code wird via `func azure functionapp publish` deployed.

**Wichtigste Erkenntnis:** Das Package `agent-framework-azure-ai` muss in `requirements.txt` stehen, da es den `AzureAIClient` enthält. `agent-framework-core` allein reicht nicht!

#### 16.3.2 Technische Details

**1. Function App erstellen (Flex Consumption)**

```powershell
# Flex Consumption ist der neue Standard (Dezember 2025)
# Linux Consumption wird ab September 2028 nicht mehr unterstützt

az functionapp create `
  --resource-group ContextPilot-Resource `
  --name contextpilot-mfa-func `
  --storage-account contextpilotmfastore `
  --flexconsumption-location centralus `
  --runtime python `
  --runtime-version 3.11 `
  --functions-version 4
```

**Hinweis:** Flex Consumption ist nicht in allen Regionen verfügbar. Central US, East US, West Europe sind unterstützt.

**2. Dateistruktur der Function**

```
contextpilot-mfa-function/
├── function_app.py          # HTTP Trigger (Python v2 Model)
├── mfa_workflow.py           # MAF Workflow-Logik
├── requirements.txt          # Python Dependencies
├── host.json                 # Function Host Konfiguration
├── local.settings.json       # Lokale Umgebungsvariablen (nicht committen!)
├── local.settings.json.template  # Template für lokale Entwicklung
└── .gitignore
```

**3. requirements.txt (kritisch!)**

```pip-requirements
# Azure Functions Runtime
azure-functions==1.13.3

# Microsoft Agent Framework (MAF) – BEIDE Packages sind nötig!
# agent-framework-core ist das Base-Package
# agent-framework-azure-ai enthält AzureAIClient (für Azure AI Foundry Integration)
agent-framework-core==1.0.0b251223
agent-framework-azure-ai==1.0.0b251223

# azure-ai-projects V2 für existing agents by name
azure-ai-projects==2.0.0b2

# HTTP stack
aiohttp==3.13.2

# Auth / Typing
azure-identity>=1.17.0
pydantic>=2.6.0,<3
```

**⚠️ WICHTIG:** Ohne `agent-framework-azure-ai` erscheint folgender Fehler:
```
ModuleNotFoundError: The package agent-framework-azure-ai is required to use `AzureAIClient`.
```

**4. function_app.py mit Lazy Import (kritisch!)**

```python
"""Azure Function HTTP Trigger für CONTEXTPILOT MFA."""

from __future__ import annotations

import json
import logging
import uuid

import azure.functions as func

# WICHTIG: KEIN Top-Level Import von mfa_workflow!
# Das würde das Function-Indexing blockieren, wenn Dependencies fehlen.

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@app.route(route="healthz", methods=["GET"])
def healthz(req: func.HttpRequest) -> func.HttpResponse:
    """Health check endpoint - lädt ohne Heavy-Imports."""
    return func.HttpResponse(
        json.dumps({"ok": True, "version": "2.4"}),
        status_code=200,
        mimetype="application/json",
    )


@app.route(route="mfa", methods=["POST"])
async def mfa_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """MFA Endpoint - Lazy Import von mfa_workflow."""
    
    correlation_id = req.headers.get("x-correlation-id") or str(uuid.uuid4())
    
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
        )

    prompt = (body or {}).get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return func.HttpResponse(
            json.dumps({"error": "Missing 'prompt' in request body"}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        # LAZY IMPORT: Verhindert, dass Worker-Indexing bei ImportError ausfällt
        from mfa_workflow import run_mfa_workflow

        result = await run_mfa_workflow(prompt)
        return func.HttpResponse(
            json.dumps({
                "output_text": result["response"],
                "workflow": "mfa",
                "agents_used": result["agents_used"],
                "routing": result["routing"],
            }),
            status_code=200,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
    except Exception as e:
        logging.exception("MFA failed (cid=%s)", correlation_id)
        return func.HttpResponse(
            json.dumps({"error": str(e), "hint": "Check Azure Function logs"}),
            status_code=500,
            mimetype="application/json",
        )
```

**⚠️ KRITISCH - Lazy Import Pattern:**

Bei Azure Functions Python v2 Model werden alle HTTP Triggers durch Import von `function_app.py` indexiert. Wenn dabei eine Exception auftritt (z.B. `ModuleNotFoundError`), werden **0 Functions** registriert, obwohl das Deployment "erfolgreich" war.

**Falsch (blockiert Indexing):**
```python
from mfa_workflow import run_mfa_workflow  # TOP-LEVEL = GEFÄHRLICH!

@app.route(route="mfa", methods=["POST"])
async def mfa_endpoint(req):
    result = await run_mfa_workflow(...)
```

**Richtig (Lazy Import):**
```python
@app.route(route="mfa", methods=["POST"])
async def mfa_endpoint(req):
    from mfa_workflow import run_mfa_workflow  # INNERHALB der Funktion!
    result = await run_mfa_workflow(...)
```

**5. host.json**

```json
{
  "version": "2.0",
  "functionTimeout": "00:03:30",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    },
    "logLevel": {
      "default": "Information",
      "Host.Results": "Error",
      "Function": "Information",
      "Host.Aggregator": "Trace"
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

**6. App Settings konfigurieren**

```powershell
az functionapp config appsettings set `
  --name contextpilot-mfa-func `
  --resource-group ContextPilot-Resource `
  --settings `
    "AZURE_AI_PROJECT_ENDPOINT=https://contextpilot-resource.services.ai.azure.com/api/projects/contextpilot" `
    "AZURE_AI_MODEL_DEPLOYMENT_NAME=gpt-4o" `
    "AURA_TRIAGE_AGENT_NAME=AURATriage" `
    "AURA_QUICK_AGENT_NAME=AURAContextPilotQuick" `
    "AURA_WEB_AGENT_NAME=AURAContextPilotWeb" `
    "AURA_CONTEXT_AGENT_NAME=AURAContextPilot" `
    "AURA_SYNTHESIZER_AGENT_NAME=AURAContextPilotResponseSynthesizer" `
    "AzureWebJobsFeatureFlags=EnableWorkerIndexing"
```

**7. Deployment durchführen**

```powershell
cd E:\ContextPilot\contextpilot-mfa-function
func azure functionapp publish contextpilot-mfa-func --python
```

**Erwartete Ausgabe bei Erfolg:**

```
Functions in contextpilot-mfa-func:
    healthz - [httpTrigger]
        Invoke url: https://contextpilot-mfa-func.azurewebsites.net/api/healthz

    mfa_endpoint - [httpTrigger]
        Invoke url: https://contextpilot-mfa-func.azurewebsites.net/api/mfa
```

**⚠️ Wenn "0 Functions" angezeigt wird:** Prüfe Application Insights auf ImportErrors (siehe Troubleshooting).

---

### 16.4 Managed Identity und RBAC

#### 16.4.1 Executive Summary

Die Azure Function muss auf Azure AI Foundry zugreifen können, um die Agents auszuführen. Anstatt API-Keys im Code zu speichern, verwenden wir **Managed Identity** - Azure authentifiziert die Function automatisch. Die kritische Erkenntnis war, dass die RBAC-Rolle auf der **richtigen Resource Group** gesetzt werden muss (wo das AI Foundry Projekt liegt, nicht wo die Function liegt).

#### 16.4.2 Technische Details

**1. Managed Identity aktivieren**

```powershell
az functionapp identity assign `
  --name contextpilot-mfa-func `
  --resource-group ContextPilot-Resource
```

**Ausgabe (Principal ID merken):**
```json
{
  "principalId": "f6350cb3-3f75-414c-924f-c363a85aa072",
  "tenantId": "134528fb-1b3d-43bc-8b75-fb1361b41af1",
  "type": "SystemAssigned"
}
```

**2. RBAC-Rolle zuweisen**

Die Function braucht die Rolle **"Azure AI User"** auf der Resource Group, wo das AI Foundry Projekt liegt:

```powershell
# WICHTIG: Rolle muss auf Area-Review-Resource gesetzt werden,
# NICHT auf ContextPilot-Resource!

az role assignment create `
  --assignee f6350cb3-3f75-414c-924f-c363a85aa072 `
  --role "Azure AI User" `
  --scope "/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/Area-Review-Resource"
```

**Warum "Azure AI User"?**

Die Rolle enthält die notwendige Data Action für Agent-Zugriff:
```json
{
  "dataActions": ["Microsoft.CognitiveServices/*"]
}
```

Andere Rollen wie "Cognitive Services User" reichen NICHT für Agents!

**3. Alle zugewiesenen Rollen prüfen**

```powershell
az role assignment list `
  --assignee f6350cb3-3f75-414c-924f-c363a85aa072 `
  --scope "/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/Area-Review-Resource" `
  --query "[].roleDefinitionName" -o json
```

**Erwartete Ausgabe:**
```json
["Azure AI User"]
```

**4. Häufiger Fehler und Lösung**

**Fehler:**
```
PermissionDenied: The principal lacks the required data action 
`Microsoft.CognitiveServices/accounts/AIServices/agents/read`
```

**Ursache:** Rolle ist auf falscher Resource Group gesetzt.

**Lösung:** Prüfen wo das AI Foundry Projekt liegt:
```powershell
az resource list --query "[?contains(name, 'contextpilot')].{name:name, rg:resourceGroup}" -o table
```

---

### 16.5 Proxy Server Konfiguration

#### 16.5.1 Executive Summary

Der Proxy Server ist der zentrale Routing-Punkt für alle Frontend-Anfragen. Er wurde erweitert, um den neuen MFA-Typ zu unterstützen. Die Konfiguration erfolgt über Umgebungsvariablen (`MFA_1_NAME`, `MFA_1_ENDPOINT`, etc.). Nach Änderungen muss der Code via GitHub Actions neu deployed werden.

#### 16.5.2 Technische Details

**1. MFA-Umgebungsvariablen setzen**

```powershell
az webapp config appsettings set `
  --name contextpilot-proxy-2025 `
  --resource-group ContextPilot-Resource `
  --settings `
    "MFA_1_NAME=MFA" `
    "MFA_1_LABEL=MFA (Multi-Agent)" `
    "MFA_1_ENDPOINT=https://contextpilot-mfa-func.azurewebsites.net/api/mfa"
```

**⚠️ WICHTIG:** Der Index startet bei 1, nicht bei 0! (`MFA_1_NAME`, nicht `MFA_0_NAME`)

**2. Proxy Server Code (proxy-server.js)**

Der Proxy lädt MFA-Konfigurationen beim Start:

```javascript
// MFA configs (Azure Function-backed MAF orchestration)
function loadMFAConfigs() {
  const mfas = {};
  let i = 1;
  while (process.env[`MFA_${i}_NAME`]) {
    const mfaId = -100 - i;  // Negative IDs ab -101 für MFA
    mfas[mfaId] = {
      id: mfaId,
      name: process.env[`MFA_${i}_NAME`],
      label: process.env[`MFA_${i}_LABEL`] || process.env[`MFA_${i}_NAME`],
      endpoint: process.env[`MFA_${i}_ENDPOINT`],
      type: "mfa",
    };
    i++;
  }
  return mfas;
}

const MFAS = loadMFAConfigs();
```

**3. API Response mit MFA**

Der `/agents` Endpoint gibt jetzt auch MFA zurück:

```json
{
  "agents": [...],
  "workflows": [...],
  "mfas": [
    {
      "id": -101,
      "name": "MFA",
      "label": "MFA (Multi-Agent)",
      "type": "mfa",
      "active": false
    }
  ],
  "currentAgentId": -1
}
```

---

### 16.6 CI/CD Pipeline (GitHub Actions)

#### 16.6.1 Executive Summary

Beide Haupt-Komponenten (Proxy Server und Static Web App) werden automatisch deployed, wenn Code auf den `main` Branch gepusht wird. Die Function App wird hingegen manuell via `func azure functionapp publish` deployed.

#### 16.6.2 Technische Details

**1. Automatische Deployments (main Branch)**

| Komponente | Workflow-Datei | Trigger |
|------------|----------------|---------|
| Proxy Server | `.github/workflows/main_contextpilot-proxy-2025.yml` | Push to `main` |
| Static Web App | `.github/workflows/azure-static-web-apps-ashy-dune-06d0e9810.yml` | Push to `main` |
| Function App | (kein Workflow) | Manuell: `func azure functionapp publish` |

**2. Workflow für Proxy Server**

```yaml
name: Build and deploy Node.js app to Azure Web App - contextpilot-proxy-2025

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js version
        uses: actions/setup-node@v3
        with:
          node-version: '22.x'
      - name: npm install, build, and test
        working-directory: live-transcriber
        run: |
          npm install
          npm run build --if-present
```

**3. Deployment-Workflow**

```
1. Entwicklung auf Feature-Branch (z.B. `maf`)
2. Commit & Push zu Feature-Branch
3. Lokaler Test
4. Merge zu `main`: git checkout main && git merge maf && git push origin main
5. GitHub Actions triggert automatisch
6. Deployment läuft (ca. 2-3 Minuten)
7. Verifizieren: https://contextpilot-proxy-2025-*.azurewebsites.net/agents
```

**4. Function App manuell deployen**

```powershell
cd E:\ContextPilot\contextpilot-mfa-function
func azure functionapp publish contextpilot-mfa-func --python
```

---

### 16.7 Troubleshooting

#### 16.7.1 Problem: "0 Functions" nach Deployment

**Symptom:**
```
Functions in contextpilot-mfa-func:
    (leer)
```

**Ursache:** ImportError beim Laden von `function_app.py`

**Diagnose via Application Insights:**

```powershell
# App Insights App-ID holen
$aiAppId = az monitor app-insights component show `
  -g ContextPilot-Resource -a contextpilot-mfa-func `
  --query appId -o tsv

# Exceptions abfragen
az monitor app-insights query --app $aiAppId --analytics-query `
  "exceptions | where timestamp > ago(1h) | project timestamp, outerMessage | take 5"
```

**Typische Fehler:**
- `ModuleNotFoundError: agent-framework-azure-ai` → Package in requirements.txt hinzufügen
- `ModuleNotFoundError: mfa_workflow` → Datei fehlt im Deployment-Package

**Lösung:** Lazy Import verwenden (siehe 16.3.2 Punkt 4)

#### 16.7.2 Problem: PermissionDenied bei Agent-Zugriff

**Symptom:**
```json
{
  "error": "The principal lacks the required data action 
            Microsoft.CognitiveServices/accounts/AIServices/agents/read"
}
```

**Diagnose:**

```powershell
# Prüfe wo das AI Foundry Projekt liegt
az resource list --query "[?contains(name, 'contextpilot')].resourceGroup" -o table

# Prüfe zugewiesene Rollen
az role assignment list --assignee <PRINCIPAL_ID> -o table
```

**Lösung:** "Azure AI User" Rolle auf die korrekte Resource Group setzen.

#### 16.7.3 Problem: MFA erscheint nicht im Frontend

**Symptom:** Dropdown zeigt nur "Agent" und "Workflow", kein "MFA"

**Diagnose:**

```powershell
# Prüfe ob MFA-Config gesetzt ist
az webapp config appsettings list `
  --name contextpilot-proxy-2025 `
  --resource-group ContextPilot-Resource `
  --query "[?contains(name, 'MFA')]" -o table

# Prüfe API Response
Invoke-RestMethod -Uri "https://<PROXY_URL>/agents" | ConvertTo-Json
```

**Mögliche Ursachen:**
1. MFA-Umgebungsvariablen fehlen → setzen mit `az webapp config appsettings set`
2. Falscher Index (`MFA_0_` statt `MFA_1_`) → Index muss bei 1 starten
3. Alter Code deployed → Push zu `main` und warten auf GitHub Actions

---

### 16.8 Verifizierung

Nach erfolgreichem Deployment sollten alle Tests bestehen:

```powershell
# 1. Health Check
Invoke-RestMethod -Uri "https://contextpilot-mfa-func.azurewebsites.net/api/healthz"
# Erwartung: {"ok": true, "version": "2.4"}

# 2. MFA Endpoint Test
$body = '{"prompt": "What is 2+2?"}'
Invoke-RestMethod -Uri "https://contextpilot-mfa-func.azurewebsites.net/api/mfa" `
  -Method POST -Body $body -ContentType "application/json"
# Erwartung: {"output_text": "4", "workflow": "mfa", "agents_used": [...]}

# 3. Proxy Server MFA-Liste
Invoke-RestMethod -Uri "https://<PROXY_URL>/agents" | ConvertTo-Json
# Erwartung: Response enthält "mfas" Array

# 4. Frontend
# Öffne https://ashy-dune-06d0e9810.4.azurestaticapps.net/
# Erwartung: "MFA (Multi-Agent)" erscheint im Dropdown
```

---

### 16.9 Quick Reference

**Wichtige URLs:**

| Komponente | URL |
|------------|-----|
| Function App Health | `https://contextpilot-mfa-func.azurewebsites.net/api/healthz` |
| Function App MFA | `https://contextpilot-mfa-func.azurewebsites.net/api/mfa` |
| Proxy Server Agents | `https://contextpilot-proxy-2025-*.azurewebsites.net/agents` |
| Frontend | `https://ashy-dune-06d0e9810.4.azurestaticapps.net/` |
| GitHub Actions | `https://github.com/JohnMavic/ContextPilot/actions` |

**Wichtige Befehle:**

```powershell
# Function App deployen
cd E:\ContextPilot\contextpilot-mfa-function
func azure functionapp publish contextpilot-mfa-func --python

# Proxy Server deployen (via Git)
git checkout main
git merge <feature-branch>
git push origin main

# Function App Logs
az monitor app-insights query --app <APP_ID> --analytics-query "exceptions | take 10"

# Function App neustarten
az functionapp restart --name contextpilot-mfa-func --resource-group ContextPilot-Resource

# Proxy Server neustarten
az webapp restart --name contextpilot-proxy-2025 --resource-group ContextPilot-Resource
```
