# Security-Audit — Blog-Projekt

Datum: 2026-09-25
Scope: `src/app/**` (Angular-Frontend). Durchgeführt für Arbeitsblatt A1, Aufgaben 4, 5 und 7 (+ Experte).

## Aufgabe 4: innerHTML / bypassSecurityTrust / Interpolation / Redirects

Suche mit `grep -rn` über `src/app` (Suchbegriffe: `innerHTML`, `bypassSecurity`, `redirect`, `window.location`, `queryParams`).

| Nr. | Datei                                                                                        | Problem                                                                                                                                                                             | Risiko                                                                                                                                                                                                                                                                                  | Fix                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/app/blog-card/blog-card.html`, `src/app/feature/blog-detail-page/blog-detail-page.html` | `headerImageUrl` ist eine vom User beim Anlegen eines Blogs frei eingegebene URL (`blog.model.ts` erlaubt jede `z.string().url()`) und wird ungeprüft als `<img [src]>` ausgegeben. | Niedrig. Kein XSS (Angular bindet `src`, keine Script-Ausführung möglich), aber ein Autor kann eine beliebige Fremd-URL einbetten, die beim Aufruf des Blogs automatisch nachgeladen wird (IP-/User-Tracking durch Dritte, "Tracking-Pixel"-Missbrauch, Mixed-Content falls `http://`). | CSP `img-src` einschränken (siehe Aufgabe 7 — aktuell `https:` erlaubt, `http:` blockiert), optional Domain-Allowlist oder Bild-Proxy/Upload statt Fremd-URL. |
| 2   | –                                                                                            | Keine Verwendung von `[innerHTML]` im gesamten Projekt gefunden.                                                                                                                    | –                                                                                                                                                                                                                                                                                       | Kein Fix nötig — beibehalten: Alle Texte (Titel, Autor, Content-Preview, Fehlermeldungen) laufen über `{{ }}`-Interpolation, die Angular automatisch escaped. |
| 3   | –                                                                                            | Keine Verwendung von `bypassSecurityTrust*` gefunden.                                                                                                                               | –                                                                                                                                                                                                                                                                                       | Kein Fix nötig.                                                                                                                                               |
| 4   | `src/app/feature/login/login.ts`, `src/app/core/auth/auth-guard.ts`                          | `returnUrl` wird aus dem Query-Parameter gelesen und für eine echte Navigation (`window.location.href`) verwendet — klassischer Open-Redirect-Kandidat.                             | Bereits mitigiert (siehe Code): `login.ts` transformiert den Input und akzeptiert nur Werte, die mit `/` beginnen und _nicht_ mit `//` (verhindert protokollrelative Redirects wie `//evil.com`). Die BFF validiert laut Kommentar serverseitig erneut.                                 | Kein weiterer Fix nötig, nur dokumentiert als bewusst geprüfte Stelle.                                                                                        |

