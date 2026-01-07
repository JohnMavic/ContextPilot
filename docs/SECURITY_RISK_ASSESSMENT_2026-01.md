# Security Risk Assessment – ContextPilot
## MFA Function & Live Transcriber

---

| Feld | Wert |
|------|------|
| **Version** | 3.0 |
| **Datum** | 2026-01-08 |
| **Scope** | `contextpilot-mfa-function`, `live-transcriber`, Konfigurationsdateien |
| **Bewertungsbasis** | OWASP ASVS 5.0, OWASP API Sec Top 10, NIST SP 800-53 |
| **Methode** | Statische Code-Analyse |
| **Ziel** | Sicherer Prototyp (keine ISO-Zertifizierung) |

---

# Teil A: Zusammenfassung

## Gesamtbewertung

| Zeitpunkt | Risikostufe | Begründung |
|-----------|-------------|------------|
| **07.01.2026 (morgens)** | 🔴 Hoch | Anonyme Endpunkte, CORS `*`, Secrets exponiert, Prompts in Logs |
| **08.01.2026 (aktuell)** | 🟡 Mittel | CORS gefixt, VITE-Prefix entfernt, Logging reduziert, CVEs gepatcht |

## Schnellübersicht Befunde

| ID | Befund | War | Ist | Für Prototyp |
|----|--------|-----|-----|--------------|
| F1 | AuthLevel.ANONYMOUS | 🔴 | 🔴 Offen | 🟡 Akzeptiert |
| F2 | CORS `*` | 🔴 | 🟢 Gefixt | ✅ Erledigt |
| F3 | Klartext-Secrets | 🔴 | 🟡 Geschützt | 🟡 Akzeptiert |
| F4 | VITE_OPENAI_API_KEY | 🔴 | 🟢 Gefixt | ✅ Erledigt |
| F5 | Prompts in Logs | 🔴 | 🟠 Teilweise | ⚠️ 2 Stellen offen |
| F6 | HTTP ohne TLS | 🟡 | 🟡 Offen | 🟢 Akzeptiert |
| F7 | CVEs in Dependencies | 🟡 | 🟠 Teilweise | ⚠️ Neue CVE |
| F8 | Input-Validation | 🟡 | 🟡 Offen | 🟡 Akzeptiert |

---

# Teil B: Detaillierte Befunde

## F1: AuthLevel.ANONYMOUS

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🔴 Kritisch |
| **Datei** | `contextpilot-mfa-function/function_app.py` Zeile 11 |
| **Code** | `app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)` |
| **Risiko** | MFA-Endpunkt ohne Authentifizierung öffentlich nutzbar |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ❌ Nein |
| **Code-Nachweis** | `function_app.py:11` zeigt weiterhin `AuthLevel.ANONYMOUS` |

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟡 Akzeptiert für Prototyp |
| **Begründung** | Function läuft nur lokal auf `localhost:7071`, nicht öffentlich im Internet erreichbar. Proxy ruft sie intern auf. |

### Für Produktion erforderlich
- [ ] `AuthLevel.FUNCTION` oder `AuthLevel.ADMIN` setzen
- [ ] Function Key oder Managed Identity konfigurieren
- [ ] API Management mit JWT/Rate-Limiting vorschalten

---

## F2: CORS `Access-Control-Allow-Origin: *`

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🔴 Kritisch |
| **Datei** | `live-transcriber/proxy-server.js` |
| **Code** | `Access-Control-Allow-Origin: *` an 5 Stellen |
| **Risiko** | Jede Website kann API-Aufrufe mit hinterlegten Keys machen |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ✅ Ja, vollständig |
| **Commit** | `706fbbb` – "security: CORS hardening" |
| **Code-Nachweis** | |

```
Zeile 305:  "Access-Control-Allow-Origin": "http://localhost:5173"
Zeile 329:  "Access-Control-Allow-Origin": "http://localhost:5173"
Zeile 347:  "Access-Control-Allow-Origin": "http://localhost:5173"
Zeile 361:  "Access-Control-Allow-Origin": "http://localhost:5173"
Zeile 968:  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟢 Mitigiert |
| **Begründung** | Nur das eigene Frontend auf `localhost:5173` kann API-Calls machen. Browser blockieren Cross-Origin-Requests von anderen Domains. |

### Für Produktion erforderlich
- [x] CORS auf spezifische Origin einschränken ✅
- [ ] Produktions-Domain in Azure App Service CORS konfigurieren
- [ ] Rate-Limiting implementieren

---

## F3: Klartext-Secrets

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🔴 Kritisch |
| **Dateien** | `.env.local`, `appservice-appsettings.generated.json` |
| **Risiko** | API-Keys können versehentlich committed werden |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ⚠️ Teilweise – Dateien existieren, aber sind geschützt |
| **Code-Nachweis** | `.gitignore` enthält: |

```
.env.local
.env.local.maf
appservice-appsettings.generated.json
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟡 Akzeptiert für Prototyp |
| **Begründung** | Keys können nicht versehentlich ins Git-Repository committed werden. Lokale Dateien auf Entwickler-Maschine sind für Prototyp akzeptabel. |

