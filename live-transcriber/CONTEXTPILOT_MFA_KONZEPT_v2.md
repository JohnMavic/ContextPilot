# CONTEXTPILOT MFA-Konzept v2.1
## Umstellung auf Azure Function mit Microsoft Agent Framework

**Version:** 2.1  
**Datum:** 24. Dezember 2025  
**Status:** Validiert (MAF) – Entwurf zur Umsetzung  
**Technologie-Stack:** Azure Function (Python) + Microsoft Agent Framework (MAF)

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

### 3.1 Isolationsprinzip

| Aspekt | Bestehend | MFA (Neu) | Konflikt? |
|--------|-----------|-----------|-----------|
| **Routing-Logik** | `type: "agent"` oder `type: "workflow"` | `type: "mfa"` (NEU) | ❌ Nein |
| **Endpoint** | `/agent` (gleich) | `/agent` (gleich) | ❌ Nein - Unterscheidung via `currentAgentId` |
| **Proxy-Code** | `handleAgentRequest()`, `handleWorkflowRequest()` | `handleMFARequest()` (NEU) | ❌ Separate Funktion |
| **Foundry Agenten** | Direkt aufgerufen | Indirekt via MAF | ❌ Agenten unverändert |

### 3.2 Code-Änderungen im Proxy (Minimal-invasiv)

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

### 4.1 Projektstruktur

```
contextpilot-mfa-function/
├── function_app.py          # Azure Function Entry Point
├── mfa_workflow.py          # MAF Workflow Definition
├── agents/
│   └── foundry_agents.py    # Agent-Wrapper für Foundry
├── requirements.txt
├── host.json
└── local.settings.json
```

### 4.2 requirements.txt (Version-Pinning – empfohlen)

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

```python
"""
CONTEXTPILOT MFA Workflow (MAF, Python)
Pattern: Triage -> Fan-Out (parallel) -> Fan-In -> Synthesizer

Wichtig:
- Bestehende Foundry Agents werden als *existing agents* per agent_id verwendet.
- Kein "resolve by name" annehmen.
- SDK-default ENV VARs verwenden (AZURE_AI_PROJECT_ENDPOINT / AZURE_AI_MODEL_DEPLOYMENT_NAME).
"""

from __future__ import annotations

import json
import os
from typing import Any

from typing_extensions import Never

from agent_framework import (
    ChatAgent,
    Executor,
    WorkflowBuilder,
    WorkflowContext,
    WorkflowOutputEvent,
    handler,
)
from agent_framework_azure_ai import AzureAIAgentClient
from azure.identity.aio import DefaultAzureCredential

# ============================================================
# KONFIGURATION (ENV VARS)
# ============================================================
AZURE_AI_PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
AZURE_AI_MODEL_DEPLOYMENT_NAME = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]

AURA_TRIAGE_AGENT_ID = os.environ["AURA_TRIAGE_AGENT_ID"]
AURA_WEB_AGENT_ID = os.environ["AURA_WEB_AGENT_ID"]
AURA_CONTEXT_AGENT_ID = os.environ["AURA_CONTEXT_AGENT_ID"]
AURA_SYNTHESIZER_AGENT_ID = os.environ["AURA_SYNTHESIZER_AGENT_ID"]


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


async def build_mfa_workflow():
    """Erstellt den MAF Workflow: Triage -> parallel -> Synthese."""

    async with (
        DefaultAzureCredential() as credential,
        AzureAIAgentClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_id=AURA_TRIAGE_AGENT_ID,
        ).create_agent() as triage_agent,
        AzureAIAgentClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_id=AURA_WEB_AGENT_ID,
        ).create_agent() as web_agent,
        AzureAIAgentClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_id=AURA_CONTEXT_AGENT_ID,
        ).create_agent() as context_agent,
        AzureAIAgentClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_id=AURA_SYNTHESIZER_AGENT_ID,
        ).create_agent() as synth_agent,
    ):
        triage = TriageExecutor(triage_agent)
        web_exec = WebAgentExecutor(web_agent)
        context_exec = ContextAgentExecutor(context_agent)
        synthesizer = SynthesizerExecutor(synth_agent)

        workflow = (
            WorkflowBuilder()
            .set_start_executor(triage)
            .add_multi_selection_edge_group(
                triage,
                [web_exec, context_exec],
                selection_func=select_agents,
            )
            .add_fan_in_edges([web_exec, context_exec], synthesizer)
            .build()
        )
        return workflow


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

```python
"""
Azure Function HTTP Trigger für CONTEXTPILOT MFA.
"""

import azure.functions as func
import json
import asyncio
from mfa_workflow import run_mfa_workflow

app = func.FunctionApp()

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

**Kurzantwort:** `AzureAIAgentClient` ist **kein** Foundry-Agent. Es ist der **Python-SDK-Client/Adapter**, mit dem MAF einen bestehenden **Azure AI Foundry Agent** (z. B. `AURAContextPilotWeb`) als ausführbaren `ChatAgent` in Python instanziert.

