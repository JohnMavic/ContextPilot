# Azure Deployment Guide (ContextPilot)

This repo contains a Vite/React frontend and a Node.js proxy server that bridges browser audio/WebSockets to the OpenAI / Azure OpenAI Realtime transcription APIs, plus optional integration to Azure AI Foundry Agents/Workflows.

This guide documents how the project was ported to Azure:

- **Frontend**: Azure Static Web Apps (SWA)
- **Proxy**: Azure App Service (Linux, Node 22)
- **Foundry**: Azure AI Foundry (AIServices) + **Managed Identity** + **Azure RBAC**

> **No secrets in this document.** It references variable/setting **names** only.

---

## 1) Architecture at a glance

```
Browser (SWA) ──HTTPS──▶ Proxy (App Service) ──HTTPS──▶ Azure AI Foundry (Responses API)
      │                    │
      └──WSS (/ realtime)──┴──WSS──▶ OpenAI Realtime OR Azure OpenAI Realtime
```

Why there is a proxy:
- Browsers can’t set custom headers on WebSocket connections.
- The Realtime APIs require auth headers (`Authorization: Bearer ...` for OpenAI, `api-key: ...` for Azure OpenAI).
- So the browser connects to the proxy without headers, and the proxy connects upstream with the required headers.

---

## 2) Repo layout

- Frontend source: `live-transcriber/src/`
- Frontend build output: `live-transcriber/dist/`
- Proxy server: `live-transcriber/proxy-server.js`
- App Service settings generator: `live-transcriber/tools/generate-appservice-appsettings.ps1`
- CI/CD workflows:
  - SWA: `.github/workflows/azure-static-web-apps-ashy-dune-06d0e9810.yml`
  - Proxy App Service: `.github/workflows/main_contextpilot-proxy-2025.yml`

---

## 3) Azure resources you need

### 3.1 Azure Static Web Apps (frontend)
Create a Static Web App connected to your GitHub repo/branch.

Key points for this repo:
- App location is **`./live-transcriber`**
- Output location is **`dist`**

### 3.2 Azure App Service (proxy)
Create an **App Service (Linux)** with **Node.js 22** runtime.

Key points for this repo:
- The proxy is started via `node proxy-server.js`.
- App Service must listen on `process.env.PORT` (already implemented).

### 3.3 Azure AI Foundry (AIServices) (optional but used here)
If you want `/agent` to work (Agents/Workflows):

- Create/select an **Azure AI Foundry** (AIServices) resource.
- Create/select a **Project** inside Foundry.
- Your agent/workflow endpoints will look like:
  - `https://<resource>.services.ai.azure.com/api/projects/<project>`

---

## 4) Frontend configuration (SWA)

### 4.1 Proxy base URL (build-time)
The frontend reads the proxy base URL from a Vite build-time variable:

- `VITE_PROXY_BASE_URL`

Implementation: `live-transcriber/src/proxyConfig.ts`

Notes:
- If `VITE_PROXY_BASE_URL` is not provided, it falls back to `http://localhost:8080` for local dev.
- Because Vite embeds `import.meta.env.VITE_*` **at build time**, you must provide this value during the SWA GitHub Action build.

### 4.2 Where it is injected
Workflow: `.github/workflows/azure-static-web-apps-ashy-dune-06d0e9810.yml`

It passes:
- `VITE_PROXY_BASE_URL: ${{ vars.VITE_PROXY_BASE_URL }}`

So you must set a GitHub **Actions Variable** named:
- `VITE_PROXY_BASE_URL`

Value example (no trailing slash preferred):
- `https://<your-proxy-app>.azurewebsites.net`

---

## 5) Proxy configuration (App Service)

The proxy reads configuration from environment variables.

### 5.1 Generate App Service settings from `.env.local`
Locally, the proxy can load `live-transcriber/.env.local`. In Azure, you normally configure these as App Settings.

Script:
- `live-transcriber/tools/generate-appservice-appsettings.ps1`