### Für Produktion erforderlich
- [x] `.gitignore` für sensitive Dateien ✅
- [ ] Azure Key Vault für alle Secrets
- [ ] Key Rotation Policy (90 Tage)
- [ ] Managed Identity statt API-Keys

---

## F4: VITE_OPENAI_API_KEY Prefix

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🔴 Hoch |
| **Datei** | `live-transcriber/proxy-server.js` Zeile 86 |
| **Code** | `process.env.VITE_OPENAI_API_KEY` |
| **Risiko** | Vite baut `VITE_*` Variablen ins Frontend-Bundle ein → Key im Browser sichtbar |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ✅ Ja, vollständig |
| **Commit** | `1acc85f` – "Security A4: Remove VITE_OPENAI_API_KEY prefix" |
| **Code-Nachweis** | |

```javascript
// proxy-server.js Zeile 86
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// .env.local Zeile 1
OPENAI_API_KEY=sk-proj-...
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟢 Mitigiert |
| **Begründung** | Key wird nur serverseitig im Proxy verwendet, nicht ins Frontend-Bundle eingebaut. |

### Für Produktion erforderlich
- [x] VITE-Prefix entfernen ✅
- [ ] Managed Identity statt API-Key

---

## F5: Prompts/Transkripte in Logs

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🔴 Hoch |
| **Datei** | `live-transcriber/proxy-server.js` |
| **Risiko** | PII und vertrauliche Inhalte landen in Logs → DSGVO-Risiko |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ⚠️ Teilweise – 1 Stelle gefixt, 2 Stellen offen |
| **Commit** | `32f5050` – "Security A3: Reduce logging" |
| **Code-Nachweis** | |

**✅ Gefixt (nur Länge geloggt):**
```javascript
// Zeile 453
console.log("[AURA] Prompt length:", prompt.length, "chars");

