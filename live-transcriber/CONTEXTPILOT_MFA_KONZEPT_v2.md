# CONTEXTPILOT MFA-Konzept v2
## Umstellung auf Azure Function mit Microsoft Agent Framework

**Version:** 2.0  
**Datum:** 22. Dezember 2025  
**Status:** Entwurf zur Überprüfung  
**Technologie-Stack:** Azure Function (Python) + Microsoft Agent Framework (MAF)

---

## 1. Zusammenfassung

Dieses Konzept beschreibt die Erweiterung von CONTEXTPILOT um eine **MFA-Option** (Multi-Agent Framework), die echte Parallelisierung mittels Microsoft Agent Framework in einer Azure Function implementiert.

**Kernziele:**
- ✅ Bestehende Funktionalität (Agent, Workflow) bleibt **unverändert**
- ✅ Neue MFA-Option nutzt **offizielles Microsoft Agent Framework**
- ✅ Echte Parallelität via `WorkflowBuilder.add_fan_out_edges()`
- ✅ Dynamische Agent-Auswahl durch **AURATriage**
- ✅ Zukunftssicher durch SDK-Updates (`pip install --upgrade`)

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

### 4.2 requirements.txt

```
azure-functions
agent-framework-core --pre
agent-framework-azure-ai --pre
azure-identity
```

### 4.3 MAF Workflow Code (mfa_workflow.py)