What it does:
- Reads `live-transcriber/.env.local`
- Writes:
  - `live-transcriber/appservice-appsettings.generated.json` (full)
  - `live-transcriber/appservice-appsettings.generated.redacted.json` (safe-ish to share)
- Skips `VITE_*` keys (those are frontend build-time)
- Adds `WEBSITE_STARTUP_COMMAND = node proxy-server.js`

Run it (PowerShell):
```powershell
./live-transcriber/tools/generate-appservice-appsettings.ps1
```

Then in Azure Portal:
- App Service → **Configuration** → **Advanced edit**
- Paste the JSON array from `appservice-appsettings.generated.json`

### 5.2 Proxy env vars (names only)

#### OpenAI Realtime
- `OPENAI_API_KEY`

#### Azure OpenAI Realtime (transcribe / diarize)
Used when the client connects with `?provider=azure`:
- `AZURE_TRANSCRIBE_ENDPOINT` (host only, e.g. `my-resource.openai.azure.com`)
- `AZURE_TRANSCRIBE_API_KEY`
- `AZURE_TRANSCRIBE_DEPLOYMENT` (default: `gpt-4o-transcribe-diarize`)
- `AZURE_TRANSCRIBE_API_VERSION` (default: `2024-12-01-preview`)

#### OpenAI Realtime (transcribe)
Used when the client connects with `?provider=openai` (default):
- `OPENAI_API_KEY`

Optional (recommended) to control which OpenAI transcription model is used for Realtime `intent=transcription`:
- `OPENAI_TRANSCRIBE_MODEL` (default: `gpt-4o-mini-transcribe-2025-12-15`)
- `OPENAI_TRANSCRIBE_MODEL_FALLBACKS` (default: `gpt-4o-mini-transcribe,gpt-4o-transcribe`)

The proxy applies this override **only** for the OpenAI provider and leaves the Azure provider path untouched.
If the chosen OpenAI model is rejected (e.g. `invalid_model`), the proxy automatically retries using the fallback list.

#### Azure AI Foundry (Agents/Workflows)
- `AURA_API_VERSION` (default: `2025-11-15-preview`)

Agents are configured as numbered groups:
- `AGENT_1_NAME`, `AGENT_1_LABEL`, `AGENT_1_ENDPOINT`, `AGENT_1_API_KEY` (optional)
- `AGENT_2_NAME`, ...

Workflows similarly:
- `WORKFLOW_1_NAME`, `WORKFLOW_1_LABEL`, `WORKFLOW_1_ENDPOINT`, `WORKFLOW_1_API_KEY` (optional)

Default selection:
- `DEFAULT_AGENT` (numeric; workflows use negative IDs internally)

Legacy fallback (if you still use it):
- `AURA_ENDPOINT`
- `AURA_AGENT_NAME`
- `AURA_API_KEY`

---

## 6) Identity & RBAC for Foundry (critical for `/agent`)

### 6.1 Enable Managed Identity on the proxy App Service
Azure Portal:
- App Service → **Identity** → System assigned → **On** → Save

### 6.2 Assign the correct role on the correct scope
For Foundry Agents/Workflows, the proxy needs data-plane permissions like `Microsoft.CognitiveServices/accounts/AIServices/agents/write`.

What worked here:
- Assign **Azure AI User** role
- Scope: the **Azure AI Foundry (AIServices) resource** (not just the resource group)
- Principal: the App Service’s **system-assigned managed identity**

Symptoms when wrong:
- `/agents` might still work (it’s proxy-local)
- `/agent` fails with 401 `PermissionDenied` mentioning `.../AIServices/agents/write`

### 6.3 Token audience/scope
The proxy acquires an AAD token with scope:
- `https://ai.azure.com/.default`

This is required for the Foundry Responses API endpoints.

---

## 7) CI/CD workflows

### 7.1 Frontend (SWA)
Workflow: `.github/workflows/azure-static-web-apps-ashy-dune-06d0e9810.yml`

