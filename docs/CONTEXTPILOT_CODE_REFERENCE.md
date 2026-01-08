# CONTEXTPILOT - Code Reference

**Projekt:** CONTEXTPILOT  
**Zielordner:** `E:\ContextPilot`  
**Datum:** 8. Januar 2026  
**Version:** 2.5  
**Repository:** https://github.com/JohnMavic/ContextPilot

---

## Dokumentzweck

Dieses Dokument enthält den vollständigen, produktiven Code aller MFA-relevanten Dateien des CONTEXTPILOT-Projekts. Es dient als Code-Referenz für externe Berater und Entwickler.

---

## Inhaltsverzeichnis

1. [Architektur-Überblick](#1-architektur-überblick)
2. [Azure Function - mfa_workflow.py](#2-azure-function---mfa_workflowpy)
3. [Azure Function - function_app.py](#3-azure-function---function_apppy)
4. [Azure Function - requirements.txt](#4-azure-function---requirementstxt)
5. [Proxy Server - proxy-server.js (Auszüge)](#5-proxy-server---proxy-serverjs-auszüge)
6. [Frontend Hook - useAuraAgent.ts (Auszüge)](#6-frontend-hook---useauraagentts-auszüge)

---

## 1. Architektur-Überblick

### Komponenten und ihre Aufgaben

| Komponente | Datei | Aufgabe |
|------------|-------|---------|
| **MFA Workflow** | `mfa_workflow.py` | Multi-Agent-Orchestrierung: Triage → Agents → Synthesizer |
| **Azure Function** | `function_app.py` | HTTP-Endpoints für MFA (`/api/mfa`, `/api/healthz`) |
| **Dependencies** | `requirements.txt` | Python-Pakete inkl. Microsoft Agent Framework |
| **Proxy Server** | `proxy-server.js` | Routing Frontend → Agents/Workflows/MFA |
| **Frontend Hook** | `useAuraAgent.ts` | React-Hook für Agent-Kommunikation |

### Datenfluss

```
Frontend (React/Vite)
    │
    │ POST /agent
    ▼
Proxy Server (Node.js, Port 3001)
    │
    ├─ type: "agent"    → Azure AI Foundry Agent (direkt)
    ├─ type: "workflow" → Azure AI Foundry Workflow (sequenziell)
    └─ type: "mfa"      → Azure Function (Python, Port 7071)
                              │
                              ▼
                        MFA Workflow
                              │
                        ┌─────┴─────┐
                        │ AURATriage │ (Routing-Entscheidung)
                        └─────┬─────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         [direct]          [web]          [context]
              │               │               │
              │         AURAWeb          AURAContext
              │               │               │
              └───────────────┴───────────────┘
                              │
                              ▼
                     AURASynthesizer (nur wenn beide)
                              │
                              ▼
                        Response zurück
```

---

## 2. Azure Function - mfa_workflow.py

**Pfad:** `contextpilot-mfa-function/mfa_workflow.py`

**Aufgabe:** 
- Kernlogik der Multi-Agent-Orchestrierung
- Triage-Routing (direct/web/context)
- Agent-Aufrufe via Microsoft Agent Framework
- Synthese bei Mehrfach-Agent-Antworten

```python
"""CONTEXTPILOT MFA Workflow v2.4 (MAF, Python)

Optimiertes Pattern:
- Triage entscheidet: direct, web, context, oder Kombinationen
- "direct": AURAContextPilotQuick antwortet (schnelle, einfache Fragen)
- Synthesizer NUR wenn BEIDE Agents (web + context) genutzt wurden
- Einzelner Agent: Antwort direkt zurückgeben

Agents:
- AURATriage: Routing-Entscheidung
- AURAContextPilotQuick: Schnelle Antworten (Übersetzungen, Allgemeinwissen)
- AURAContextPilotWeb: Web-Suche für aktuelle Daten
- AURAContextPilot: Interner Business-Index
- AURAContextPilotResponseSynthesizer: Zusammenführung bei Mehrfach-Agents
"""

import json
import os
from typing import Any

from agent_framework.azure import AzureAIClient
from azure.identity.aio import DefaultAzureCredential

AZURE_AI_PROJECT_ENDPOINT = os.environ["AZURE_AI_PROJECT_ENDPOINT"]
AZURE_AI_MODEL_DEPLOYMENT_NAME = os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"]

# Agent names - AzureAIClient resolves by name + use_latest_version
AURA_TRIAGE_AGENT_NAME = os.environ["AURA_TRIAGE_AGENT_NAME"]
AURA_QUICK_AGENT_NAME = os.environ.get("AURA_QUICK_AGENT_NAME", "AURAContextPilotQuick")
AURA_WEB_AGENT_NAME = os.environ["AURA_WEB_AGENT_NAME"]
AURA_CONTEXT_AGENT_NAME = os.environ["AURA_CONTEXT_AGENT_NAME"]
AURA_SYNTHESIZER_AGENT_NAME = os.environ["AURA_SYNTHESIZER_AGENT_NAME"]


def parse_triage_response(triage_text: str) -> dict[str, Any]:
    """Parse Triage JSON response mit Fallback auf neues Format."""
    try:
        data = json.loads(triage_text)
        
        # Neues Format (v2.2): {"routing": {"direct": bool, "web": bool, "context": bool}}
        if "routing" in data:
            return {
                "direct": data["routing"].get("direct", False),
                "web": data["routing"].get("web", False),
                "context": data["routing"].get("context", False),
                "reasoning": data.get("reasoning", ""),
                "direct_response": None,
            }
        
        # Altes Format (v2.1): {"agents": {"web": bool, "context": bool}}
        if "agents" in data:
            return {
                "direct": False,
                "web": data["agents"].get("web", False),
                "context": data["agents"].get("context", False),
                "reasoning": data.get("reasoning", ""),
                "direct_response": None,
            }
        
        # Fallback wenn JSON aber unbekanntes Format
        return {"direct": False, "web": True, "context": True, "reasoning": "Unknown format fallback"}
        
    except json.JSONDecodeError:
        # Kein JSON - Triage hat direkt geantwortet (das ist die direkte Antwort!)
        return {
            "direct": True,
            "web": False,
            "context": False,
            "reasoning": "Triage responded directly (no JSON)",
            "direct_response": triage_text,
        }


async def run_mfa_workflow(prompt: str) -> dict[str, Any]:
    """Führt den optimierten MFA-Workflow aus.
    
    Ablauf:
    1. Triage entscheidet Routing (direct/web/context)
    2. Bei "direct": Sofortige Antwort ohne weitere Agents
    3. Bei einem Agent: Nur diesen aufrufen, Antwort direkt zurückgeben
    4. Bei beiden Agents: Parallel aufrufen, dann Synthesizer
    
    Returns:
        dict mit:
        - "response": Die finale Antwort
        - "agents_used": Liste der verwendeten Agents
        - "routing": Das Routing-Objekt von Triage
    """
    
    agents_used: list[str] = []
    
    async with DefaultAzureCredential() as credential:
        
        # === PHASE 1: TRIAGE ===
        agents_used.append("AURATriage")
        async with AzureAIClient(
            credential=credential,
            project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
            model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
            agent_name=AURA_TRIAGE_AGENT_NAME,
            use_latest_version=True,
        ).create_agent() as triage_agent:
            triage_result = await triage_agent.run(prompt)
            routing = parse_triage_response(triage_result.text)
        
        # === PHASE 2: DIRECT/QUICK RESPONSE (schnellste Option) ===
        if routing["direct"]:
            # Triage hat direkt geantwortet (kein JSON) - nutze diese Antwort
            if routing.get("direct_response"):
                return {
                    "response": routing["direct_response"],
                    "agents_used": agents_used,
                    "routing": routing,
                }
            # Triage hat JSON mit direct:true zurückgegeben
            # Nutze AURAContextPilotQuick für schnelle, einfache Antworten
            agents_used.append("AURAContextPilotQuick")
            async with AzureAIClient(
                credential=credential,
                project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
                model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
                agent_name=AURA_QUICK_AGENT_NAME,
                use_latest_version=True,
            ).create_agent() as quick_agent:
                quick_result = await quick_agent.run(prompt)
                return {
                    "response": quick_result.text,
                    "agents_used": agents_used,
                    "routing": routing,
                }
        
        # === PHASE 3: AGENT-AUFRUFE ===
        web_response: str | None = None
        context_response: str | None = None
        
        # Web Agent (nur wenn benötigt)
        if routing["web"]:
            agents_used.append("AURAContextPilotWeb")
            async with AzureAIClient(
                credential=credential,
                project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
                model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
                agent_name=AURA_WEB_AGENT_NAME,
                use_latest_version=True,
            ).create_agent() as web_agent:
                web_result = await web_agent.run(prompt)
                web_response = web_result.text
        
        # Context Agent (nur wenn benötigt)
        if routing["context"]:
            agents_used.append("AURAContextPilot")
            async with AzureAIClient(
                credential=credential,
                project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
                model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
                agent_name=AURA_CONTEXT_AGENT_NAME,
                use_latest_version=True,
            ).create_agent() as context_agent:
                context_result = await context_agent.run(prompt)
                context_response = context_result.text
        
        # === PHASE 4: RESPONSE HANDLING ===
        
        # Nur EIN Agent wurde genutzt → Direkte Antwort (kein Synthesizer)
        if web_response and not context_response:
            return {
                "response": web_response,
                "agents_used": agents_used,
                "routing": routing,
            }
        
        if context_response and not web_response:
            return {
                "response": context_response,
                "agents_used": agents_used,
                "routing": routing,
            }
        
        # BEIDE Agents wurden genutzt → Synthesizer
        if web_response and context_response:
            agents_used.append("AURAContextPilotResponseSynthesizer")
            synthesis_prompt = _build_synthesis_prompt(
                prompt, web_response, context_response, routing.get("reasoning", "")
            )
            
            async with AzureAIClient(
                credential=credential,
                project_endpoint=AZURE_AI_PROJECT_ENDPOINT,
                model_deployment_name=AZURE_AI_MODEL_DEPLOYMENT_NAME,
                agent_name=AURA_SYNTHESIZER_AGENT_NAME,
                use_latest_version=True,
            ).create_agent() as synth_agent:
                synth_result = await synth_agent.run(synthesis_prompt)
                return {
                    "response": synth_result.text,
                    "agents_used": agents_used,
                    "routing": routing,
                }
        
        # Fallback: Kein Agent wurde ausgewählt (sollte nicht passieren)
        return {
            "response": f"No routing decision made. Triage reasoning: {routing.get('reasoning', 'none')}",
            "agents_used": agents_used,
            "routing": routing,
        }


def _build_synthesis_prompt(
    original_prompt: str,
    web_response: str,
    context_response: str,
    reasoning: str
) -> str:
    """Erstellt den Prompt für den Synthesizer."""
    return f"""Synthesize the following agent responses into one coherent answer.

ORIGINAL QUESTION:
{original_prompt}

ROUTING REASONING:
{reasoning}

=== RESPONSE FROM WEB AGENT ===
{web_response}

=== RESPONSE FROM CONTEXT AGENT ===
{context_response}

INSTRUCTIONS:
- Combine insights from both sources
- Highlight agreements and differences
- Provide a clear, actionable answer
- Include relevant sources/references
"""
```

---

## 3. Azure Function - function_app.py

**Pfad:** `contextpilot-mfa-function/function_app.py`

**Aufgabe:**
- HTTP-Trigger für Azure Function
- `/api/healthz` - Health-Check Endpoint
- `/api/mfa` - MFA-Workflow Endpoint
- Lazy Import Pattern (verhindert "0 Functions" Problem)

```python
"""Azure Function HTTP Trigger für CONTEXTPILOT MFA."""

from __future__ import annotations

import json
import logging
import uuid

import azure.functions as func

# SECURITY: AuthLevel.FUNCTION erfordert x-functions-key Header oder ?code= Parameter
# Lokal: Azure Functions Core Tools ignoriert dies standardmäßig
# Azure: Proxy muss MFA_X_FUNCTION_KEY in App Settings haben
app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


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
    """HTTP Endpoint für MFA-Anfragen.

    Request Body:
        { "prompt": "..." }

    Response:
        { "output_text": "...", "workflow": "mfa" }
    """

    correlation_id = req.headers.get("x-correlation-id") or str(uuid.uuid4())

    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )

    prompt = (body or {}).get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return func.HttpResponse(
            json.dumps({"error": "Missing 'prompt' in request body"}),
            status_code=400,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )

    try:
        # Lazy import: verhindert, dass Worker-Indexing bei ImportError komplett ausfällt
        from mfa_workflow import run_mfa_workflow

        result = await run_mfa_workflow(prompt)
        return func.HttpResponse(
            json.dumps({
                "output_text": result["response"],
                "workflow": "mfa",
                "agents_used": result["agents_used"],
                "routing": {
                    "direct": result["routing"].get("direct", False),
                    "web": result["routing"].get("web", False),
                    "context": result["routing"].get("context", False),
                    "reasoning": result["routing"].get("reasoning", ""),
                },
            }),
            status_code=200,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e), "hint": "Check Azure Function logs for details"}),
            status_code=500,
            mimetype="application/json",
            headers={"x-correlation-id": correlation_id},
        )
```

---

## 4. Azure Function - requirements.txt

**Pfad:** `contextpilot-mfa-function/requirements.txt`

**Aufgabe:**
- Python-Abhängigkeiten für Azure Function
- Version-Pinning für reproduzierbare Deployments
- Microsoft Agent Framework (MAF) SDK

```text
# Azure Functions Runtime
azure-functions==1.13.3

# Microsoft Agent Framework (MAF) – Pin auf eine getestete Version
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

# Pydantic is pulled in by agent-framework-core. On Python 3.12, very old
# pydantic-core versions do not have wheels and trigger a Rust build.
# Keep us on a wheel-supported baseline.
pydantic>=2.6.0,<3
typing-extensions==4.12.2
```

---

## 5. Proxy Server - proxy-server.js (Auszüge)

**Pfad:** `live-transcriber/proxy-server.js`

**Aufgabe:**
- WebSocket-Proxy für OpenAI Realtime API
- HTTP-Routing für Agents, Workflows, MFA
- Azure AD Authentifizierung
- MFA-Request-Handling mit Fallback

### 5.1 MFA Configuration Loading

```javascript
// MFA configs (Azure Function-backed MAF orchestration) - optional and fully additive
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
      endpoint: process.env[`MFA_${i}_ENDPOINT`],
      functionKey: process.env[`MFA_${i}_FUNCTION_KEY`] || null,
      fallbackWorkflowId: process.env[`MFA_${i}_FALLBACK_WORKFLOW_ID`]
        ? parseInt(process.env[`MFA_${i}_FALLBACK_WORKFLOW_ID`], 10)
        : null,
      type: "mfa",
    };
    i++;
  }
  return mfas;
}
```

### 5.2 Agent Request Routing

```javascript
// Handle Agent API Request - NEW Microsoft Foundry Responses API (November 2025+)
async function handleAgentRequest(req, res, body) {
  const agent = getCurrentAgent();

  // Route to MFA handler if it's an MFA
  if (agent.type === "mfa") {
    return handleMFARequest(req, res, body, agent);
  }
  
  // Route to workflow handler if it's a workflow
  if (agent.type === "workflow") {
    return handleWorkflowRequest(req, res, body, agent);
  }
  
  // ... regular agent handling
}
```

### 5.3 MFA Request Handler

```javascript
// Handle MFA (Azure Function-backed) Request - fully additive path
async function handleMFARequest(req, res, body, mfaConfig) {
  console.log(`[MFA] Request for: ${mfaConfig.label}`);

  const correlationId =
    (req?.headers && (req.headers["x-correlation-id"] || req.headers["X-Correlation-Id"])) ||
    randomUUID();

  if (!mfaConfig.endpoint) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "MFA endpoint not configured",
        hint: `Set MFA_${Math.abs(mfaConfig.id + 100)}_ENDPOINT in .env.local`,
      })
    );
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

  console.log("[MFA] Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
  console.log("[MFA] Forwarding to Azure Function:", mfaConfig.endpoint);

  const timeoutMs = parseInt(process.env.MFA_PROXY_TIMEOUT_MS || "200000", 10);
  // No retries - Rate Limit ist 50k TPM, Retries verschlimmern das Problem
  const maxRetries = 0;

  const headers = {
    "Content-Type": "application/json",
    "x-correlation-id": correlationId,
  };
  if (mfaConfig.functionKey) {
    headers["x-functions-key"] = mfaConfig.functionKey;
  }

  const resp = await fetch(mfaConfig.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });

  const result = await resp.json();
  console.log("[MFA] Agents used:", result.agents_used);
  console.log("[MFA] Routing:", JSON.stringify(result.routing));

  res.setHeader("x-correlation-id", correlationId);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    output_text: result.output_text,
    workflow: "mfa",
    agents_used: result.agents_used || [],
    routing: result.routing || {},
  }));
}
```

---

## 6. Frontend Hook - useAuraAgent.ts (Auszüge)

**Pfad:** `live-transcriber/src/hooks/useAuraAgent.ts`

**Aufgabe:**
- React Hook für Agent-Kommunikation
- Verarbeitung von MFA-Routing-Metadaten
- Follow-Up Fragen Management
- Rate-Limit Handling

### 6.1 TypeScript Interfaces

```typescript
export interface AuraRouting {
  direct: boolean;
  web: boolean;
  context: boolean;
  reasoning: string;
}

export interface AuraResponse {
  id: string;              // Eindeutige ID für diese Antwort
  highlightId: string;     // Verknüpfung zum Highlight
  sourceText: string;      // Der markierte Text
  color: HighlightColor;   // Farbe (gleich wie Highlight)
  queryType: "expand" | "facts" | "full";
  taskLabel: string;       // z.B. "Show more details"
  taskDetail?: string;     // z.B. Custom instruction Text
  loading: boolean;
  result: string | null;
  error: string | null;
  anchorTop: number;       // Y-Position des zugehörigen Highlights
  statusNote?: string;     // z.B. Rate-Limit Hinweis
  prompt: string;
  sourceGroupId: string;   // GroupId wo das Highlight liegt
  insertAfterResponseId?: string;
  followUps: AuraFollowUp[];
  // MFA Routing-Metadaten
  agentsUsed?: string[];
  routing?: AuraRouting;
}
```

### 6.2 Agent Query Function

```typescript
const queryAgent = useCallback(async (
  prompt: string,
  highlightId: string,
  sourceText: string,
  color: HighlightColor,
  anchorTop: number,
  queryType: "expand" | "facts" | "full" = "expand",
  sourceGroupId: string = "",
  insertAfterResponseId?: string,
  taskLabel?: string,
  taskDetail?: string
) => {
  if (!prompt) return;

  const responseId = generateId();
  const abortController = new AbortController();
  abortControllersRef.current.set(responseId, abortController);

  // ... response initialization ...

  const resp = await fetch(`${proxyBaseUrl}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, stream: true }),
    signal: abortController.signal,
  });

  // Rate-limit handling with retries
  if (resp.status === 429) {
    const retryAfterHeader = resp.headers.get("retry-after");
    // ... retry logic ...
  }

  // Process response and extract MFA metadata
  const result = await resp.json();
  // result.agents_used, result.routing available for MFA responses
}, []);
```

---

## Anhang: Umgebungsvariablen

### Azure Function (local.settings.json)

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "AzureWebJobsStorage": "",
    "AZURE_AI_PROJECT_ENDPOINT": "https://...",
    "AZURE_AI_MODEL_DEPLOYMENT_NAME": "gpt-4o",
    "AURA_TRIAGE_AGENT_NAME": "AURATriage",
    "AURA_QUICK_AGENT_NAME": "AURAContextPilotQuick",
    "AURA_WEB_AGENT_NAME": "AURAContextPilotWeb",
    "AURA_CONTEXT_AGENT_NAME": "AURAContextPilot",
    "AURA_SYNTHESIZER_AGENT_NAME": "AURAContextPilotResponseSynthesizer"
  }
}
```

### Proxy Server (.env.local)

```env
# MFA Configuration
MFA_1_NAME=MFA
MFA_1_LABEL=MFA (Multi-Agent)
MFA_1_ENDPOINT=http://localhost:7071/api/mfa
MFA_1_FALLBACK_WORKFLOW_ID=-1

# Default to MFA
DEFAULT_AGENT=-101
```

---

*Ende des Code-Reference-Dokuments*