```python
"""
CONTEXTPILOT MFA Workflow
Basiert auf: github.com/microsoft/agent-framework/.../parallelism/
"""

import asyncio
from typing import Never
from agent_framework import (
    Executor,
    WorkflowBuilder,
    WorkflowContext,
    WorkflowOutputEvent,
    handler,
)
from agent_framework.azure import AzureAIAgentClient
from azure.identity.aio import DefaultAzureCredential

# ============================================================
# KONFIGURATION
# ============================================================

PROJECT_ENDPOINT = "https://<resource>.services.ai.azure.com/api/projects/<project>"
MODEL_DEPLOYMENT = "gpt-4o-mini"

# Agent-Namen (wie in Foundry Portal definiert)
TRIAGE_AGENT = "AURATriage"
WEB_AGENT = "AURAContextPilotWeb"
CONTEXT_AGENT = "AURAContextPilot"
SYNTHESIZER_AGENT = "AURAContextPilotResponseSynthesizer"


# ============================================================
# TRIAGE EXECUTOR
# ============================================================

class TriageExecutor(Executor):
    """
    Ruft AURATriage auf und gibt Routing-Entscheidung zurück.
    Output: {"agents": {"web": true, "context": false}, "reasoning": "..."}
    """
    
    def __init__(self, client: AzureAIAgentClient):
        super().__init__(id="triage")
        self.client = client
    
    @handler
    async def handle(self, prompt: str, ctx: WorkflowContext) -> dict:
        response = await self.client.run(prompt)
        
        # Parse JSON-Entscheidung von Triage
        import json
        try:
            decision = json.loads(response.messages[-1].text)
        except:
            # Fallback: Beide Agenten aufrufen
            decision = {"agents": {"web": True, "context": True}}
        
        await ctx.send_message({
            "original_prompt": prompt,
            "decision": decision
        })


# ============================================================
# SPECIALIST EXECUTORS (Web, Context, Future...)
# ============================================================

class WebAgentExecutor(Executor):
    """Ruft AURAContextPilotWeb auf."""
    
    def __init__(self, client: AzureAIAgentClient):
        super().__init__(id="web_agent")
        self.client = client
    
    @handler
    async def handle(self, data: dict, ctx: WorkflowContext):
        response = await self.client.run(data["original_prompt"])
        await ctx.send_message({
            "agent": "web",
            "response": response.messages[-1].text
        })


class ContextAgentExecutor(Executor):
    """Ruft AURAContextPilot auf."""
    
    def __init__(self, client: AzureAIAgentClient):
        super().__init__(id="context_agent")
        self.client = client
    
    @handler
    async def handle(self, data: dict, ctx: WorkflowContext):
        response = await self.client.run(data["original_prompt"])
        await ctx.send_message({
            "agent": "context",
            "response": response.messages[-1].text
        })


# ============================================================
# SYNTHESIZER EXECUTOR
# ============================================================

class SynthesizerExecutor(Executor):
    """
    Sammelt alle Agent-Antworten und erstellt finale Synthese.
    """
    
    def __init__(self, client: AzureAIAgentClient):
        super().__init__(id="synthesizer")
        self.client = client
    
    @handler
    async def handle(self, results: list[dict], ctx: WorkflowContext[Never, str]):
        # Baue Synthese-Prompt aus allen Ergebnissen
        synthesis_prompt = self._build_synthesis_prompt(results)
        
        response = await self.client.run(synthesis_prompt)
        final_text = response.messages[-1].text
        
        await ctx.yield_output(final_text)
    
    def _build_synthesis_prompt(self, results: list[dict]) -> str:
        """Erstellt strukturierten Prompt für Synthesizer."""
        lines = ["Fasse die folgenden Agent-Antworten zusammen:\n"]
        
        for r in results:
            if isinstance(r, dict) and "agent" in r:
                lines.append(f"=== Antwort von {r['agent'].upper()} ===")
                lines.append(r.get("response", "Keine Antwort"))
                lines.append("")
        
        lines.append("Erstelle eine kohärente, zusammengefasste Antwort.")
        return "\n".join(lines)


# ============================================================
# WORKFLOW BUILDER MIT DYNAMISCHER AGENT-AUSWAHL
# ============================================================

def select_agents(triage_output: dict, target_ids: list[str]) -> list[str]:
    """
    Dynamische Agent-Auswahl basierend auf Triage-Entscheidung.
    
    Diese Funktion wird von MAF's add_multi_selection_edge_group aufgerufen.
    Sie mappt die Triage-Entscheidung auf konkrete Executor-IDs.
    """
    web_id, context_id = target_ids  # Reihenfolge wie in edge_group definiert
    
    decision = triage_output.get("decision", {}).get("agents", {})
    selected = []
    
    if decision.get("web", False):
        selected.append(web_id)
    
    if decision.get("context", False):
        selected.append(context_id)
    
    # Fallback: Mindestens einen Agent aufrufen
    if not selected:
        selected = [web_id, context_id]
    
    return selected


async def build_mfa_workflow():
    """
    Erstellt den MAF Workflow mit Triage → Parallel Agents → Synthesizer.
    
    Pattern basiert auf:
    github.com/microsoft/agent-framework/.../parallelism/fan_out_fan_in_edges.py
    """
    
    credential = DefaultAzureCredential()
    
    # Foundry Agent Clients erstellen
    async with (
        AzureAIAgentClient(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment_name=MODEL_DEPLOYMENT,
            async_credential=credential,
            agent_name=TRIAGE_AGENT
        ).create_agent() as triage_client,
        
        AzureAIAgentClient(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment_name=MODEL_DEPLOYMENT,
            async_credential=credential,
            agent_name=WEB_AGENT
        ).create_agent() as web_client,
        
        AzureAIAgentClient(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment_name=MODEL_DEPLOYMENT,
            async_credential=credential,
            agent_name=CONTEXT_AGENT
        ).create_agent() as context_client,
        
        AzureAIAgentClient(
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment_name=MODEL_DEPLOYMENT,
            async_credential=credential,
            agent_name=SYNTHESIZER_AGENT
        ).create_agent() as synth_client,
    ):
        # Executors instanziieren
        triage = TriageExecutor(triage_client)
        web_agent = WebAgentExecutor(web_client)
        context_agent = ContextAgentExecutor(context_client)
        synthesizer = SynthesizerExecutor(synth_client)
        
        # Workflow bauen
        workflow = (
            WorkflowBuilder()
            
            # Start: Triage
            .set_start_executor(triage)
            
            # Dynamische parallele Verzweigung basierend auf Triage
            .add_multi_selection_edge_group(
                triage,
                [web_agent, context_agent],  # Verfügbare Spezialisten
                selection_func=select_agents  # Entscheidet wer aufgerufen wird
            )
            
            # Fan-In: Alle Ergebnisse zum Synthesizer
            .add_fan_in_edges(
                [web_agent, context_agent],
                synthesizer
            )
            
            .build()
        )
        
        return workflow


# ============================================================
# WORKFLOW AUSFÜHRUNG
# ============================================================

async def run_mfa_workflow(prompt: str) -> str:
    """
    Führt den kompletten MFA-Workflow aus.
    Returns: Finale synthetisierte Antwort als String.
    """
    
    workflow = await build_mfa_workflow()
    
    final_output = None
    
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

---

## 5. AURATriage: Entscheidungslogik

### 5.1 System Instructions für AURATriage (in Foundry Portal)

```
Du bist AURATriage, ein Routing-Agent für CONTEXTPILOT.