// Zeile 1229-1234 (Transkript-Events)
transcript_length: parsed.transcript?.length ?? 0
```

**❌ Noch offen (erste 100 Zeichen geloggt):**
```javascript
// Zeile 653
console.log("[WORKFLOW] Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));

// Zeile 831
console.log("[MFA] Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟠 Verbesserung nötig |
| **Begründung** | 2 Stellen loggen noch Prompt-Anfang. Für Debugging hilfreich, aber sollte gefixt werden. |

### Für Produktion erforderlich
- [x] Prompt-Inhalte durch Längen ersetzen (teilweise) ✅
- [ ] **Zeile 653 und 831 fixen** (Quick-Fix, 10 Min)
- [ ] DLP-Filter in Application Insights
- [ ] Log-Retention auf 30 Tage begrenzen

---

## F6: HTTP ohne TLS

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🟡 Mittel |
| **Datei** | `live-transcriber/proxy-server.js` |
| **Code** | Proxy lauscht auf Port 8080 ohne TLS |
| **Risiko** | Man-in-the-Middle bei Netzwerk-Traffic |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ❌ Nein (bewusst) |
| **Code-Nachweis** | Proxy verwendet `http.createServer()` ohne TLS |

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟢 Akzeptiert für Prototyp |
| **Begründung** | Kommunikation ist nur lokal (`localhost`). Azure App Service erzwingt automatisch HTTPS für externe Verbindungen. |

### Für Produktion erforderlich
- [ ] HSTS Header setzen
- [ ] TLS 1.3 erzwingen
- [ ] Azure Front Door mit WAF

---

## F7: Beta-Pakete und CVEs

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🟡 Mittel |
| **Dateien** | `requirements.txt`, `package.json` |
| **Risiko** | Beta-Pakete können Sicherheitslücken haben, keine automatische CVE-Warnung |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ⚠️ Teilweise |
| **Commit** | `32540ac` – "Security A5: Dependency audit" |
| **Code-Nachweis** | |

**✅ npm audit (08.01.2026):**
```
found 0 vulnerabilities
```

**✅ aiohttp gepatcht:**
```
# requirements.txt Zeile 14
aiohttp==3.13.3  # War 3.13.2, 8 CVEs gefixt
```

**❌ Neue CVE entdeckt (08.01.2026):**
```
pip-audit:
urllib3 2.6.2   CVE-2026-21441   Fix: 2.6.3
```

**🟡 Beta-Pakete (bewusst akzeptiert):**
```
agent-framework-core==1.0.0b251223
agent-framework-azure-ai==1.0.0b251223
azure-ai-projects==2.0.0b2
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟠 Verbesserung nötig |
| **Begründung** | aiohttp gepatcht, aber neue urllib3-CVE. Beta-Pakete sind einzige Option für MAF. |

### Für Produktion erforderlich
- [x] pip-audit durchführen ✅
- [x] npm audit durchführen ✅
- [x] aiohttp patchen ✅
- [ ] **urllib3 auf 2.6.3 patchen** (Quick-Fix, 5 Min)
- [ ] Dependabot/Renovate aktivieren
- [ ] SBOM generieren und einchecken

---

## F8: Input-Validation

### Ursprünglicher Befund (07.01.2026)
| Aspekt | Details |
|--------|---------|
| **Schwere** | 🟡 Mittel |
| **Dateien** | `function_app.py`, `proxy-server.js` |
| **Risiko** | Prompts werden ungefiltert an LLMs weitergereicht → Prompt-Injection möglich |

### Aktueller Status (08.01.2026)
| Aspekt | Details |
|--------|---------|
| **Gefixt?** | ❌ Nein |
| **Code-Nachweis** | Keine `filter`, `validate`, `sanitize` Funktionen in `function_app.py` |

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟡 Akzeptiert für Prototyp |
| **Begründung** | Azure AI Content Safety Filter ist serverseitig in Azure AI Foundry aktiv. Für Prototyp mit internen Nutzern ausreichend. |

### Für Produktion erforderlich
- [ ] Client-seitige Input-Validation
- [ ] Azure Content Safety API explizit aufrufen
- [ ] Guardrails Framework implementieren
- [ ] Rate-Limiting pro User

---

# Teil C: Aktionsplan

## Sofort-Fixes (heute empfohlen)

| Priorität | Aktion | Aufwand | Befund |
|-----------|--------|---------|--------|
| 🔴 | urllib3 auf 2.6.3 patchen | 5 Min | F7 |
| 🟡 | Zeile 653 + 831 Logging fixen | 10 Min | F5 |

## Für Produktions-Release

| Priorität | Aktion | Aufwand | Befund |
|-----------|--------|---------|--------|
| 🔴 Hoch | AuthLevel.FUNCTION aktivieren | 1h | F1 |
| 🔴 Hoch | Key Vault Migration | 2-4h | F3 |
| 🟡 Mittel | Dependabot aktivieren | 30min | F7 |
| 🟡 Mittel | Rate-Limiting | 2h | F2, F8 |
| 🟢 Niedrig | SBOM generieren | 15min | F7 |
| 🟢 Niedrig | Input-Validation | 4-8h | F8 |

---

# Teil D: Änderungshistorie

| Datum | Version | Änderung |
|-------|---------|----------|
| 2026-01-07 | 1.0 | Initiale Sicherheitsanalyse – 8 Befunde identifiziert |
| 2026-01-07 | 1.1 | CORS-Fix implementiert (Commit `706fbbb`) |
| 2026-01-07 | 1.2 | Logging reduziert (Commit `32f5050`) |
| 2026-01-07 | 1.3 | VITE-Prefix entfernt (Commit `1acc85f`) |
| 2026-01-07 | 1.4 | aiohttp gepatcht (Commit `32540ac`) |
| 2026-01-07 | 2.0 | Dokument restrukturiert |
| 2026-01-08 | 3.0 | Vollständige Neuanalyse mit Code-Nachweisen, neue CVE entdeckt (urllib3) |

---

# Teil E: Git-Referenzen

## Relevante Commits
```
27294af  Security: Restructure risk assessment document
1de8b23  Security: Complete risk assessment documentation
32540ac  Security A5: Dependency audit - fix aiohttp CVEs
1acc85f  Security A4: Remove VITE_OPENAI_API_KEY prefix
32f5050  Security A3: Reduce logging - remove sensitive content
706fbbb  security: CORS hardening (local + Azure)
```

## Restore Points (Tags)
```
restore-point-2026-01-07-pre-security
restore-point-2026-01-07-post-cors
restore-point-2026-01-07-post-logging
restore-point-2026-01-07-post-A4
```

---

# Teil F: Vertraulichkeit

Dieses Dokument ist via `.gitignore` vom Git-Repository ausgeschlossen:
```
docs/SECURITY_RISK_ASSESSMENT_*.md
```

---

*Letzte Analyse: 08.01.2026 durch GitHub Copilot*
