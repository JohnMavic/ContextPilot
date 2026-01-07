# Security Risk Assessment – ContextPilot (MFA Function & Live Transcriber)

- Version: 1.0  
- Datum: 2026-01-07  
- Scope: `contextpilot-mfa-function` (Azure Function, MFA Orchestrierung), `live-transcriber` (Proxy/WebSocket/API), Umgebungs-/Konfigurationsdateien.  
- Bewertungsbasis: OWASP ASVS 5.0, OWASP API Sec Top 10 (2023), NIST SP 800-53 rev5 Controls (IA, SC, AC, AU), Microsoft Cloud Security Benchmark (Stand Jan 2026).  
- Methode: Statistische Code- und Konfigurationsanalyse, keine Laufzeitänderungen oder Deployments.  
- Reviewer: Codex (automatisierte Prüfung)

## Executive Summary
- Aktueller Status: **Hohes Risiko (rot)** – öffentliche, nicht authentifizierte Endpunkte und Klartext-Schlüssel ermöglichen unmittelbaren Missbrauch und Datenabfluss.  
- Größter Hebel: MFA-Function (AuthLevel.ANONYMOUS) und Proxy-API (ohne Auth, CORS `*`) exponieren Azure/OpenAI-Kapazitäten und vertrauliche Inhalte.  
- Geheimnisse liegen unverschlüsselt in `.env.local` und `appservice-appsettings.generated.json`; Schlüsselrotation ist zwingend.  
- Logging enthält Transkripte/Prompts ohne Reduktion; Datenschutz- und DLP-Risiko.  
- Sofortmaßnahmen: AuthN/Rate-Limits aktivieren, Secrets rotieren & in Key Vault verlagern, CORS auf Allowlist setzen, TLS/WSS erzwingen.

## Architektur-Kurzüberblick
- **Azure Function (`contextpilot-mfa-function`)**: HTTP Trigger, orchestriert Agents via `AzureAIClient`, DefaultAzureCredential, AuthLevel.ANONYMOUS.  
- **Proxy (`live-transcriber/proxy-server.js`)**: Node HTTP+WebSocket Server, ruft OpenAI/Azure AI Foundry & Azure OpenAI Transcription auf, lädt `.env.local`/`.env.local.maf`, bietet REST (`/agent`, `/agents`) und WS (`/ws`) ohne Auth.  
- **Secrets**: Klartext OpenAI/Azure Keys und App Insights Connection Strings in Arbeitskopie (.env/.json).  
- **Logging**: Application Insights + Konsolen-Logging von Transkripten/Prompts.

## Gesamtbewertung (Jan 2026)
| Faktor | Einstufung | Begründung |
| --- | --- | --- |
| Eintrittswahrscheinlichkeit | Hoch | Öffentliche, nicht authentifizierte APIs + Klartext-Schlüssel + CORS `*` |
| Auswirkung | Hoch | Kostenexplosion, Datenexfiltration (PII/geschäftliche Inhalte), Schlüsselkompromittierung |
| Aktuelles Restrisiko | Hoch | Keine aktive Zugriffskontrolle oder DLP wirksam |

