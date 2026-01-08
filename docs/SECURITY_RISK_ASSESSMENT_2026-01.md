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
| F1 | AuthLevel.ANONYMOUS | 🔴 | 🟢 Gefixt | ✅ Erledigt |
| F2 | CORS `*` | 🔴 | 🟢 Gefixt | ✅ Erledigt |
| F3 | Klartext-Secrets | 🔴 | 🟡 Geschützt | 🟡 Akzeptiert |
| F4 | VITE_OPENAI_API_KEY | 🔴 | 🟢 Gefixt | ✅ Erledigt |
| F5 | Prompts in Logs | 🔴 | � Gefixt | ✅ Erledigt |
| F6 | HTTP ohne TLS | 🟡 | 🟡 Offen | 🟢 Akzeptiert |
| F7 | CVEs in Dependencies | 🟡 | 🟢 Gefixt | ✅ Erledigt |
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
| **Gefixt?** | ✅ Ja |
| **Commit** | `64fab75` |
| **Code-Nachweis** | |

**Vorher:**
```python
app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
```

**Nachher:**
```python
# SECURITY: AuthLevel.FUNCTION erfordert x-functions-key Header oder ?code= Parameter
app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)
```

**Verifizierung:**
```bash
# OHNE Key: 401 Unauthorized ✅
curl https://contextpilot-mfa-func.azurewebsites.net/api/healthz

# MIT Key: 200 OK ✅
curl -H "x-functions-key: <key>" https://contextpilot-mfa-func.azurewebsites.net/api/healthz
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟢 Mitigiert |
| **Begründung** | Function erfordert jetzt Function Key. Proxy hat Key in App Settings konfiguriert. |

### Für Produktion erforderlich
- [x] `AuthLevel.FUNCTION` setzen ✅
- [x] Function Key im Proxy konfigurieren ✅
- [ ] Key-Rotation Policy einrichten
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
| **Gefixt?** | ✅ Ja, vollständig |
| **Commits** | `32f5050` + `a940369` |
| **Code-Nachweis** | |

**✅ Alle Stellen gefixt (nur Länge geloggt):**
```javascript
// Zeile 453
console.log("[AURA] Prompt length:", prompt.length, "chars");

// Zeile 653 (gefixt am 08.01.2026)
console.log("[WORKFLOW] Prompt length:", prompt.length, "chars");

// Zeile 831 (gefixt am 08.01.2026)
console.log("[MFA] Prompt length:", prompt.length, "chars");

// Zeile 1229-1234 (Transkript-Events)
transcript_length: parsed.transcript?.length ?? 0
```

### Prototyp-Bewertung
| Aspekt | Details |
|--------|---------|
| **Status** | 🟢 Mitigiert |
| **Begründung** | Alle Prompt-Logs zeigen nur noch Längen, keine Inhalte mehr. |

### Für Produktion erforderlich
- [x] Prompt-Inhalte durch Längen ersetzen ✅
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
| **Gefixt?** | ✅ Ja, vollständig |
| **Commits** | `32540ac` + `a940369` |
| **Code-Nachweis** | |

**✅ npm audit (08.01.2026):**
```
found 0 vulnerabilities
```

**✅ pip-audit (08.01.2026):**
```
No known vulnerabilities found
```

**✅ aiohttp gepatcht:**
```
aiohttp==3.13.3  # War 3.13.2, 8 CVEs gefixt
```

**✅ urllib3 gepatcht (08.01.2026):**
```
urllib3==2.6.3  # War 2.6.2, CVE-2026-21441 gefixt
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
| **Status** | 🟢 Mitigiert |
| **Begründung** | Alle bekannten CVEs gepatcht. Beta-Pakete sind einzige Option für MAF und werden akzeptiert. |

### Für Produktion erforderlich
- [x] pip-audit durchführen ✅
- [x] npm audit durchführen ✅
- [x] aiohttp patchen ✅
- [x] urllib3 patchen ✅
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

## Sofort-Fixes ✅ Erledigt (08.01.2026)

| Priorität | Aktion | Status | Befund |
|-----------|--------|--------|--------|
| 🟢 | urllib3 auf 2.6.3 patchen | ✅ Erledigt | F7 |
| 🟢 | Zeile 653 + 831 Logging fixen | ✅ Erledigt | F5 |

## Für Produktions-Release

| Priorität | Aktion | Status | Befund |
|-----------|--------|--------|--------|
| 🟢 | AuthLevel.FUNCTION aktivieren | ✅ Erledigt | F1 |
| 🔴 Hoch | Key Vault Migration | Offen (2-4h) | F3 |
| 🟡 Mittel | Dependabot aktivieren | Offen (30min) | F7 |
| 🟡 Mittel | Rate-Limiting | Offen (2h) | F2, F8 |
| 🟢 Niedrig | SBOM generieren | Offen (15min) | F7 |
| 🟢 Niedrig | Input-Validation | Offen (4-8h) | F8 |

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
| 2026-01-08 | 3.0 | Vollständige Neuanalyse mit Code-Nachweisen |
| 2026-01-08 | 3.1 | F5 komplett gefixt, F7 urllib3 gepatcht (Commit `a940369`) |
| 2026-01-08 | 3.2 | **F1 gefixt: AuthLevel.FUNCTION + Function Key (Commit `64fab75`)** |

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
restore-point-2026-01-08-before-authlevel-fix
```

---

# Teil F: Vertraulichkeit

Dieses Dokument ist via `.gitignore` vom Git-Repository ausgeschlossen:
```
docs/SECURITY_RISK_ASSESSMENT_*.md
```

---

*Letzte Analyse: 08.01.2026 durch GitHub Copilot*
