# AURA Agent API Integration Guide

## Microsoft Foundry (new) - Responses API

> **Stand:** Dezember 2025  
> **API Version:** `2025-11-15-preview`  
> **Getestet mit:** AURAContext Agent (claude-sonnet-4-5)

---

## 1. Übersicht

Die neue Microsoft Foundry API (ab November 2025) verwendet die **Responses API** mit Agent-Referenzierung nach **Namen** (nicht ID wie bei der alten Assistants API).

### Wichtige Unterschiede zur alten API:
| Alt (Assistants API) | Neu (Responses API) |
|---------------------|---------------------|
| `assistant_id: "asst_xxx"` | `agent: { name: "AURAContext" }` |
| Thread erstellen → Message → Run → Poll | Einzelner POST Request |
| API Version `2025-05-01` | API Version `2025-11-15-preview` |
| `/assistants`, `/threads`, `/runs` | `/openai/responses` |

---

## 2. Endpoint & Authentifizierung

### Endpoint Format
```
POST https://<resource-name>.services.ai.azure.com/api/projects/<project-name>/openai/responses?api-version=2025-11-15-preview
```

### Konkretes Beispiel
```
POST https://aura-foundry-resource.services.ai.azure.com/api/projects/aura/openai/responses?api-version=2025-11-15-preview
```

### Authentifizierung (Azure AD Token)

**Scope:** `https://ai.azure.com/.default`

```javascript
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();
const scope = "https://ai.azure.com/.default";
const token = await credential.getToken(scope);

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${token.token}`
};
```

**Voraussetzungen für lokale Entwicklung:**
- Azure CLI installiert (`az login` ausgeführt)
- Oder: Umgebungsvariablen `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

---

## 3. Request Format

### Minimaler Request
```json
{
  "agent": {
    "type": "agent_reference",
    "name": "AURAContext"
  },
  "input": "Was sind die 5 wichtigsten Wins dieser Periode?"
}
```

### Mit Conversation ID (Multi-Turn)
```json
{
  "agent": {
    "type": "agent_reference",
    "name": "AURAContext"
  },
  "input": "Erzähl mir mehr über den ersten Win.",
  "conversation": "conv_abc123..."
}
```

### Verfügbare Agenten (Stand Dezember 2025)
| Agent Name | Beschreibung |
|------------|--------------|
| `AURAContext` | Allgemeiner Kontext-Agent |
| `AURASpeachToText` | Speech-to-Text |
| `AURAMedicalV02` | Medizinische Anfragen |
| `AURAOrchestratorV02` | Orchestrierung |
| `AURAWeatherV02` | Wetter-Anfragen |
| `AURATravelV02` | Reise-Anfragen |
| `AURAMainV02` | Haupt-Agent |

---

## 4. Response Format

### Erfolgreiche Response (HTTP 200)
```json
{
  "id": "resp_xxx",
  "object": "response",
  "status": "completed",
  "model": "claude-sonnet-4-5",
  "output": [
    {
      "type": "file_search_call",
      "id": "msg_xxx",
      "status": "completed",
      "queries": ["..."]
    },
    {
      "type": "message",
      "id": "msg_xxx",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Die Antwort des Agenten...",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 4576,
    "output_tokens": 682,
    "total_tokens": 5258
  },
  "agent": {
    "type": "agent_id",
    "name": "AURAContext",
    "version": "2"
  },
  "conversation": null
}
```

### Response Parsing (JavaScript)
```javascript
function extractAgentResponse(responseData) {
  // Direkt output_text (falls vorhanden)
  if (responseData.output_text) {
    return responseData.output_text;
  }
  
  // Suche nach message-Typ im output Array
  if (responseData.output && Array.isArray(responseData.output)) {
    const messageOutput = responseData.output.find(o => o.type === "message");
    if (messageOutput?.content) {
      const textContent = messageOutput.content.find(
        c => c.type === "output_text" || c.type === "text"
      );
      if (textContent) {
        return textContent.text || textContent.value;
      }
    }
  }
  
  // Fallback
  return JSON.stringify(responseData);
}
```

---

## 5. Vollständiges Code-Beispiel (Node.js)

```javascript
import { DefaultAzureCredential } from "@azure/identity";

const AURA_ENDPOINT = "https://aura-foundry-resource.services.ai.azure.com/api/projects/aura";
const AURA_AGENT_NAME = "AURAContext";
const AURA_API_VERSION = "2025-11-15-preview";

async function askAURA(prompt, conversationId = null) {
  // 1. Token holen
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken("https://ai.azure.com/.default");
  
  // 2. Request Body
  const requestBody = {
    agent: {
      type: "agent_reference",
      name: AURA_AGENT_NAME
    },
    input: prompt
  };
  
  if (conversationId) {
    requestBody.conversation = conversationId;
  }
  
  // 3. API Call
  const url = `${AURA_ENDPOINT}/openai/responses?api-version=${AURA_API_VERSION}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token.token}`
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }
  
  const data = await response.json();
  
  // 4. Response parsen
  const messageOutput = data.output?.find(o => o.type === "message");
  const textContent = messageOutput?.content?.find(c => c.type === "output_text");
  
  return {
    text: textContent?.text || "",
    conversationId: data.conversation?.id || data.conversation,
    usage: data.usage
  };
}

// Verwendung
const result = await askAURA("Was sind die 5 wichtigsten Wins?");
console.log(result.text);
```