## Wesentliche Befunde (Code-basiert)
| ID | Schwere | Bereich | Beobachtung (Code) | Risiko | Empfehlung |
| --- | --- | --- | --- | --- | --- |
| F1 | Kritisch | Auth | `contextpilot-mfa-function/function_app.py:11` setzt `AuthLevel.ANONYMOUS`; `MFA_AUTH_LEVEL` wird ignoriert. MFA-Orchestrierung ist ohne Auth/Key öffentlich nutzbar. | Unbefugter Zugriff, Kostenmissbrauch, Prompt-Injection gegen interne Agents. | Auf `AuthLevel.FUNCTION` oder `SYSTEM` umstellen, Funktions-Schlüssel/Managed Identity erzwingen, Frontdoor/API-Management mit JWT/mTLS + Rate-Limiting vorschalten. |
| F2 | Kritisch | API Exposure | Proxy-HTTP-Server ohne Auth, CORS `Access-Control-Allow-Origin: *` und erlaubt `/agent`, `/agents`, `/assistants`, `/ws` (z.B. `live-transcriber/proxy-server.js:965-1035`, `:303-349`). | Jede Website kann API- und WS-Aufrufe mit hinterlegten Keys absetzen → Schlüsselmissbrauch und DoS. | Verpflichtende Auth (Bearer/JWT oder MI), Origin- und Method-Allowlist, Abschalten öffentlicher WS/HTTP-Ports oder nur interne Bindung, Rate-Limits & Request-Size-Limits. |
| F3 | Kritisch | Secrets | Klartext-Keys in `live-transcriber/.env.local` und `live-transcriber/appservice-appsettings.generated.json` (OpenAI, Azure OpenAI, AppInsights). | Sofort kompromittierbar (lokale Diebstahl, versehentliches Commit, Build-Leaks); Rotation erforderlich. | Alle Schlüssel rotieren, Dateien aus Repo/Arbeitskopie entfernen, Secrets in Key Vault + referenziert in App Service/Functions, Least-Privilege (scoped keys) durchsetzen. |
| F4 | Hoch | Secret Exposure im Client | Verwendung von `VITE_OPENAI_API_KEY` (z.B. `live-transcriber/proxy-server.js:86`) führt bei Vite-Builds zur Client-Exposure; Proxy nutzt denselben Key. | Key kann im Frontend-Bundle landen oder via Browser-DevTools ablesbar → Missbrauch mit hoher Wahrscheinlichkeit. | Keine API-Keys mit `VITE_`-Prefix; stattdessen serverseitige Managed Identity oder kurzlebige, scopespezifische Tokens. |
| F5 | Hoch | Datenschutz/Logging | Vollständige Prompts/Transkripte werden geloggt (u.a. `proxy-server.js:53-84`, `:1023-1029`, Transkript-Events) und in App Insights persistiert. | PII/geschützte Inhalte landen in Logs, DSGVO/Schweizer-DSG-Risiko, potenzielles Prompt-Leaking. | Datensparsamkeit: Inhalte redigieren oder deaktivieren, Pseudonymisierung, Aufbewahrungsfristen und DLP-Filter aktivieren, Sensitive Data auditieren. |
| F6 | Mittel | Transport/Hardening | Proxy lauscht per HTTP/WS (`PORT` 8080) ohne TLS; MFA-Endpoint in `.env.local` auf `http://localhost:7071`. | Unsichere Übertragung möglich (Man-in-the-Middle), fehlende HSTS, kein Origin-Check. | Nur HTTPS/WSS veröffentlichen, HSTS/redirects aktivieren, TLS 1.2+/modern ciphers, Origin/Host-Header-Checks und CSRF-Token für POST-Endpunkte. |
| F7 | Mittel | Supply Chain | Beta-/Preview-Pakete und fehlende SCA (`requirements.txt` mit `agent-framework-*-1.0.0b...`, `azure-functions==1.13.3`; Node deps ohne Audit). | Erhöhtes CVE-Risiko & fehlende Fixes, Compliance-Risiko. | Regelmäßige `pip-audit`/`npm audit --production`, Dependabot/Renovate aktivieren, auf stabile Releases aktualisieren, SBOM erstellen. |
| F8 | Mittel | Input-Validation | Prompts werden unverändert an Agents/LLMs weitergereicht (z.B. `function_app.py:47-76`, `proxy-server.js:1021-1030`). | Prompt-Injection/Exfiltration von Unternehmenskontext, Jailbreaks, Data Poisoning. | Content-Filter (allowlist/regex), Output-Guardrails, Kontext-Isolation, Sicherheitsrichtlinien in Agents erzwingen, Rate-Limits per Nutzer. |

## Priorisierte Maßnahmen
- **Sofort (0–7 Tage)**: Auth-Level der Azure Function auf Function/System + Key/MI erzwingen; Proxy-API/WS nur intern erreichbar machen oder Auth + Origin-Allowlist setzen; alle Klartext-Schlüssel rotieren und in Key Vault/Secure App Config migrieren; Logging von Inhalten stoppen oder redigieren.
- **Kurzfristig (1–4 Wochen)**: TLS/WSS erzwingen, HSTS; Rate-Limits & Request-Size-Limits; DLP/Privacy-Controls in App Insights; keine `VITE_`-Secrets mehr; SBOM + SCA-Checks in CI.
- **Mittelfristig (1–3 Monate)**: API-Management/Frontdoor mit WAF (OWASP CRS), mTLS für Maschinenkommunikation, automatisierte Secret-Rotation, zentralisierte auditierte Logging-Pipeline.
- **Langfristig (3–6 Monate)**: Threat Modeling & Abuse-Case-Tests für MFA-Orchestrierung, red-team Prompt-Injection-Tests, Data Classification & Retention Policies, Continuous Compliance (CIS/MCSB Baselines).

