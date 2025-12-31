// Einfacher WebSocket-Proxy für OpenAI Realtime API
// Umgeht Browser-Limitation (keine Custom Headers in WS)

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "crypto";

// Get directory of current file for relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnvFileRelative(filename) {
  const envPath = join(__dirname, filename);
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const eq = line.indexOf("=");
    if (eq <= 0) return;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
  console.log(`Loaded ${filename} from:`, envPath);
}

// Lade .env.local ZUERST (vor Application Insights Initialisierung!)
try {
  loadEnvFileRelative(".env.local");
} catch (e) {
  console.log("Keine .env.local gefunden, nutze Umgebungsvariablen");
}

try {
  loadEnvFileRelative(".env.local.maf");
} catch (e) {
  // optional
}

// Application Insights für strukturiertes Logging (Phase 1)
// WICHTIG: Muss NACH dem Laden von .env.local erfolgen!
let appInsights = null;
try {
  const ai = await import("applicationinsights");
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (connectionString && !connectionString.includes("REPLACE_WITH")) {
    ai.default.setup(connectionString)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .start();
    appInsights = ai.default.defaultClient;
    console.log("[AppInsights] Initialized successfully");
  } else {
    console.log("[AppInsights] No valid connection string, logging to console only");
  }
} catch (e) {
  console.log("[AppInsights] Module not available, logging to console only:", e.message);
}

// Helper: Log to Application Insights (or console fallback)
function trackTranscriptEvent(name, properties) {
  const logData = { event: name, ...properties, timestamp: Date.now() };
  console.log(`[TRANSCRIPT_LOG] ${name}`, JSON.stringify(logData));
  if (appInsights) {
    appInsights.trackEvent({ name: `transcript.${name}`, properties: logData });
  }
}

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const PORT = parseInt(process.env.PORT || "8080", 10);

// OpenAI Realtime Transcription model override (OpenAI provider only)
// IMPORTANT: Do not affect Azure OpenAI transcription flows.
// Note: Dated snapshots like "gpt-4o-mini-transcribe-2025-12-15" are documented for /v1/audio/transcriptions.
// Realtime intent=transcription may not support all snapshots; we therefore keep a fallback chain.
const OPENAI_TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe-2025-12-15";
const OPENAI_TRANSCRIBE_MODEL_FALLBACKS = (
  process.env.OPENAI_TRANSCRIBE_MODEL_FALLBACKS || "gpt-4o-mini-transcribe,gpt-4o-transcribe"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const OPENAI_TRANSCRIBE_MODEL_CANDIDATES = Array.from(
  new Set([OPENAI_TRANSCRIBE_MODEL, ...OPENAI_TRANSCRIBE_MODEL_FALLBACKS])
);

// Azure OpenAI Transcription Configuration (for gpt-4o-transcribe-diarize)
const AZURE_TRANSCRIBE_ENDPOINT = process.env.AZURE_TRANSCRIBE_ENDPOINT;
const AZURE_TRANSCRIBE_DEPLOYMENT = process.env.AZURE_TRANSCRIBE_DEPLOYMENT || "gpt-4o-transcribe-diarize";
const AZURE_TRANSCRIBE_API_KEY = process.env.AZURE_TRANSCRIBE_API_KEY;
const AZURE_TRANSCRIBE_API_VERSION = process.env.AZURE_TRANSCRIBE_API_VERSION || "2024-12-01-preview";

// Azure AI Foundry Agent Configuration (NEW Foundry API - November 2025+)
// Supports multiple agents configured in .env.local
const AURA_API_VERSION = process.env.AURA_API_VERSION || "2025-11-15-preview";

// Parse all configured agents from environment
function loadAgents() {
  const agents = {};
  let i = 1;
  while (process.env[`AGENT_${i}_NAME`]) {
    agents[i] = {
      id: i,
      name: process.env[`AGENT_${i}_NAME`],
      label: process.env[`AGENT_${i}_LABEL`] || process.env[`AGENT_${i}_NAME`],
      endpoint: process.env[`AGENT_${i}_ENDPOINT`],
      apiKey: process.env[`AGENT_${i}_API_KEY`] || null,
      type: "agent"  // Mark as regular agent
    };
    i++;
  }
  return agents;
}

// Parse all configured workflows from environment
// Workflows need conversation management (stateful)
function loadWorkflows() {
  const workflows = {};
  let i = 1;
  while (process.env[`WORKFLOW_${i}_NAME`]) {
    // Use negative IDs for workflows to distinguish from agents
    const workflowId = -i;
    workflows[workflowId] = {
      id: workflowId,
      name: process.env[`WORKFLOW_${i}_NAME`],
      label: process.env[`WORKFLOW_${i}_LABEL`] || process.env[`WORKFLOW_${i}_NAME`],
      endpoint: process.env[`WORKFLOW_${i}_ENDPOINT`],
      apiKey: process.env[`WORKFLOW_${i}_API_KEY`] || null,
      type: "workflow"  // Mark as workflow - needs conversation
    };
    i++;
  }
  return workflows;
}

const AGENTS = loadAgents();
const WORKFLOWS = loadWorkflows();

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
      // Optional: fallback to an existing workflow (negative workflow ID)
      // Example: MFA_1_FALLBACK_WORKFLOW_ID=-1
      fallbackWorkflowId: process.env[`MFA_${i}_FALLBACK_WORKFLOW_ID`]
        ? parseInt(process.env[`MFA_${i}_FALLBACK_WORKFLOW_ID`], 10)
        : null,
      type: "mfa",
    };
    i++;
  }
  return mfas;
}