**Fazit Aufgabe 4:** Keine akuten XSS- oder Open-Redirect-Lücken im Frontend. Einziger dokumentierter Punkt (#1) ist ein Low-Risk-Finding zu nutzergesteuerten Bild-URLs, das über die CSP (Aufgabe 7) abgefedert wird.

## Aufgabe 5: Auth Guards

`src/app/app.routes.ts` ist die einzige Routing-Konfiguration im Projekt.

| Route                        | Guard                   | Öffentlich/geschützt | Status     |
| ---------------------------- | ----------------------- | -------------------- | ---------- |
| `''` (Blog-Übersicht)        | keiner                  | öffentlich           | ✅ korrekt |
| `blog/:id` (Detailseite)     | keiner                  | öffentlich           | ✅ korrekt |
| `about`                      | keiner                  | öffentlich           | ✅ korrekt |
| `login`                      | keiner                  | öffentlich           | ✅ korrekt |
| `add-blog` (Blog-Erstellung) | `canMatch: [authGuard]` | geschützt            | ✅ korrekt |
| `**` (Not Found)             | keiner                  | öffentlich           | ✅ korrekt |

`authGuard` (`src/app/core/auth/auth-guard.ts`) prüft `authStore.isAuthenticated()` und die Rolle `user`; nicht angemeldete Nutzer werden per `router.createUrlTree(['/login'], { queryParams: { returnUrl } })` zur Login-Seite umgeleitet, die geschützte Route selbst wird nie gematcht (`canMatch`, nicht nur `canActivate` — die Route ist für anonyme User faktisch unsichtbar, kein Lazy-Chunk wird geladen).

**Fazit Aufgabe 5:** Alle Anforderungen bereits erfüllt, keine Code-Änderung nötig.

## Aufgabe 7: Content Security Policy

Implementiert als `<meta http-equiv="Content-Security-Policy">` in `src/index.html` (nicht als HTTP-Header):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://d-cap-blog-backend---v2.whitepond-b96fee4b.westeurope.azurecontainerapps.io; object-src 'none'; base-uri 'self'; form-action 'self'
```

Begründung der Abweichungen von der reinen `'self'`-Minimalanforderung:

- **style-src** braucht `'unsafe-inline'`, weil Angular Material zur Laufzeit Inline-Styles injiziert (wie in der Aufgabenstellung vorgegeben), plus `fonts.googleapis.com` für das Google-Fonts-Stylesheet in `index.html`.
- **font-src** erlaubt `fonts.gstatic.com`, von wo die eigentlichen Font-Dateien geladen werden.
- **img-src** erlaubt `https:` wegen Finding #1 (nutzergesteuerte `headerImageUrl`); `data:` für evtl. inline-kodierte Icons.
- **connect-src** erlaubt zusätzlich die produktive API-Domain aus `environment.ts` (`apiUrl`), sonst würden alle `fetch`-Aufrufe der Blog-Liste blockiert. Im Dev-Server läuft alles über `/api` (same-origin, per `proxy.conf.json`), das deckt `'self'` bereits ab.
- **script-src**, **object-src**, **base-uri**, **form-action** bleiben strikt wie gefordert.

**Wichtiger Hinweis zur Deployment-Umgebung:** Das Projekt wird laut `README.md` als Azure-Storage-Static-Website gehostet, nicht über Azure Static Web Apps. `staticwebapp.config.json` würde dort _nicht_ ausgewertet werden (README dokumentiert das explizit), daher wurde bewusst die Meta-Tag-Variante gewählt, die auf jedem Static Hosting funktioniert. Nachteil: `frame-ancestors` und `report-uri` werden von Browsern in einem `<meta>`-CSP ignoriert. Sollte die App künftig hinter Azure Static Web Apps, Front Door oder einem CDN laufen, sollte die Policy stattdessen als echter `Content-Security-Policy`-Response-Header gesendet werden (z. B. via `staticwebapp.config.json` → `globalHeaders`).

## Experte: `npm audit`

Stand 2026-09-25, `npm audit` im Projekt-Root: **21 Findings** (10 high, 9 moderate, 2 low), alle in transitiven Abhängigkeiten.

| Paket                                                                                          | Severity          | Betroffen als                                                                          | Einschätzung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@angular/common`, `@angular/compiler`, `@angular/core`                                        | moderate          | direkte Runtime-Dependency                                                             | Einziger Fund mit echter Produktionsrelevanz (Code läuft im Browser). Fix bereits im erlaubten Versionsbereich verfügbar: `package.json` deklariert `^22.0.8`, installiert ist `22.0.8`, gefixt ist `22.1.1`+ (aktuell `22.2.0` verfügbar). Ein `npm install`/`npm update` würde die Lockfile-Version anheben, ohne `package.json` ändern zu müssen. **Nicht automatisch ausgeführt** — Dependency-Updates wurden bewusst nicht selbstständig vorgenommen, um keine ungefragte, breite `package-lock.json`-Änderung vorzunehmen; Empfehlung an den Entwickler, dies bei Gelegenheit selbst zu tun und die Tests laufen zu lassen. |
| `undici`, `body-parser`, `fast-uri`, `immutable`, `js-yaml`, `qs`, `@vitest/mocker`, `esbuild` | high/moderate/low | ausschließlich transitiv über Dev-Tooling (`vitest`, `@angular/build`, `@angular/cli`) | Betreffen nur den Build-/Testprozess, nicht den an Browser ausgelieferten Code — geringeres reales Risiko. `npm audit fix` (ohne `--force`) ändert hier nichts, da die Fixes Major-Bumps der Tooling-Pakete erfordern würden; nicht ohne Rücksprache mit Breaking-Change-Risiko durchgeführt.                                                                                                                                                                                                                                                                                                                                     |

**Empfehlung:** `npm update` für die drei `@angular/*`-Pakete zeitnah nachziehen (non-breaking, im deklarierten Semver-Bereich); die restlichen Findings beobachten, aber nicht dringend, da sie das ausgelieferte Frontend nicht betreffen.
