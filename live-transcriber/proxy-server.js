// Einfacher WebSocket-Proxy für OpenAI Realtime API
// Umgeht Browser-Limitation (keine Custom Headers in WS)

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";

// Lade .env.local manuell
try {
  const envContent = readFileSync(".env.local", "utf-8");
  envContent.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) {
      process.env[key.trim()] = vals.join("=").trim();
    }
  });
} catch (e) {
  console.log("Keine .env.local gefunden, nutze Umgebungsvariablen");
}

const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const PORT = 8080;

if (!OPENAI_API_KEY) {
  console.error("ERROR: Kein API Key gefunden in .env.local oder Umgebungsvariablen");
  process.exit(1);
}

console.log("API Key gefunden:", OPENAI_API_KEY.substring(0, 10) + "...");

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, req) => {
  console.log("[PROXY] Client verbunden");

  // Message-Buffer bis OpenAI verbunden ist
  let openaiReady = false;
  const messageBuffer = [];

  // Verbinde zu OpenAI mit Authorization Header
  const openaiUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
  const openaiWs = new WebSocket(openaiUrl, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openaiWs.on("open", () => {
    console.log("[PROXY] Mit OpenAI verbunden");
    openaiReady = true;
    
    // Gepufferte Messages senden
    if (messageBuffer.length > 0) {
      console.log(`[PROXY] Sende ${messageBuffer.length} gepufferte Messages`);
      messageBuffer.forEach((msg) => {
        console.log("[PROXY] Client (buffered) ->", msg.substring(0, 100) + (msg.length > 100 ? "..." : ""));
        openaiWs.send(msg);
      });
      messageBuffer.length = 0;
    }
  });

  openaiWs.on("message", (data) => {
    const msg = data.toString();
    console.log("[PROXY] OpenAI ->", msg.substring(0, 150) + (msg.length > 150 ? "..." : ""));
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(msg);
    }
  });

  openaiWs.on("error", (err) => {
    console.error("[PROXY] OpenAI Fehler:", err.message);
    clientWs.close(1011, "OpenAI connection error");
  });

  openaiWs.on("close", (code, reason) => {
    console.log("[PROXY] OpenAI geschlossen:", code, reason.toString());
    clientWs.close(code, reason.toString());
  });

  clientWs.on("message", (data) => {
    const msg = data.toString();
    console.log("[PROXY] Client ->", msg.substring(0, 100) + (msg.length > 100 ? "..." : ""));
    
    if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(msg);
    } else {
      // Puffern bis OpenAI bereit
      console.log("[PROXY] OpenAI noch nicht bereit, puffere Message");
      messageBuffer.push(msg);
    }
  });

  clientWs.on("close", () => {
    console.log("[PROXY] Client getrennt");
    openaiWs.close();
  });

  clientWs.on("error", (err) => {
    console.error("[PROXY] Client Fehler:", err.message);
    openaiWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`[PROXY] WebSocket Proxy läuft auf ws://localhost:${PORT}`);
  console.log("[PROXY] Die Vite-App muss auf diesen Proxy zeigen statt direkt auf OpenAI");
});