const MFAS = loadMFAConfigs();
// Default: MFA if available (first MFA is -101), otherwise first agent (1)
const DEFAULT_AGENT_ID = parseInt(process.env.DEFAULT_AGENT || "-101", 10);

// Legacy fallback für alte Konfiguration
const LEGACY_ENDPOINT = process.env.AURA_ENDPOINT;
const LEGACY_AGENT_NAME = process.env.AURA_AGENT_NAME || "AURAContext";
const LEGACY_API_KEY = process.env.AURA_API_KEY;

// Current active agent (can be changed via API)
let currentAgentId = DEFAULT_AGENT_ID;

// Get current selection (agent or workflow)
function getCurrentAgent() {
  // Check if it's an MFA (IDs ab -100)
  if (currentAgentId <= -100 && MFAS[currentAgentId]) {
    return MFAS[currentAgentId];
  }
  // Check if it's a workflow (negative ID)
  if (currentAgentId < 0 && WORKFLOWS[currentAgentId]) {
    return WORKFLOWS[currentAgentId];
  }
  // Check if it's an agent
  if (AGENTS[currentAgentId]) {
    return { ...AGENTS[currentAgentId], type: "agent" };
  }
  // Fallback to legacy config
  return {
    id: 0,
    name: LEGACY_AGENT_NAME,
    label: LEGACY_AGENT_NAME,
    endpoint: LEGACY_ENDPOINT,
    apiKey: LEGACY_API_KEY,
    type: "agent"
  };
}

if (!OPENAI_API_KEY) {
  console.error("ERROR: Kein API Key gefunden in .env.local oder Umgebungsvariablen");
  process.exit(1);
}

console.log("API Key gefunden:", OPENAI_API_KEY.substring(0, 10) + "...");
console.log("\n=== Configured Agents ===");
Object.values(AGENTS).forEach(agent => {
  console.log(`  [${agent.id}] ${agent.label} (${agent.name})`);
  console.log(`      Endpoint: ${agent.endpoint}`);
  console.log(`      Auth: ${agent.apiKey ? 'API Key' : 'Azure AD'}`);
});
console.log("\n=== Configured Workflows ===");
Object.values(WORKFLOWS).forEach(wf => {
  console.log(`  [${wf.id}] ${wf.label} (${wf.name})`);
  console.log(`      Endpoint: ${wf.endpoint}`);
  console.log(`      Auth: ${wf.apiKey ? 'API Key' : 'Azure AD'}`);
  console.log(`      Note: Workflows create conversation automatically`);
});

console.log("\n=== Configured MFA Options ===");
Object.values(MFAS).forEach(mfa => {
  console.log(`  [${mfa.id}] ${mfa.label} (${mfa.name})`);
  console.log(`      Endpoint: ${mfa.endpoint || "(not set)"}`);
  console.log(`      Auth: ${mfa.functionKey ? "Function Key" : "(none)"}`);
});
console.log(`\nDefault Agent: [${DEFAULT_AGENT_ID}] ${AGENTS[DEFAULT_AGENT_ID]?.label || LEGACY_AGENT_NAME}`);
console.log("AURA API Version:", AURA_API_VERSION);

// Azure Credential für Managed Identity Auth
const credential = new DefaultAzureCredential({
  excludeEnvironmentCredential: !process.env.AZURE_TENANT_ID,
});

