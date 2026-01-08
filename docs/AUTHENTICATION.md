# ContextPilot Authentication Guide

**Stand:** 08.01.2026  
**Status:** FUNKTIONIERT - NICHT ANFASSEN!

## Login URLs

| Account | Provider | Login URL |
|---------|----------|-----------|
| martih@microsoft.com | Azure AD | https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/login/aad?prompt=select_account |
| JohnMavic | GitHub | https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/login/github |

## Logout

https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/logout

## Wer ist eingeloggt?

https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/me

Zeigt JSON mit userDetails und userRoles. Muss enthalten:
- userRoles: ["anonymous", "authenticated", "alloweduser"]

## Setup (Januar 2026)

### SWA Role Management mit Invitations

1. staticwebapp.config.json: Route /* erfordert Role alloweduser
2. Azure Portal - Static Web Apps - ContextPilot - Role Management:
   - Einladung fuer martih@microsoft.com (AAD) mit Role alloweduser
   - Einladung fuer JohnMavic (GitHub) mit Role alloweduser
3. WICHTIG: Einladungslinks muessen geoeffnet und akzeptiert werden!

### Zwei Provider noetig

| Account | Provider | Grund |
|---------|----------|-------|
| martih@microsoft.com | Azure AD | Corporate Account (Work/School) |
| JohnMavic | GitHub | Hotmail ist kein AAD - braucht GitHub |

## Troubleshooting

### 403 Forbidden
- Einladung nicht akzeptiert oder alloweduser Role fehlt
- Pruefe mit /.auth/me ob alloweduser in userRoles ist
- Falls nicht: Neue Einladung im Azure Portal erstellen und Link oeffnen

### Falscher Account
- AAD cached Accounts
- Loesung: ?prompt=select_account an Login-URL

### Session zuruecksetzen
https://ashy-dune-06d0e9810.4.azurestaticapps.net/.auth/purge/aad

## Lokale Entwicklung

Keine Auth noetig - staticwebapp.config.json wird auf localhost ignoriert.