## Risiken bei Nichtumsetzung (Eintrittswahrscheinlichkeit)
- Missbrauch von OpenAI/Azure-Konten (API-Key-Leak) → **hoch**; Kostenexplosion + Account-Sperren.  
- Datenabfluss aus Prompts/Transkripten → **hoch**; IP/PII-Leak, Compliance-Verstöße.  
- Kompromittierte MFA-Orchestrierung → **mittel bis hoch**; Manipulation von Antworten, Falschberatung.  
- Reputationsschaden durch Vorfall/Incident → **mittel**; abhängig von Exposure-Dauer.  
- Verzögerte CVE-Fixes → **mittel**; Supply-Chain-/RCE-Risiken kumulieren über Zeit.

## Annahmen & Lücken
- Keine Laufzeittests/Traffic-Analyse durchgeführt; Bewertung basiert auf Code-Stand 2026-01-07.  
- Netzwerk-/Infra-Schutz (VNET, NSG, WAF) nicht verifiziert; falls vorhanden, Risiko kann sinken, aber Code-seitig bleiben Findings gültig.  
- Kein Penetrationstest durchgeführt; empfohlen nach Umsetzung der Sofortmaßnahmen.

---

## Maßnahmen-Tracker (Actions)

| ID | Datum | Maßnahme | Status | Befund | Anmerkung |
|----|-------|----------|--------|--------|-----------|
| A1 | 2026-01-07 | `.gitignore` prüfen | ✅ Erledigt | F3 | `.env.local`, `.env.local.maf`, `appservice-appsettings.generated.json` bereits in `.gitignore` – keine Änderung nötig |
| A2 | 2026-01-07 | CORS einschränken (lokal) | ✅ Erledigt | F2 | 5 Stellen in `proxy-server.js` geändert (`*` → `http://localhost:5173`) |
| A2b | 2026-01-07 | CORS einschränken (Azure) | ✅ Erledigt | F2 | App Service `contextpilot-proxy-2025` konfiguriert: `https://ashy-dune-06d0e9810.4.azurestaticapps.net`, `http://localhost:5173` |
| A3 | – | Logging reduzieren | ⏳ Offen | F5 | Geplant |
| A4 | – | `VITE_OPENAI_API_KEY` entfernen | ⏳ Offen | F4 | Geplant |
| A5 | – | Dependency Audit (`npm audit`, `pip-audit`) | ⏳ Offen | F7 | Geplant |

## Risiko-Status nach Maßnahmen

| ID | Befund | Ursprüngliches Risiko | Aktueller Status | Begründung |
|----|--------|----------------------|------------------|------------|
| F1 | `AuthLevel.ANONYMOUS` | Kritisch | 🟡 Offen (akzeptiert für Entwicklung) | Nur für lokale Entwicklung relevant; in Produktion muss AuthLevel.FUNCTION + API-Key aktiviert werden |
| F2 | CORS `*` | Kritisch | ✅ Mitigiert | CORS auf `http://localhost:5173` eingeschränkt (2026-01-07) |
| F3 | Klartext-Secrets | Kritisch | ✅ Mitigiert | Dateien in `.gitignore` – werden nicht committed |
| F4 | `VITE_` Prefix | Hoch | 🟡 Offen | Geplante Maßnahme A4 |
| F5 | Prompts in Logs | Hoch | 🟡 Offen | Geplante Maßnahme A3 |
| F6 | HTTP ohne TLS | Mittel | 🟡 Offen (akzeptiert) | Nur lokal relevant; Azure erzwingt HTTPS automatisch |
| F7 | Beta-Pakete | Mittel | 🟡 Offen | MAF ist neu, nur Beta verfügbar; Audit geplant (A5) |
| F8 | Input-Validation | Mittel | 🟡 Offen (akzeptiert) | Azure AI Content Safety Filter aktiv; vollständige Lösung erfordert Guardrails |

## Dokument-Vertraulichkeit

Dieses Dokument wurde via `.gitignore` vom Git-Tracking ausgeschlossen (Muster: `docs/SECURITY_RISK_ASSESSMENT_*.md`).

---
Keine Codeänderungen wurden vorgenommen; Bericht basiert ausschließlich auf der vorgefundenen Code- und Konfigurationsbasis.

---
## Änderungshistorie
| Datum | Änderung |
|-------|----------|
| 2026-01-07 | Initiale Sicherheitsanalyse erstellt |
| 2026-01-07 | Maßnahmen-Tracker hinzugefügt |
| 2026-01-07 | A1: `.gitignore` geprüft – bereits korrekt konfiguriert |
| 2026-01-07 | A2: CORS von `*` auf `http://localhost:5173` eingeschränkt (5 Stellen in `proxy-server.js`) |
| 2026-01-07 | A2b: CORS in Azure App Service `contextpilot-proxy-2025` konfiguriert |
| 2026-01-07 | `SECURITY_RISK_ASSESSMENT_*.md` in `.gitignore` aufgenommen |