// Get auth header - prefer API key if configured, else Azure AD
async function getAuraAuthHeader(agent = null) {
  const activeAgent = agent || getCurrentAgent();
  
  if (activeAgent.apiKey) {
    console.log(`[AURA] Using API Key authentication for ${activeAgent.name}`);
    return { "api-key": activeAgent.apiKey };
  }
  
  try {
    console.log(`[AURA] Acquiring Azure AD token for ${activeAgent.name}...`);
    // Azure AI Foundry requires https://ai.azure.com audience
    const scope = "https://ai.azure.com/.default";
    const token = await credential.getToken(scope);
    if (!token) throw new Error("Failed to acquire token for Azure AI");
    console.log("[AURA] Token acquired successfully");
    return { Authorization: `Bearer ${token.token}` };
  } catch (err) {
    console.error("[AURA] Token acquisition failed:", err.message);
    throw err;
  }
}

// API: List available agents AND workflows
function listAgentsAPI(req, res) {
  const agentList = Object.values(AGENTS).map(a => ({
    id: a.id,
    name: a.name,
    label: a.label,
    type: "agent",
    active: a.id === currentAgentId
  }));
  
  const workflowList = Object.values(WORKFLOWS).map(w => ({
    id: w.id,
    name: w.name,
    label: w.label,
    type: "workflow",
    active: w.id === currentAgentId
  }));

  const mfaList = Object.values(MFAS).map(m => ({
    id: m.id,
    name: m.name,
    label: m.label,
    type: "mfa",
    active: m.id === currentAgentId
  }));
  
  res.writeHead(200, { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify({ 
    agents: agentList,
    workflows: workflowList,
    mfas: mfaList,
    currentAgentId,
    apiVersion: AURA_API_VERSION
  }));
}

// API: Switch active agent or workflow
function switchAgentAPI(req, res, body) {
  try {
    const { agentId } = JSON.parse(body || "{}");
    
    // Check if it's a valid agent, workflow, or MFA
    const isAgent = agentId > 0 && AGENTS[agentId];
    const isMfa = agentId <= -100 && MFAS[agentId];
    const isWorkflow = agentId < 0 && !isMfa && WORKFLOWS[agentId];

    if (!agentId || (!isAgent && !isWorkflow && !isMfa)) {
      res.writeHead(400, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ 
        error: "Invalid agent/workflow/mfa ID",
        availableAgents: Object.keys(AGENTS).map(Number),
        availableWorkflows: Object.keys(WORKFLOWS).map(Number),
        availableMfas: Object.keys(MFAS).map(Number)
      }));
      return;
    }
    
    currentAgentId = agentId;
    const selection = isAgent ? AGENTS[agentId] : isMfa ? MFAS[agentId] : WORKFLOWS[agentId];
    const selectionType = isAgent ? "agent" : isMfa ? "mfa" : "workflow";
    console.log(`[AURA] Switched to ${selectionType} [${agentId}] ${selection.label}`);
    
    res.writeHead(200, { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ 
      success: true,
      currentAgent: {
        id: selection.id,
        name: selection.name,
        label: selection.label,
        type: selectionType
      }
    }));
  } catch (e) {
    res.writeHead(400, { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// List all assistants for debugging
async function listAssistants(req, res) {
  console.log("[AURA] Listing assistants...");
  
  if (!AURA_ENDPOINT) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "AURA_ENDPOINT not configured" }));
    return;
  }
  
  try {
    const authHeader = await getAuraAuthHeader();
    const urlBase = AURA_ENDPOINT.replace(/\/$/, "");
    
    const resp = await fetch(`${urlBase}/assistants?api-version=${AURA_API_VERSION}`, {
      method: "GET",
      headers: { 
        "Content-Type": "application/json",
        ...authHeader 
      }
    });
    
    const text = await resp.text();
    console.log("[AURA] Assistants response:", text.substring(0, 500));
    
    res.writeHead(resp.status, { "Content-Type": "application/json" });
    res.end(text);
    
  } catch (err) {
    console.error("[AURA] List assistants error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err?.message }));
  }
}