Important inputs:
- `app_location: "./live-transcriber"`
- `output_location: "dist"`

Required GitHub configuration:
- GitHub **Secret**: `AZURE_STATIC_WEB_APPS_API_TOKEN_ASHY_DUNE_06D0E9810`
- GitHub **Variable**: `VITE_PROXY_BASE_URL`

### 7.2 Proxy (App Service)
Workflow: `.github/workflows/main_contextpilot-proxy-2025.yml`

What it does:
- Uses Node 22
- Runs `npm install` (and `npm run build` if present)
- Uploads artifact `live-transcriber`
- Deploys the artifact to App Service

Required GitHub secrets (names as used in this repo):
- `AZUREAPPSERVICE_CLIENTID_4D4690AA57B04B96BA80994C550C9707`
- `AZUREAPPSERVICE_TENANTID_521D760737EF46168FB82C1C632A78DC`
- `AZUREAPPSERVICE_SUBSCRIPTIONID_951351D85B7D4368B05FEFA001B26CE8`

These are used for `azure/login@v2` (OIDC).

---

## 8) Runtime endpoints & validation

### 8.1 Proxy HTTP endpoints
The proxy serves these endpoints:
- `GET /` health/info (returns JSON with supported endpoints)
- `GET /agents` lists configured agents/workflows (from env)
- `POST /agents/switch` switches the active agent/workflow
- `POST /agent` calls Foundry Responses API for the current selection

Validation checks:
- Visit `https://<proxy>.azurewebsites.net/` → expect JSON `{ ok: true, ... }`
- Visit `https://<proxy>.azurewebsites.net/agents` → expect agent/workflow list

### 8.2 Proxy WebSocket endpoint
The WebSocket server is attached to the same host/port.

- OpenAI path: connect without provider or use `?provider=openai`
- Azure OpenAI path: `?provider=azure`

Examples:
- `wss://<proxy>.azurewebsites.net/?provider=openai`
- `wss://<proxy>.azurewebsites.net/?provider=azure`

### 8.3 Frontend bundle sanity
To ensure the deployed frontend is not still pointing at localhost:
- Confirm `VITE_PROXY_BASE_URL` is set as GitHub Actions variable.
- Rebuild/redeploy SWA.
- In the deployed site, check network calls go to your proxy hostname (not `localhost:8080`).

---

## 9) Local development

### 9.1 Install
From `live-transcriber/`:
```bash
npm install
```

### 9.2 Run proxy locally
Create `live-transcriber/.env.local` (do not commit). Then:
```bash
npm run start
```
Proxy default port is 8080.

### 9.3 Run frontend locally
```bash
npm run dev
```

By default, the frontend will use `http://localhost:8080` as proxy base URL.

---

## 10) Troubleshooting

### 10.1 SWA works but calls `localhost:8080`
Cause:
- `VITE_PROXY_BASE_URL` was not injected at build time.

Fix:
- Set GitHub Actions Variable `VITE_PROXY_BASE_URL`
- Ensure the SWA workflow exports it in the build step (already present in this repo)
- Redeploy

### 10.2 `/agent` fails with 401 PermissionDenied
Cause:
- Missing/incorrect role assignment for the proxy’s managed identity.

Fix:
- Enable System-Assigned Managed Identity on App Service
- Assign **Azure AI User** role on the **Foundry (AIServices) resource** scope

### 10.3 Azure provider WebSocket closes with “Azure Transcription not configured”
Cause:
- Missing `AZURE_TRANSCRIBE_ENDPOINT` and/or `AZURE_TRANSCRIBE_API_KEY`.

Fix:
- Set required App Service settings

---

## 11) Reference docs in this repo

- `live-transcriber/AURA_FOUNDRY_API_GUIDE.md` (Foundry Responses API format and examples)
- `live-transcriber/TECHNICAL_REPORT.md` (Realtime transcription debugging notes)
