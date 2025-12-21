// Einfacher WebSocket-Proxy für OpenAI Realtime API
// Umgeht Browser-Limitation (keine Custom Headers in WS)

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DefaultAzureCredential } from "@azure/identity";

// Get directory of current file for relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lade .env.local manuell (relative to this file)
try {
  const envPath = join(__dirname, ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) {
      process.env[key.trim()] = vals.join("=").trim();
    }
  });
  console.log("Loaded .env.local from:", envPath);
} catch (e) {
  console.log("Keine .env.local gefunden, nutze Umgebungsvariablen");
}

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const PORT = parseInt(process.env.PORT || "8080", 10);

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
const DEFAULT_AGENT_ID = parseInt(process.env.DEFAULT_AGENT || "1", 10);

// Legacy fallback für alte Konfiguration
const LEGACY_ENDPOINT = process.env.AURA_ENDPOINT;
const LEGACY_AGENT_NAME = process.env.AURA_AGENT_NAME || "AURAContext";
const LEGACY_API_KEY = process.env.AURA_API_KEY;

// Current active agent (can be changed via API)
let currentAgentId = DEFAULT_AGENT_ID;

// Get current selection (agent or workflow)
function getCurrentAgent() {
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
  
  res.writeHead(200, { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify({ 
    agents: agentList,
    workflows: workflowList,
    currentAgentId,
    apiVersion: AURA_API_VERSION
  }));
}

// API: Switch active agent or workflow
function switchAgentAPI(req, res, body) {
  try {
    const { agentId } = JSON.parse(body || "{}");
    
    // Check if it's a valid agent or workflow
    const isAgent = agentId > 0 && AGENTS[agentId];
    const isWorkflow = agentId < 0 && WORKFLOWS[agentId];
    
    if (!agentId || (!isAgent && !isWorkflow)) {
      res.writeHead(400, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ 
        error: "Invalid agent/workflow ID",
        availableAgents: Object.keys(AGENTS).map(Number),
        availableWorkflows: Object.keys(WORKFLOWS).map(Number)
      }));
      return;
    }
    
    currentAgentId = agentId;
    const selection = isAgent ? AGENTS[agentId] : WORKFLOWS[agentId];
    const selectionType = isAgent ? "agent" : "workflow";
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

const server = createServer((req, res) => {
  const { method, url } = req;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, api-key");

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
  
  console.log(`[PROXY] Client verbunden, Provider: ${provider}`);

  // Message-Buffer bis Backend verbunden ist
  let backendReady = false;
  const messageBuffer = [];
  
  // Determine backend URL and headers based on provider
  let backendUrl;
  let backendHeaders;
  let providerLabel;
  
  if (provider === "azure") {
    // Azure OpenAI Realtime API for gpt-4o-transcribe-diarize
    console.log("[PROXY] Azure config check:", {
      endpoint: AZURE_TRANSCRIBE_ENDPOINT,
      deployment: AZURE_TRANSCRIBE_DEPLOYMENT,
      apiVersion: AZURE_TRANSCRIBE_API_VERSION,
      hasApiKey: !!AZURE_TRANSCRIBE_API_KEY
    });
    if (!AZURE_TRANSCRIBE_ENDPOINT || !AZURE_TRANSCRIBE_API_KEY) {
      console.error("[PROXY] Azure Transcription not configured! Check AZURE_TRANSCRIBE_ENDPOINT and AZURE_TRANSCRIBE_API_KEY");
      clientWs.close(1011, "Azure Transcription not configured");
      return;
    }
    backendUrl = `wss://${AZURE_TRANSCRIBE_ENDPOINT}/openai/realtime?api-version=${AZURE_TRANSCRIBE_API_VERSION}&deployment=${AZURE_TRANSCRIBE_DEPLOYMENT}&intent=transcription`;
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
    // Log full message for transcription failures to see the error details
    if (msg.includes('transcription.failed')) {
      console.log(`[PROXY] ${providerLabel} TRANSCRIPTION FAILED:`, msg);
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
    const msg = data.toString();
    // Only log non-audio messages (skip verbose audio buffer appends)
    if (!msg.includes('"type":"input_audio_buffer.append"')) {
      console.log("[PROXY] Client ->", msg.substring(0, 100) + (msg.length > 100 ? "..." : ""));
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