// Handle Agent API Request - NEW Microsoft Foundry Responses API (November 2025+)
// Uses: POST /openai/responses with agent_reference by NAME
// Supports STREAMING for faster response times
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
  
  console.log(`[AURA] Received agent request for: ${agent.label}`);
  
  if (!agent.endpoint) {
    console.error("[AURA] No endpoint configured for agent:", agent.name);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: "Agent endpoint not configured",
      hint: `Set AGENT_${agent.id}_ENDPOINT in .env.local`
    }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (e) {
    console.error("[AURA] Invalid JSON payload:", e.message);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON payload" }));
    return;
  }

  const prompt = payload.prompt;
  const conversationId = payload.conversationId; // Optional: for multi-turn
  // Disable streaming for now - Azure AI Foundry Responses API with agents 
  // uses a different format, and the main latency comes from file_search anyway
  const useStreaming = false;
  
  if (!prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'prompt' in request body" }));
    return;
  }

  console.log("[AURA] Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
  console.log("[AURA] Using agent:", agent.name, `(${agent.label})`);
  console.log("[AURA] Endpoint:", agent.endpoint);
  console.log("[AURA] Streaming:", useStreaming);

  const urlBase = agent.endpoint.replace(/\/$/, "");
  const url = `${urlBase}/openai/responses?api-version=${AURA_API_VERSION}`;
  
  console.log("[AURA] Request URL:", url);

  // NEW Foundry API format - uses agent_reference with NAME (not ID!)
  const requestBody = {
    agent: {
      type: "agent_reference",
      name: agent.name
    },
    input: prompt,
    stream: useStreaming
  };
  
  // Optional: Include conversation ID for multi-turn conversations
  if (conversationId) {
    requestBody.conversation = conversationId;
  }

  console.log("[AURA] Request body:", JSON.stringify(requestBody, null, 2));

  try {
    const authHeader = await getAuraAuthHeader(agent);
    
    const resp = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...authHeader 
      },
      body: JSON.stringify(requestBody),
    });
    
    console.log("[AURA] Response status:", resp.status);
    
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[AURA] Error response:", text);
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Agent call failed", 
        status: resp.status, 
        body: text
      }));
      return;
    }
    
    // STREAMING MODE: Forward SSE events to client
    if (useStreaming) {
      res.writeHead(200, { 
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      
      let fullText = "";
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          
          // Parse SSE events from chunk
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                // Send final complete message
                res.write(`data: ${JSON.stringify({ done: true, output_text: fullText })}\n\n`);
                continue;
              }
              
              try {
                const event = JSON.parse(data);
                
                // Extract text delta from streaming response
                // Format varies - check for response.output_text.delta or delta.content
                let delta = "";
                if (event.type === "response.output_text.delta") {
                  delta = event.delta || "";
                } else if (event.delta?.content) {
                  delta = event.delta.content;
                } else if (event.choices?.[0]?.delta?.content) {
                  delta = event.choices[0].delta.content;
                }
                
                if (delta) {
                  fullText += delta;
                  res.write(`data: ${JSON.stringify({ delta, partial: fullText })}\n\n`);
                }
              } catch (parseErr) {
                // Not JSON or different format, forward raw
                console.log("[AURA] Stream chunk:", data.substring(0, 100));
              }
            }
          }
        }
      } catch (streamErr) {
        console.error("[AURA] Stream error:", streamErr);
      }
      
      res.end();
      console.log("[AURA] Streaming complete, total length:", fullText.length);
      return;
    }
    
    // NON-STREAMING MODE: Wait for complete response
    const text = await resp.text();
    const isJson = resp.headers.get("content-type")?.includes("application/json");
    
    console.log("[AURA] Response:", text.substring(0, 500) + (text.length > 500 ? "..." : ""));
    if (isJson) {
      const responseData = JSON.parse(text);
      
      // New Foundry API: Find the message output (not file_search_call)
      // Output array can contain multiple items: file_search_call, message, etc.
      let outputText = responseData.output_text;
      
      if (!outputText && responseData.output) {
        // Find the message type output
        const messageOutput = responseData.output.find(o => o.type === "message");
        if (messageOutput?.content) {
          // Find the text content
          const textContent = messageOutput.content.find(c => c.type === "output_text" || c.type === "text");
          outputText = textContent?.text || textContent?.value;
        }
      }
      
      // Fallback to first content if not found
      if (!outputText) {
        outputText = responseData.output?.[0]?.content?.[0]?.text || JSON.stringify(responseData);
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        output_text: outputText,
        conversation_id: responseData.conversation?.id || responseData.conversation,
        raw: responseData
      }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output_text: text }));
    }
    
  } catch (err) {
    console.error("[AURA] Request error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: err?.message || "Agent request failed",
      hint: "Check AURA_ENDPOINT, AURA_AGENT_NAME and authentication settings"
    }));
  }
}

