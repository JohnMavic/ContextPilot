# ContextPilot Authentication Guide

**Stand:** 08.01.2026

## Login URLs

| Account | Provider | Login URL |
|---------|----------|-----------|
| `martih@microsoft.com` | Azure AD | https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/login/aad?prompt=select_account |
| `JohnMavic` (GitHub) | GitHub | https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/login/github |

## Logout

```
https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/logout
```

## Setup

### Gewählte Lösung: SWA Role Management mit Invitations

Wir nutzen die **Built-in Authentication** von Azure Static Web Apps mit **Custom Roles**:

1. **`staticwebapp.config.json`** definiert:
   - Route `/*` erfordert Role `alloweduser`
   - Nicht-authentisierte User werden zu AAD Login weitergeleitet

2. **Azure Portal → Static Web Apps → ContextPilot → Role Management**:
   - Einladungen für spezifische User erstellt
   - Jeder eingeladene User erhält die Role `alloweduser`

### Warum zwei Provider?

| Account | Warum dieser Provider? |
|---------|------------------------|
| `martih@microsoft.com` | Corporate Account → **Azure AD** (Work/School Account) |
| `JohnMavic` | Persönlicher Account (`@hotmail.com`) → **GitHub** (da Hotmail kein AAD ist) |

### Konfigurationsdateien

- **`live-transcriber/staticwebapp.config.json`**: Routing und Auth-Regeln
- **Azure Portal**: Role Management für User-Einladungen

## Troubleshooting

### 403 Forbidden
- Du bist eingeloggt, aber mit einem Account ohne `alloweduser` Role
- Lösung: Logout → Login mit korrektem Account

### Falscher Account wird automatisch verwendet
- AAD cached den letzten Account
- Lösung: `?prompt=select_account` an die Login-URL anhängen

### Session-Probleme
```
https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/purge/aad
```

## Lokale Entwicklung

`staticwebapp.config.json` wird lokal ignoriert - keine Authentisierung nötig auf `localhost`.