**Warum brauchen wir ihn?**
- Im bestehenden Node/Proxy-Flow ruft ihr Agents/Workflows über die **Foundry Responses API** auf.
- Im neuen MAF-Flow läuft die Orchestrierung in **Python** (Azure Function). Damit die Workflow-Executors die **gleichen** Foundry-Agents nutzen können, brauchen sie einen Python-Client, der:
  - Auth (Managed Identity / Credential) handhabt,
  - `project_endpoint` + `agent_id` nutzt (Existing Agent),
  - eine lauffähige `ChatAgent`-Instanz erzeugt (`create_agent()`),
  - und dann `run()` auf diesem Agent erlaubt.

**So passt es ins Bild:**
- `AURAContextPilotWeb`, `AURAContextPilot`, `AURAContextPilotResponseSynthesizer` bleiben **die gleichen Foundry Agents wie heute**.
- Neu kommt `AURATriage` dazu (Foundry Agent).
- `AzureAIAgentClient(..., agent_id="<AgentId>")` ist nur die **Transport-/SDK-Schicht**, um diese Agents in Python/MAF aufzurufen.

### 4.6 Timeout-Realität für HTTP Trigger (Consumption)

Für **HTTP Trigger** gilt ein praktisches Response-Limit (Load Balancer Idle Timeout). Plane konservativ:

- `host.json` → `functionTimeout`: **00:03:30** (210s) als Safe Default.
- Wenn du absehbar >230s brauchst: **Durable Functions async pattern** oder „defer work + immediate response“.

Begründung und Limits: siehe Microsoft Learn (Function app time-out duration – HTTP Trigger 230s Limit).

---

## 5. AURATriage: Entscheidungslogik

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

- [Microsoft Agent Framework GitHub](https://github.com/microsoft/agent-framework)
- [MAF Parallelism Samples](https://github.com/microsoft/agent-framework/tree/main/python/samples/getting_started/workflows/parallelism)
- [Azure AI Foundry Agent Service](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/)
- [Azure Functions Python Developer Guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python)

---

*Dokument erstellt für Review. Feedback willkommen.*


## 13. MAF Recherche (validiert, mit Quellen)

Tabelle: **Frage → Antwort → Quelle**

| Frage | Antwort | Quelle |
|---|---|---|
| Was ist `AzureAIAgentClient`? | Python SDK-Client für Azure AI Foundry Agents; erstellt einen `ChatAgent` über `create_agent()`. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest |
| Wie werden Foundry Agents in MAF Workflows genutzt? | Über `AzureAIAgentClient(...).create_agent()` wird ein `ChatAgent` erzeugt, der per `run()` aufgerufen wird; dieser Agent repräsentiert den Foundry Agent (Name/ID). | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest |
| Unterstützt MAF Fan-In / Fan-Out? | `WorkflowBuilder` bietet `add_fan_in_edges()` (synchronisiert, sammelt Liste) und `add_fan_out_edges()` (broadcast). | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Unterstützt MAF dynamische Multi-Selection (Triage entscheidet)? | `add_multi_selection_edge_group()` sendet Messages an mehrere Targets gemäß Selection-Funktion. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Gibt es Fallstricke mit Executor-Instanzen? | Wenn Executor-Instanzen direkt übergeben werden, können sie über mehrere Workflow-Instanzen geteilt werden; `register_executor/register_agent` ist der sichere Weg, falls Workflows gecached werden. | https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest |
| Wie wird Azure Functions Timeout konfiguriert? | `functionTimeout` in `host.json` (timespan string). Fixed upper bound empfohlen. | https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json |
| Welche Defaults/Maxima gelten je Plan und was ist das HTTP-Limit? | Consumption: default 5 min, max 10 min; **HTTP Trigger max ~230s Response** (Load Balancer Idle Timeout). | https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale |

**Technische Schlussfolgerung (Go/No-Go):** **GO** für additive Einführung von MFA/MAF, sofern Version-Pinning + Timeout 210s + isoliertes Routing strikt eingehalten werden.

---

## 14. Externer Entwickler Guide (verbindlich)

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
  - `AURA_TRIAGE_AGENT_ID`: `<existing-agent-id>` (AURATriage)
  - `AURA_WEB_AGENT_ID`: `<existing-agent-id>` (AURAContextPilotWeb)
  - `AURA_CONTEXT_AGENT_ID`: `<existing-agent-id>` (AURAContextPilot)
  - `AURA_SYNTHESIZER_AGENT_ID`: `<existing-agent-id>` (AURAContextPilotResponseSynthesizer)
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

5. **MAF Workflow (Pflichtstruktur):**
   Du musst exakt diese Struktur implementieren:
   - Start: `AURATriage`
   - Routing: `add_multi_selection_edge_group()` (Triage entscheidet)
   - Fan-In: `add_fan_in_edges()` → `AURAContextPilotResponseSynthesizer`
   Der Workflow darf nicht sequenziell sein.

6. **AzureAIAgentClient Verständnis (Pflicht):**  
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

- MAF WorkflowBuilder API: https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest
- MAF AzureAIAgentClient API: https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.azure.azureaiagentclient?view=agent-framework-python-latest
- Azure Functions Hosting/Timeouts: https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale
- Azure Functions host.json: https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json
