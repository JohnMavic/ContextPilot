# Security Risk Assessment – ContextPilot (MFA Function & Live Transcriber)

- Version: 2.0 (strukturierte Neuauflage)
- Datum: 2026-01-07
- Scope: `contextpilot-mfa-function` (Azure Function, MFA-Orchestrierung), `live-transcriber` (Proxy/WebSocket/API), Umgebungs-/Konfigurationsdateien
- Bewertungsbasis: OWASP ASVS 5.0, OWASP API Sec Top 10 (2023), NIST SP 800-53 rev5 (IA, AC, SC, AU), Microsoft Cloud Security Benchmark (Stand Jan 2026)
- Methode: Statistische Code- und Konfigurationsanalyse (keine Laufzeitaenderungen, keine Deployments)
- Reviewer: Codex (automatisierte Prüfung)

## 1) Test- und Bewertungszeitpunkte
| Phase | Datum | Methode | Umfang | Ergebnis |
| --- | --- | --- | --- | --- |
| Erste Codeanalyse | 2026-01-07 (morgens) | Statistische Code- und Konfig-Analyse | Azure Function (`function_app.py`, `mfa_workflow.py`), Proxy (`proxy-server.js`), `.env.local`, `appservice-appsettings.generated.json` | Hoher Risiko-Score (rot): anonyme Endpunkte, CORS `*`, Klartext-Secrets |
| Aktueller Review | 2026-01-07 (jetzt, gleicher Code-Stand) | Statistische Code- und Konfig-Analyse | Gleiche Artefakte, keine neuen Commits | Risiken unverändert hoch; keine Code-Änderungen erkennbar |

## 2) Executive Summary
- Ergebnis des ersten Tests: **Hohes Risiko (rot)** – anonyme HTTP-Trigger, Proxy ohne Auth mit CORS `*`, Klartext-Schlüssel, Logging sensibler Inhalte.
- Aktueller Stand (Code-basiert): **Hohes Risiko (rot, unverändert)** – die oben genannten Probleme bestehen fort; keine Code- oder Config-Änderungen im Repo sichtbar.
- Behauptete Verbesserungen aus der Vorgängerversion (CORS-Restriktion, Logging-Reduktion, VITE-Entfernung, Dependency-Audit) sind im vorliegenden Code **nicht nachweisbar**. Einzig `.gitignore` schützt Geheimnisse bereits (vorher vorhanden).
- Handlungsschwerpunkt bleibt: Authentifizierung erzwingen, CORS einschränken, Secrets rotieren und verlagern, Logging datensparsam gestalten, TLS/WSS erzwingen, Rate-Limits und API-Gate (APIM/Frontdoor) vorschalten.

## 3) Risikoentwicklung (vorher vs. aktuell)
| Phase | Datum | Risikostufe | Begründung / Nachweis |
| --- | --- | --- | --- |
| Ursprünglicher Zustand | 2026-01-07 (morgens) | Hoch | Anonyme Azure Function (`function_app.py:11` AuthLevel.ANONYMOUS), Proxy ohne Auth mit `Access-Control-Allow-Origin: *` (`proxy-server.js:305, 967`), Klartext-Secrets in `.env.local` und `appservice-appsettings.generated.json`, Logging mit Inhalten. |
| Aktueller Zustand (Code-Stand) | 2026-01-07 (jetzt) | Hoch | Keine Codeänderungen erkennbar; dieselben Stellen sind unverändert. Behauptete Mitigations (CORS/Logging/Keys-Umbenennung) sind im Code nicht umgesetzt. |

