"""CONTEXTPILOT MFA Workflow v2.5 (MAF, Python)

Aktueller Stand: Sequenzielle Agent-Orchestrierung mit Triage-Routing
Endziel: Parallele Ausführung via MAF WorkflowBuilder (Fan-Out/Fan-In)

Pattern:
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
    """Führt den MFA-Workflow aus (aktuell sequenziell, Endziel: parallel).
    
    Ablauf:
    1. Triage entscheidet Routing (direct/web/context)
    2. Bei "direct": Sofortige Antwort ohne weitere Agents
    3. Bei einem Agent: Nur diesen aufrufen, Antwort direkt zurückgeben
    4. Bei beiden Agents: Sequenziell aufrufen (TODO: parallel), dann Synthesizer
    
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