// Handle Workflow API Request - Workflows need a conversation first!
// Learned: Workflows are stateful and require:
// 1. Create a conversation: POST /openai/conversations
// 2. Call workflow with conversation: POST /openai/responses with conversation.id
async function handleWorkflowRequest(req, res, body, workflow) {
  console.log(`[WORKFLOW] Received workflow request for: ${workflow.label}`);
  
  if (!workflow.endpoint) {
    console.error("[WORKFLOW] No endpoint configured for workflow:", workflow.name);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: "Workflow endpoint not configured",
      hint: `Set WORKFLOW_${Math.abs(workflow.id)}_ENDPOINT in .env.local`
    }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (e) {
    console.error("[WORKFLOW] Invalid JSON payload:", e.message);
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

  console.log("[WORKFLOW] Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
  console.log("[WORKFLOW] Using workflow:", workflow.name, `(${workflow.label})`);
  console.log("[WORKFLOW] Endpoint:", workflow.endpoint);

  const urlBase = workflow.endpoint.replace(/\/$/, "");
  
  try {
    const authHeader = await getAuraAuthHeader(workflow);
    
    // STEP 1: Create a conversation (workflows are stateful!)
    console.log("[WORKFLOW] Step 1: Creating conversation...");
    const convUrl = `${urlBase}/openai/conversations?api-version=${AURA_API_VERSION}`;
    
    const convResp = await fetch(convUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...authHeader 
      },
      body: JSON.stringify({})
    });
    
    if (!convResp.ok) {
      const convError = await convResp.text();
      console.error("[WORKFLOW] Failed to create conversation:", convError);
      res.writeHead(convResp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Failed to create conversation for workflow", 
        status: convResp.status, 
        body: convError
      }));
      return;
    }
    
    const convData = await convResp.json();
    const conversationId = convData.id;
    console.log("[WORKFLOW] Conversation created:", conversationId);
    
    // STEP 2: Call the workflow with conversation
    console.log("[WORKFLOW] Step 2: Calling workflow with conversation...");
    const responseUrl = `${urlBase}/openai/responses?api-version=${AURA_API_VERSION}`;
    
    const requestBody = {
      agent: {
        type: "agent_reference",
        name: workflow.name
      },
      input: prompt,
      conversation: {
        id: conversationId
      }
    };
    
    console.log("[WORKFLOW] Request body:", JSON.stringify(requestBody, null, 2));
    
    const resp = await fetch(responseUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...authHeader 
      },
      body: JSON.stringify(requestBody),
    });
    
    console.log("[WORKFLOW] Response status:", resp.status);
    
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[WORKFLOW] Error response:", text);
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Workflow call failed", 
        status: resp.status, 
        body: text
      }));
      return;
    }
    
    // Parse response
    const text = await resp.text();
    const isJson = resp.headers.get("content-type")?.includes("application/json");
    
    console.log("[WORKFLOW] Response:", text.substring(0, 500) + (text.length > 500 ? "..." : ""));
    
    if (isJson) {
      const responseData = JSON.parse(text);
      
      // Find the final synthesized message (last message in output)
      let outputText = "";
      
      if (responseData.output && Array.isArray(responseData.output)) {
        // Find the last message type output (synthesized response)
        const messages = responseData.output.filter(o => o.type === "message");
        
        // Try to get text from the last message
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg?.content && Array.isArray(msg.content)) {
            const textContent = msg.content.find(c => c.type === "output_text" || c.type === "text");
            if (textContent?.text && textContent.text.trim()) {
              outputText = textContent.text;
              console.log(`[WORKFLOW] Found output_text in message ${i}:`, outputText.substring(0, 100));
              break;
            }
          }
        }
      }
      
      // Fallback to top-level output_text
      if (!outputText && responseData.output_text) {
        outputText = responseData.output_text;
        console.log("[WORKFLOW] Using top-level output_text");
      }
      
      // Last fallback: stringify the response (but without the raw field we'd add)
      if (!outputText) {
        outputText = "Keine Antwort vom Workflow erhalten.";
        console.log("[WORKFLOW] No output_text found, using fallback message");
      }
      
      console.log("[WORKFLOW] Final output_text:", outputText.substring(0, 200));
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        output_text: outputText,
        conversation_id: conversationId,
        workflow_name: workflow.name
      }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output_text: text }));
    }
    
  } catch (err) {
    console.error("[WORKFLOW] Request error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: err?.message || "Workflow request failed",
      hint: "Check workflow endpoint and authentication settings"
    }));
  }
}

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
  const retryBackoffMs = [];

  async function doFetch(attempt) {
    const headers = {
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
    };
    if (mfaConfig.functionKey) {
      headers["x-functions-key"] = mfaConfig.functionKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("MFA proxy timeout")), timeoutMs);
    try {
      return await fetch(mfaConfig.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function maybeFallback(err, lastStatus) {
    if (!mfaConfig.fallbackWorkflowId) return false;
    const wf = WORKFLOWS[mfaConfig.fallbackWorkflowId];
    if (!wf) {
      console.warn(
        `[MFA] Fallback workflow not found for id=${mfaConfig.fallbackWorkflowId}. Skipping fallback.`
      );
      return false;
    }

    console.warn(
      `[MFA] Falling back to workflow ${wf.name} (id=${wf.id}) due to MFA failure` +
        (lastStatus ? ` (status=${lastStatus})` : "")
    );

    // Reuse the same request body; workflow handler manages its own schema.
    // Add correlation id for consistency (as response header).
    res.setHeader("x-correlation-id", correlationId);
    return handleWorkflowRequest(req, res, body, wf);
  }

  try {
    let resp = null;
    let lastErr = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        resp = await doFetch(attempt);

        // Retry only on 5xx
        if (resp.status >= 500 && resp.status <= 599 && attempt < maxRetries) {
          const delay = retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)];
          console.warn(`[MFA] ${resp.status} from function, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await wait(delay);
          continue;
        }

        break;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          const delay = retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)];
          console.warn(`[MFA] Network/timeout error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, err?.message);
          await wait(delay);
          continue;
        }
        break;
      }
    }

    if (!resp) {
      const didFallback = await maybeFallback(lastErr, null);
      if (didFallback) return;

      res.setHeader("x-correlation-id", correlationId);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MFA request failed", hint: lastErr?.message || "Network error" }));
      return;
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[MFA] Error:", text);

      // Optional fallback on 5xx or repeated failures; do not fallback on 4xx.
      if (resp.status >= 500 && resp.status <= 599) {
        const didFallback = await maybeFallback(new Error(text), resp.status);
        if (didFallback) return;
      }

      res.setHeader("x-correlation-id", correlationId);
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MFA request failed", body: text }));
      return;
    }

    const result = await resp.json();
    console.log("[MFA] Response received, length:", result.output_text?.length);
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
  } catch (err) {
    console.error("[MFA] Request error:", err);
    const didFallback = await maybeFallback(err, null);
    if (didFallback) return;

    res.setHeader("x-correlation-id", correlationId);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err?.message || "MFA request failed" }));
  }
}