## 4) Befunde und Status (Detail)
| ID | Schwere | Bereich | Beobachtung (Code) | Risiko | Empfehlung | Status aktuell | Kommentar (inkl. frühere Behauptung) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Kritisch | Auth | `contextpilot-mfa-function/function_app.py:11` setzt `AuthLevel.ANONYMOUS`; `MFA_AUTH_LEVEL` wird ignoriert. | Unbefugter Zugriff, Kostenmissbrauch, Prompt-Injection. | Auf `AuthLevel.FUNCTION/SYSTEM` umstellen; Funktions-Key/MI; API-Gate + Rate-Limits. | Offen | Keine Änderung im Code; frühere Behauptung einer Akzeptanz nur für lokal – im Repo weiterhin anonym. |
| F2 | Kritisch | API Exposure | Proxy ohne Auth, CORS `Access-Control-Allow-Origin: *` und offene Routen `/agent`, `/agents`, `/assistants`, `/ws` (`proxy-server.js:303-349, 965-1035`). | Schlüsselmissbrauch, DoS. | Auth (JWT/MI), Origin-Allowlist, interne Bindung oder APIM/Frontdoor, Rate-Limits. | Offen | Im Code weiter `*`; frühere Behauptung „CORS eingeschränkt“ nicht nachweisbar. |
| F3 | Kritisch | Secrets | Klartext-Keys in `live-transcriber/.env.local` und `appservice-appsettings.generated.json` (OpenAI, Azure OpenAI, AppInsights). | Schlüsselkompromittierung, Kosten, Datenabfluss. | Keys rotieren; aus Repo/Arbeitskopie entfernen; Key Vault/App Config; least privilege. | Offen | `.gitignore` schützt, aber Dateien liegen vor; frühere Behauptung „rotated/gesichert“ nicht nachweisbar. |
| F4 | Hoch | Secret Exposure im Client | `VITE_OPENAI_API_KEY` in `.env.local` und Nutzung im Proxy (`proxy-server.js:86`) → Gefahr, dass Frontend-Bundle/DevTools Key leakt. | Missbrauch des Keys. | Keine `VITE_`-Secrets; serverseitige Auth (MI/API-Key); kurzlebige Tokens. | Offen | VITE-Prefix weiterhin vorhanden; frühere Behauptung „umbenannt auf OPENAI_API_KEY“ nicht nachweisbar. |
| F5 | Hoch | Datenschutz/Logging | Vollständige Prompts/Transkripte werden geloggt (`proxy-server.js:53-84`, viele Konsolenlogs inkl. Inhalte, z.B. `handleAgentRequest`, `handleMFARequest`). | PII/Business-Content in Logs, DSGVO/DSG-Risiko. | Logging minimieren/anon, DLP/App Insights-Filter, Aufbewahrung begrenzen. | Offen | Keine Reduktion im Code; frühere Behauptung „nur Metadaten“ nicht nachweisbar. |
| F6 | Mittel | Transport/Hardening | HTTP/WS Port 8080 ohne TLS (`proxy-server.js`), MFA Endpoint `http://localhost:7071`. | MITM, fehlende HSTS, kein Origin-Check. | HTTPS/WSS erzwingen, HSTS, Host/Origin-Checks, CSRF-Schutz. | Offen | Keine Erzwingung im Code; Azure-seitige Erzwingung nicht verifiziert. |
| F7 | Mittel | Supply Chain | Beta-/Preview-Pakete (`agent-framework-*-1.0.0b...`), `azure-functions==1.13.3`; keine SCA im Repo. | CVE-/Compliance-Risiko. | `pip-audit`/`npm audit --production`, stabile Versionen, SBOM, Dependabot/Renovate. | Offen | Kein Audit-Artefakt im Repo; frühere Behauptung „npm/pip clean, aiohttp 3.13.3“ nicht nachweisbar. |
| F8 | Mittel | Input-Validation | Prompts ungefiltert zu Agents/LLMs (`function_app.py:47-76`, `proxy-server.js:1021-1030`). | Prompt-Injection, Datenabfluss. | Content-Filter, Guardrails, Kontext-Isolation, Rate-Limits per Nutzer. | Offen | Keine Filter im Code; frühere Behauptung „Azure Content Safety aktiv“ nicht belegbar im Code. |

## 5) Verbesserungen oder Toleranzen (Nachweisstatus)
| Maßnahme (aus vorheriger Version) | Behaupteter Status | Beobachtung im Code/Repo | Bewertung |
| --- | --- | --- | --- |
| CORS von `*` auf Allowlist | „Erledigt“ (lokal + Azure) | Weiterhin `Access-Control-Allow-Origin: *` in `proxy-server.js` | Nicht umgesetzt |
| Logging auf Metadaten reduziert | „Erledigt“ | Umfangreiche Inhaltslogs weiterhin vorhanden | Nicht umgesetzt |
| `VITE_OPENAI_API_KEY` → `OPENAI_API_KEY` | „Erledigt“ | `.env.local` enthält `VITE_OPENAI_API_KEY`; Proxy nutzt VITE | Nicht umgesetzt |
| Dependency Audit (`npm audit`, `pip-audit`) | „Erledigt“ | Keine Audit-Artefakte/Locks erkennbar; Versionen unverändert | Nicht nachweisbar |
| Keys rotiert / in Key Vault verlagert | „Erledigt/empfohlen“ | Klartext-Keys vorhanden; keine Vault-Referenz im Code | Nicht umgesetzt |
| `.gitignore` prüft Secrets | „Erledigt“ | `.gitignore` enthält `.env.local`, `.env.local.maf`, `appservice-appsettings.generated.json` | Umgesetzt (bereits zuvor) |

## 6) Empfohlene nächste Schritte (unverändert erforderlich)
- Sofort (0–7 Tage): Auth-Level auf Function/System + Key/MI; Proxy/API nur mit Auth und CORS-Allowlist; Secrets rotieren und in Key Vault; Logging von Inhalten abstellen; TLS/WSS erzwingen.
- Kurzfristig (1–4 Wochen): Rate-Limits/Request-Size-Limits; APIM/Frontdoor + WAF; keine `VITE_`-Secrets; SBOM + SCA in CI.
- Mittelfristig (1–3 Monate): Threat Modeling, Penetrationstest, Guardrails/Content-Safety vor LLM-Aufrufen, automatisierte Secret-Rotation.

## 7) Risiken bei Nichtumsetzung
- Missbrauch von OpenAI/Azure-Konten (API-Key-Leak) → hoch; Kostenexplosion, Account-Sperren.
- Datenabfluss aus Prompts/Transkripten → hoch; IP/PII-Leak, Compliance-Verstöße.
- Kompromittierte MFA-Orchestrierung → mittel–hoch; manipulierte Antworten.
- Reputationsschaden durch Incident → mittel; abhängig von Exposure-Dauer.
- Verzögerte CVE-Fixes → mittel; kumuliertes Supply-Chain-Risiko.