AUFGABE:
Analysiere die Benutzeranfrage und entscheide, welche Spezialagenten 
aktiviert werden sollen.

VERFÜGBARE AGENTEN:
- "web": AURAContextPilotWeb 
  → Für aktuelle Informationen, Fakten, externe Daten
  
- "context": AURAContextPilot 
  → Für Fragen zum Transkript, Meeting-Inhalt, interner Kontext

ENTSCHEIDUNGSREGELN:
1. Frage nach aktuellen Ereignissen/Fakten? → web: true
2. Frage bezieht sich auf "wir", "unser Meeting", "das Gesagte"? → context: true
3. Vergleich intern vs. extern gewünscht? → BEIDE true
4. Unklar? → Sicherheitshalber BEIDE true

WICHTIG:
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt. Kein anderer Text!

FORMAT:
{
  "agents": {
    "web": true/false,
    "context": true/false
  },
  "reasoning": "Kurze Begründung (max. 50 Wörter)"
}
```

### 5.2 Wie die Entscheidung verarbeitet wird

```
┌─────────────────────────────────────────────────────────────────────┐
│  ENTSCHEIDUNGSFLUSS                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User-Prompt kommt an                                            │
│     "Vergleiche unsere Meeting-Strategie mit aktuellen Trends"      │
│                                                                     │
│  2. AURATriage analysiert                                           │
│     - "unsere" → Context relevant                                   │
│     - "aktuelle Trends" → Web relevant                              │
│                                                                     │
│  3. AURATriage gibt JSON zurück                                     │
│     {"agents": {"web": true, "context": true}, "reasoning": "..."}  │
│                                                                     │
│  4. MAF's select_agents() Funktion wird aufgerufen                  │
│     Input: {"agents": {"web": true, "context": true}}               │
│     Output: ["web_agent", "context_agent"]                          │
│                                                                     │
│  5. MAF führt ausgewählte Executors PARALLEL aus                    │
│     ┌──────────────┐    ┌──────────────┐                            │
│     │  web_agent   │    │context_agent │   ← Gleichzeitig!          │
│     └──────┬───────┘    └──────┬───────┘                            │
│            │                   │                                    │
│            └─────────┬─────────┘                                    │
│                      ▼                                              │
│  6. Fan-In sammelt beide Ergebnisse                                 │
│     [{"agent": "web", "response": "..."}, {"agent": "context"...}]  │
│                                                                     │
│  7. Synthesizer erhält alle Ergebnisse                              │
│     Prompt: "Fasse zusammen: === WEB === ... === CONTEXT === ..."   │
│                                                                     │
│  8. Finale Antwort zurück an User                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
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
MFA_1_LABEL=Multi-Agent (Parallel mit Triage)
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
| **SDK-Updates** | N/A | `pip install --upgrade` |
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

**Geschätzter Gesamtaufwand: 4-5 Tage**

---

## 10. Risikobewertung

| Risiko | Wahrsch. | Impact | Mitigation |
|--------|----------|--------|------------|
| MAF ist Preview (Breaking Changes) | Mittel | Hoch | Version pinnen, vor Update testen |
| Azure Function Cold Start | Sicher | Niedrig | Premium Plan oder Keep-Alive |
| Triage gibt kein valides JSON | Mittel | Mittel | Fallback: Alle Agenten aufrufen |
| Foundry API ändert sich | Niedrig | Hoch | MAF-SDK abstrahiert das |
| Bestehende Prozesse brechen | Sehr niedrig | Kritisch | Komplett isoliert, eigene ID-Range |

---

## 11. Offene Fragen für Review

1. **Hosting-Plan:** Consumption (günstig, Cold Start) oder Premium (immer warm)?

2. **Auth:** Function Key oder Managed Identity zwischen Proxy und Function?

3. **Timeout:** Foundry-Agenten können 30s+ brauchen – wie mit Azure Function Timeout umgehen?

4. **Logging:** Wo sollen Traces hin? Application Insights? Log Analytics?

5. **Fallback:** Was wenn Azure Function down ist – automatisch auf Workflow fallen?

---

## 12. Referenzen

- [Microsoft Agent Framework GitHub](https://github.com/microsoft/agent-framework)
- [MAF Parallelism Samples](https://github.com/microsoft/agent-framework/tree/main/python/samples/getting_started/workflows/parallelism)
- [Azure AI Foundry Agent Service](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/)
- [Azure Functions Python Developer Guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python)

---

*Dokument erstellt für Review. Feedback willkommen.*