---

## 6. cURL Beispiel

```bash
# Token holen
TOKEN=$(az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv)

# Request
curl -X POST \
  "https://aura-foundry-resource.services.ai.azure.com/api/projects/aura/openai/responses?api-version=2025-11-15-preview" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agent": {
      "type": "agent_reference",
      "name": "AURAContext"
    },
    "input": "Was sind die 5 wichtigsten Wins?"
  }'
```

---

## 7. PowerShell Beispiel

```powershell
# Token holen
$token = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv

# Request
$body = @{
    agent = @{
        type = "agent_reference"
        name = "AURAContext"
    }
    input = "Was sind die 5 wichtigsten Wins?"
} | ConvertTo-Json -Depth 3

$response = Invoke-RestMethod `
    -Uri "https://aura-foundry-resource.services.ai.azure.com/api/projects/aura/openai/responses?api-version=2025-11-15-preview" `
    -Method POST `
    -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer $token" } `
    -Body $body

# Antwort extrahieren
$message = $response.output | Where-Object { $_.type -eq "message" }
$text = $message.content | Where-Object { $_.type -eq "output_text" }
Write-Host $text.text
```

---

## 8. Fehlerbehandlung

| HTTP Status | Fehler | Lösung |
|-------------|--------|--------|
| 401 | Unauthorized | Token-Scope prüfen (`https://ai.azure.com/.default`) |
| 400 | Bad Request - API version not supported | API Version auf `2025-11-15-preview` setzen |
| 400 | Invalid agent name | Agent-Name prüfen (case-sensitive!) |
| 404 | Not Found | Endpoint-URL prüfen (inkl. `/api/projects/<project>`) |
| 500 | Internal Server Error | Agent-Konfiguration im Foundry Portal prüfen |

---

## 9. Umgebungsvariablen (.env.local)

> **⚠️ WICHTIG:** Die konkreten Credentials und Endpoint-URLs sind in der lokalen Datei  
> `e:\ContextPilot\live-transcriber\.env.local` gespeichert.  
> Diese Datei ist NICHT im Git-Repository und muss lokal vorhanden sein!

```env
# Azure AI Foundry - AURA Agent Configuration (NEW Foundry API - November 2025+)
# Endpoint format: https://<name>.services.ai.azure.com/api/projects/<project>
AURA_ENDPOINT=https://aura-foundry-resource.services.ai.azure.com/api/projects/aura
AURA_AGENT_NAME=AURAContext
AURA_API_VERSION=2025-11-15-preview

# OpenAI API Key für Transkription (WebSocket Proxy)
VITE_OPENAI_API_KEY=sk-proj-xxx...
```

### Credentials-Übersicht

| Variable | Beschreibung | Wo zu finden |
|----------|--------------|--------------|
| `AURA_ENDPOINT` | Azure AI Foundry Project Endpoint | Azure Portal → AI Foundry → Project → Overview |
| `AURA_AGENT_NAME` | Name des Agenten | AI Foundry Portal → Agents |
| `AURA_API_VERSION` | API Version | `2025-11-15-preview` (Stand Dez 2025) |
| `VITE_OPENAI_API_KEY` | OpenAI API Key für Transkription | OpenAI Platform → API Keys |

### Azure AD Authentifizierung (für AURA)

Für lokale Entwicklung wird **kein API Key** benötigt! Die Authentifizierung erfolgt über Azure AD:

1. `az login` ausführen (einmalig)
2. `DefaultAzureCredential` holt automatisch den Token
3. Der eingeloggte User braucht **Azure AI User** Rolle auf dem Project

---

## 10. Wichtige Hinweise

1. **Agent-Name vs Agent-ID:** Die neue API verwendet den **Namen** des Agenten (z.B. `AURAContext`), nicht die ID (z.B. `asst_xxx`).

2. **Kein Threading:** Anders als bei der Assistants API ist kein Thread-Management nötig. Jeder Request ist eigenständig (oder mit `conversation` für Multi-Turn).

3. **Token-Scope:** Unbedingt `https://ai.azure.com/.default` verwenden, NICHT `https://cognitiveservices.azure.com/.default`.

4. **Output-Struktur:** Das `output` Array kann mehrere Einträge haben (z.B. `file_search_call` + `message`). Der Text ist im `message`-Typ.

5. **Model:** Der Agent kann verschiedene Models nutzen (z.B. `claude-sonnet-4-5`, `gpt-4o`). Das wird im Agent im Foundry Portal konfiguriert.

---

## Referenzen

- [Microsoft Foundry Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/)
- [Azure AI Foundry SDK Samples](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/ai/azure-ai-projects)
- [Responses API Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/quickstarts/get-started-code)