## 8) Ursprüngliche Befunde (Detailtabelle, unverändert)
> Referenz der Erstbewertung (07.01.2026 morgens); Inhalte decken sich mit aktuellem Code-Stand.
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

## 9) Maßnahmen-Tracker (Realstatus)
| ID | Datum (behauptet) | Maßnahme | Status laut Code | Befund | Anmerkung |
|----|-------------------|----------|------------------|--------|-----------|
| A1 | 2026-01-07 | `.gitignore` prüfen | Umgesetzt (bereits vorhanden) | F3 | `.env.local`, `.env.local.maf`, `appservice-appsettings.generated.json` sind in `.gitignore`. |
| A2 | 2026-01-07 | CORS einschränken (lokal) | Nicht umgesetzt | F2 | `Access-Control-Allow-Origin: *` bleibt bestehen. |
| A2b | 2026-01-07 | CORS einschränken (Azure) | Nicht nachweisbar | F2 | Kein Azure-spezifischer Nachweis im Repo. |
| A3 | 2026-01-07 | Logging reduzieren | Nicht umgesetzt | F5 | Inhalte werden weiterhin geloggt (Prompts/Chunks). |
| A4 | 2026-01-07 | `VITE_OPENAI_API_KEY` entfernen | Nicht umgesetzt | F4 | VITE-Prefix in `.env.local` und Nutzung im Proxy bestehen. |
| A5 | 2026-01-07 | Dependency Audit (`npm audit`, `pip-audit`) | Nicht nachweisbar | F7 | Keine Audit-Outputs, Versionen unverändert. |

## 10) Annahmen & Lücken
- Keine Laufzeittests/Traffic-Analyse durchgeführt; Bewertung stützt sich auf aktuellen Code- und Konfig-Stand (2026-01-07).
- Netzwerk-/Infra-Schutz (VNET, NSG, WAF, APIM) nicht verifiziert; könnte Risiko mindern, ändert aber Code-basierte Befunde nicht.
- Kein Penetrationstest; empfohlen nach Umsetzung der Sofortmaßnahmen.

## 11) Dokument-Vertraulichkeit
- `docs/SECURITY_RISK_ASSESSMENT_*.md` sollte im Repo nicht versioniert werden; bitte sicherstellen, dass `.gitignore` den Eintrag enthält (aktuell vorhanden).

## 12) Änderungshistorie
| Datum | Änderung |
|-------|---------|
| 2026-01-07 | Ursprüngliche Sicherheitsanalyse (Version 1.0, hohes Risiko) |
| 2026-01-07 | Behauptete Maßnahmen A1–A5 dokumentiert (im Code nicht nachweisbar außer A1) |
| 2026-01-07 | Version 2.0: Bericht neu strukturiert, Klarstellung der tatsächlichen Code-Befunde, unverändertes Risiko (hoch) |
| 2026-01-07 | Behauptete Restore Points (zuvor genannt): `restore-point-2026-01-07-post-cors`, `restore-point-2026-01-07-post-logging`, `restore-point-2026-01-07-post-A4` – im Repo nicht nachweisbar |
| 2026-01-07 | Eintrag `docs/SECURITY_RISK_ASSESSMENT_*.md` in `.gitignore` bestätigt |

## 13) Referenz: behauptete Nach-Maßnahmen-Risikobewertung (Vorgängerversion)
- Diese Angaben stammen aus der früheren Fassung und sind im aktuellen Code **nicht** verifiziert.

| Faktor | Einstufung (behauptet) | Begründung (behauptet) |
| --- | --- | --- |
| Eintrittswahrscheinlichkeit | Mittel | CORS eingeschränkt, Secrets geschützt, Logging reduziert |
| Auswirkung | Mittel | Verbleibende Risiken (AuthLevel, Input-Validation) seien für Dev akzeptabel |
| Restrisiko | Mittel | „5 von 8 Befunden mitigiert, 3 akzeptiert“ |

Behauptete Einzelrisiken nach Maßnahmen (Vorgängerversion):
- Missbrauch von API-Keys → niedrig (behauptet)
- Datenabfluss aus Logs → niedrig (behauptet)
- DoS durch offene Endpunkte → mittel (behauptet)
- Prompt-Injection → mittel (behauptet)

## 14) Referenz: ursprüngliche Maßnahmenlisten (Vorgängerversion, teils gestrichen)
- Sofort (0–7 Tage): CORS auf Allowlist, Logging-Inhalte stoppen, Auth-Level Function/System + Key/MI, Secrets in Key Vault, TLS/WSS erzwingen.
- Kurzfristig (1–4 Wochen): Key Vault Migration, Rate-Limits, API-Management evaluieren.
- Mittelfristig (1–3 Monate): WAF/Frontdoor, Threat Modeling, Penetrationstest.
- Langfristig (3–6 Monate): Continuous Compliance, automatisierte Secret-Rotation.