const server = createServer((req, res) => {
  const { method, url } = req;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, api-key, x-correlation-id"
  );

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Basic health/info endpoint so the root URL doesn't look broken in browsers
  if (method === "GET" && (url === "/" || url === "")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "contextpilot-proxy",
        endpoints: ["/agents", "/agents/switch", "/agent", "/ws"],
        apiVersion: AURA_API_VERSION,
      })
    );
    return;
  }

  // Avoid noisy 404s from browsers
  if (method === "GET" && url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // API: List available agents
  if (method === "GET" && url && url.startsWith("/agents")) {
    listAgentsAPI(req, res);
    return;
  }
  
  // API: Switch active agent
  if (method === "POST" && url && url.startsWith("/agents/switch")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => { switchAgentAPI(req, res, body); });
    return;
  }
  
  // List available assistants for debugging (legacy)
  if (method === "GET" && url && url.startsWith("/assistants")) {
    listAssistants(req, res);
    return;
  }
  
  if (method === "POST" && url && url.startsWith("/agent")) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      console.log("[AURA] Received chunk:", chunk.toString().substring(0, 100));
    });
    req.on("end", () => {
      console.log("[AURA] Body complete, length:", body.length, "content:", body.substring(0, 200));
      handleAgentRequest(req, res, body);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});
const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, req) => {
  // Parse query parameter to determine provider (default: openai)
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const provider = url.searchParams.get("provider") || "openai";
  // For Azure, the model parameter specifies which deployment to use
  const requestedModel = url.searchParams.get("model") || "gpt-4o-transcribe";
  
  // Generate unique session ID for this WebSocket connection (for log analysis)
  const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  
  console.log(`[PROXY] Client verbunden, Provider: ${provider}, Model: ${requestedModel}, Session: ${sessionId}`);
  
  // Log session start to Application Insights
  trackTranscriptEvent("session_start", {
    session_id: sessionId,
    provider: provider,
    model: requestedModel,
  });

  // Message-Buffer bis Backend verbunden ist
  let backendReady = false;
  const messageBuffer = [];

  // OpenAI-only transcription model override state (per client connection)
  const isOpenAIProvider = provider !== "azure";
  let openaiTranscribeModelIndex = 0;
  /** @type {any | null} */
  let lastTranscriptionSessionUpdate = null;

  const getOpenAiTranscribeModel = () =>
    OPENAI_TRANSCRIBE_MODEL_CANDIDATES[
      Math.min(openaiTranscribeModelIndex, OPENAI_TRANSCRIBE_MODEL_CANDIDATES.length - 1)
    ];

  const looksLikeInvalidModelError = (parsedMsg) => {
    const code = parsedMsg?.error?.code;
    const message = parsedMsg?.error?.message;
    if (code === "invalid_model" || code === "model_not_found") return true;
    if (typeof message === "string" && /invalid\s+model|model\s+not\s+found/i.test(message)) return true;
    return false;
  };

  const deepCloneJson = (value) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  };

  const applyOpenAiModelOverride = (sessionUpdate) => {
    if (!sessionUpdate?.session?.input_audio_transcription) return sessionUpdate;
    const overridden = typeof structuredClone === "function" ? structuredClone(sessionUpdate) : deepCloneJson(sessionUpdate);
    overridden.session.input_audio_transcription.model = getOpenAiTranscribeModel();
    return overridden;
  };
  
  // Determine backend URL and headers based on provider
  let backendUrl;
  let backendHeaders;
  let providerLabel;
  // For Azure, we use the requested model name as the deployment name
  let azureDeployment = requestedModel;
  
  if (provider === "azure") {
    // Azure OpenAI Realtime API - use the requested model as deployment name
    // Since all models share the same endpoint and API key, only the deployment name changes
    console.log("[PROXY] Azure config check:", {
      endpoint: AZURE_TRANSCRIBE_ENDPOINT,
      deployment: azureDeployment,
      apiVersion: AZURE_TRANSCRIBE_API_VERSION,
      hasApiKey: !!AZURE_TRANSCRIBE_API_KEY
    });
    if (!AZURE_TRANSCRIBE_ENDPOINT || !AZURE_TRANSCRIBE_API_KEY) {
      console.error("[PROXY] Azure Transcription not configured! Check AZURE_TRANSCRIBE_ENDPOINT and AZURE_TRANSCRIBE_API_KEY");
      clientWs.close(1011, "Azure Transcription not configured");
      return;
    }
    backendUrl = `wss://${AZURE_TRANSCRIBE_ENDPOINT}/openai/realtime?api-version=${AZURE_TRANSCRIBE_API_VERSION}&deployment=${azureDeployment}&intent=transcription`;
    backendHeaders = {
      "api-key": AZURE_TRANSCRIBE_API_KEY,
    };
    providerLabel = "Azure OpenAI";
  } else {
    // DEFAULT: OpenAI Realtime API (existing behavior - DO NOT BREAK)
    if (!OPENAI_API_KEY) {
      console.error("[PROXY] OpenAI API Key not configured!");
      clientWs.close(1011, "OpenAI API Key not configured");
      return;
    }
    backendUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
    backendHeaders = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    };
    providerLabel = "OpenAI";
  }
  
  console.log(`[PROXY] Connecting to ${providerLabel}: ${backendUrl.substring(0, 80)}...`);
  
  const backendWs = new WebSocket(backendUrl, {
    headers: backendHeaders,
  });

  backendWs.on("open", () => {
    console.log(`[PROXY] Mit ${providerLabel} verbunden`);
    backendReady = true;

    // Azure: report the actual used deployment name to the client for UI transparency.
    // This does NOT change the Azure behavior; it's informational only.
    if (provider === "azure" && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "proxy.transcription.model",
          provider: "azure",
          model: azureDeployment,
          reason: "deployment",
          timestamp: Date.now(),
        })
      );
    }
    
    // Gepufferte Messages senden
    if (messageBuffer.length > 0) {
      console.log(`[PROXY] Sende ${messageBuffer.length} gepufferte Messages`);
      messageBuffer.forEach((msg) => {
        console.log("[PROXY] Client (buffered) ->", msg.substring(0, 100) + (msg.length > 100 ? "..." : ""));
        backendWs.send(msg);
      });
      messageBuffer.length = 0;
    }
  });

  backendWs.on("message", (data) => {
    const msg = data.toString();

    // OpenAI-only: if the chosen model is unsupported, automatically fall back.
    if (isOpenAIProvider) {
      try {
        const parsed = JSON.parse(msg);
        if (
          parsed?.type === "error" &&
          looksLikeInvalidModelError(parsed) &&
          openaiTranscribeModelIndex < OPENAI_TRANSCRIBE_MODEL_CANDIDATES.length - 1 &&
          lastTranscriptionSessionUpdate &&
          backendWs.readyState === WebSocket.OPEN
        ) {
          const prevModel = getOpenAiTranscribeModel();
          openaiTranscribeModelIndex += 1;
          const nextModel = getOpenAiTranscribeModel();
          console.warn(
            `[PROXY] OpenAI model '${prevModel}' rejected; falling back to '${nextModel}'`
          );

          // Tell the client which model is now being used.
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: "proxy.transcription.model",
                provider: "openai",
                model: nextModel,
                reason: "fallback",
                candidates: OPENAI_TRANSCRIBE_MODEL_CANDIDATES,
                timestamp: Date.now(),
              })
            );
          }

          const retryUpdate = applyOpenAiModelOverride(lastTranscriptionSessionUpdate);
          backendWs.send(JSON.stringify(retryUpdate));
        }
      } catch {
        // ignore non-JSON payloads
      }
    }

    // PHASE 1: Strukturiertes Logging für Transkription-Events (Application Insights)
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.type === "conversation.item.input_audio_transcription.delta") {
        trackTranscriptEvent("delta", {
          session_id: sessionId,
          provider: providerLabel,
          item_id: parsed.item_id,
          content_index: parsed.content_index ?? 0,
          delta_length: parsed.delta?.length ?? 0,
        });
      } else if (parsed?.type === "conversation.item.input_audio_transcription.completed") {
        trackTranscriptEvent("completed", {
          session_id: sessionId,
          provider: providerLabel,
          item_id: parsed.item_id,
          content_index: parsed.content_index ?? 0,
          transcript_length: parsed.transcript?.length ?? 0,
        });
      } else if (parsed?.type === "input_audio_buffer.committed") {
        trackTranscriptEvent("committed", {
          session_id: sessionId,
          provider: providerLabel,
          item_id: parsed.item_id,
          previous_item_id: parsed.previous_item_id ?? null,
        });
      }
    } catch {
      // ignore non-JSON payloads
    }

    // Log full message for transcription failures to see the error details
    if (msg.includes('transcription.failed')) {
      console.log(`[PROXY] ${providerLabel} TRANSCRIPTION FAILED:`, msg);
      trackTranscriptEvent("failed", { session_id: sessionId, provider: providerLabel, raw: msg.substring(0, 500) });
    }
    // Only log non-audio events (skip verbose audio buffer responses)
    else if (!msg.includes('"type":"input_audio_buffer')) {
      console.log(`[PROXY] ${providerLabel} ->`, msg.substring(0, 150) + (msg.length > 150 ? "..." : ""));
    }
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(msg);
    }
  });

  backendWs.on("error", (err) => {
    console.error(`[PROXY] ${providerLabel} Fehler:`, err.message);
    clientWs.close(1011, `${providerLabel} connection error`);
  });

  backendWs.on("close", (code, reason) => {
    console.log(`[PROXY] ${providerLabel} geschlossen:`, code, reason.toString());
    clientWs.close(code, reason.toString());
  });

  clientWs.on("message", (data) => {
    let msg = data.toString();
    // Only log non-audio messages (skip verbose audio buffer appends)
    if (!msg.includes('"type":"input_audio_buffer.append"')) {
      console.log("[PROXY] Client ->", msg.substring(0, 100) + (msg.length > 100 ? "..." : ""));
    }

    // OpenAI-only: override transcription model on session update messages.
    if (isOpenAIProvider) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.type === "transcription_session.update") {
          // Keep the user's original session update as a template for retries.
          lastTranscriptionSessionUpdate = parsed;

          const overridden = applyOpenAiModelOverride(parsed);
          const desiredModel = overridden?.session?.input_audio_transcription?.model;
          if (desiredModel) {
            msg = JSON.stringify(overridden);
            console.log(`[PROXY] OpenAI session model override -> ${desiredModel}`);

            // Tell the client which model we are sending to OpenAI right now.
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: "proxy.transcription.model",
                  provider: "openai",
                  model: desiredModel,
                  reason: "override",
                  candidates: OPENAI_TRANSCRIBE_MODEL_CANDIDATES,
                  timestamp: Date.now(),
                })
              );
            }
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
    
    if (backendReady && backendWs.readyState === WebSocket.OPEN) {
      backendWs.send(msg);
    } else {
      // Puffern bis Backend bereit
      console.log(`[PROXY] ${providerLabel} noch nicht bereit, puffere Message`);
      messageBuffer.push(msg);
    }
  });

  clientWs.on("close", () => {
    console.log("[PROXY] Client getrennt");
    backendWs.close();
  });

  clientWs.on("error", (err) => {
    console.error("[PROXY] Client Fehler:", err.message);
    backendWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`[PROXY] WebSocket Proxy läuft auf ws://localhost:${PORT}`);
  console.log("[PROXY] Provider via Query-Parameter: ?provider=openai (default) oder ?provider=azure");
  console.log("[PROXY] Die Vite-App muss auf diesen Proxy zeigen statt direkt auf OpenAI");
});
