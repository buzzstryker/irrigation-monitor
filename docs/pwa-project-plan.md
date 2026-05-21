# Project Plan: irrigation-monitor-app (PWA)

## Overview
A mobile-first Progressive Web App for monitoring residential irrigation while traveling. Companion to the irrigation-monitor backend (Hydrawise polling + Supabase + Railway). Loads in any browser, can be added to phone home screen, reads from the same Supabase database that the backend writes to.

This is a NEW repo separate from irrigation-monitor.

Status: Planning. No code exists yet.

## Stack
- Frontend: Next.js 15 (App Router) with TypeScript
- UI: shadcn/ui + Tailwind CSS
- PWA: next-pwa
- Data: @supabase/supabase-js (the publishable anon key, NOT the service key — this is client-side)
- Auth: Supabase OTP (6-digit code via email, NOT magic links)
- Hosting: Vercel (free tier sufficient for one user)
- Domain: Vercel-provided subdomain (e.g., irrigation-monitor-app.vercel.app); no custom domain for v1

## v1 Scope

### In scope
- Auth flow: enter email/phone, receive OTP, log in
- One-page dashboard, mobile-first stacked layout
- Three sections:
  1. **Service health strip** — last poll timestamp, last watering event, last tank reading. Color-coded for freshness (green/yellow/red).
  2. **Tank level chart** — last 24 hours of tank_level_log data, with threshold lines at 981 (max), 450 (safety floor), 408 (pump cutoff).
  3. **Recent watering events table** — last 7 days, sortable on date column. Six columns: When, Controller, Zone (id+name), Duration, Gallons (calc), Calc GPM.
- "Add to Home Screen" support (manifest.json, icons, service worker for offline shell caching)
- Pull-to-refresh and manual refresh button
- Logout button in a settings/menu corner

### Explicitly NOT in v1
- GPM editing UI (stays on Lenovo desktop dashboard for now)
- Realtime data subscriptions (page reload triggers fresh data)
- Push notifications (defer to v2 or later)
- Custom design system (use shadcn/ui defaults)
- Custom domain (use Vercel subdomain)
- Multi-user / multi-property support (single user, single site)
- Settings/preferences UI (no user-configurable options)

### Possibly v2 candidates (just list, don't commit)
- Realtime subscriptions for live updates as zones run
- Push notifications for tank-below-safety-floor alerts
- GPM editing
- Calendar view of watering schedule
- Per-zone history drill-down
- Tuya tank sensor display (once sensor lands; would integrate naturally)

## Architecture
```
Hydrawise API
↓
Railway poll.js  →  Supabase Postgres
↓
Lenovo server.js (desktop dashboard, port 3001)
↓
Browser at localhost:3001 (full feature set)

               PWA on Vercel (mobile dashboard)
                     ↓ (auth via OTP)
               Browser anywhere (read-only subset, mobile-first)
```

Both the Lenovo desktop dashboard and the PWA read from the same Supabase database. They are independent; either can go down without affecting the other.

The PWA does NOT have its own backend code. It's a static Next.js app that talks directly to Supabase from the browser using the publishable (anon) key with Row Level Security policies controlling access.

## Authentication & Security
Supabase OTP via 6-digit code (email or SMS). After verification:
- Supabase issues a session token stored in browser
- The token authenticates subsequent queries (still subject to RLS)
- Session persists until user logs out or token expires

**Important architectural detail:** the PWA uses the Supabase publishable (anon) key, NOT the service_role key. The service key bypasses RLS and grants admin access; it must NEVER be in client-side code. The publishable key is safe in the browser (and is in fact designed for that).

This means RLS policies need to be configured on the relevant tables (tank_level_log, watering_events, zone_state_log) to allow authenticated users to read their data. We currently have RLS enabled but no policies, which means the publishable key reads nothing — which is correct default-closed behavior.

### Authentication lessons from prior project (Windex / Late Add v2)

**Context:** The Windex project (Late Add v2, Supabase + Expo + Vercel, late 2025 through mid-2026) encountered a category of auth bugs related to magic links that disappeared entirely when switching to OTP codes. The lessons are directly applicable to this PWA.

**TL;DR from Windex:**
- Magic links and OTP codes look interchangeable in Supabase's UI but behave very differently in web deployments
- Magic links create URL fragment parsing bugs, router race conditions, and single-use device-binding failures
- OTP codes (user types a 6-digit code from email) eliminate the entire category of URL handoff problems
- **Four prevention items that belong in Phase C from day one:**
  1. Use 6-digit OTP codes, not magic links
  2. Capture any incoming auth params at module load, before the router mounts and strips them
  3. Add a grace period (30s starting value) before 401s trigger signout
  4. Edge functions called from contexts without a JWT need `--no-verify-jwt`

**Why magic links failed on Windex:**
- Expo Router (and Next.js App Router to a lesser extent) strips URL fragments before auth code can read them
- Session handoff became racy — setting session then navigating sometimes lost the session
- Magic links are single-use and device-bound; clicking on phone when you wanted laptop = recovery failure
- iOS Mail "preview" consumed links before user clicked them

**Why OTP codes work:**
- No URL handoff means no router involvement; code is just a string the user types
- No single-use device binding; user can request code on one device and enter on another
- Failures are visible and recoverable (wrong code → clear error, expired code → request new one)
- Stable on Windex for months after the switch

**Subtler bugs that survived the OTP switch:**
- **Auth code captured too late:** Even with OTP, password recovery and OAuth callbacks emit codes in URLs. Fix: capture URL params at module load (before React/router mounts) in a bootstrap file.
- **Spurious 401s triggering signout:** Supabase sessions can momentarily return 401 during token refresh or network blips. Fix: add 30s grace period before treating 401 as "session dead."
- **Edge functions 401-looping:** Functions called from webhooks/cron/public endpoints without a user JWT need `--no-verify-jwt` or they 401-loop silently.

**Cross-cutting principle (applies beyond auth):** Prefer flows that don't depend on URL handoffs in a Next.js + Vercel deployment. Router behavior, browser URL normalization, and fragment handling interact in hard-to-debug ways. Anything you can do in-app (code entry, manual paste, in-app navigation) is more robust than anything that crosses an `https://...?token=...` boundary.

**Windex project checklist (transplanted to this project):**
1. Set Supabase email template to OTP, not magic link
2. Build a code-entry form, not a "check your email and click the link" screen
3. Capture URL params at module load in a bootstrap file (required for password recovery flows)
4. Wrap 401 handler in a grace period before triggering signout (30s starting value)
5. Audit edge functions for JWT verification needs
6. Test on Safari early (Chrome is forgiving about fragment timing; Safari isn't)

These six items are integrated into Phase C below.

## Required Supabase setup (manual, before code work)
- Enable Supabase Auth and pick OTP provider (email or SMS)
  - Email is simpler (no Twilio account needed)
  - SMS requires Twilio integration (which is on the deferred Phase 3 list anyway)
- **Configure email template to send 6-digit OTP code, NOT magic link**
  - Supabase dashboard → Authentication → Email Templates → "Magic Link" template
  - Replace `{{ .ConfirmationURL }}` content with the OTP code variable
  - Or use a fully separate "Email OTP" template
- Configure RLS policies on read-relevant tables:
  - tank_level_log: SELECT allowed for authenticated users
  - watering_events: SELECT allowed for authenticated users
  - zone_state_log: SELECT allowed for authenticated users
- Add the user (buzz) as an authorized user in Supabase Auth

## Project setup checklist (chronological)

### Phase A: Repo & Vercel setup (~15 min, manual)
- A.1 Create new GitHub repo: irrigation-monitor-app
- A.2 Create Project_Context.md in the new repo (use template from Project_Context_TEMPLATE.md)
- A.3 Link new repo to Vercel
- A.4 Verify free-tier hosting plan

### Phase B: Local scaffold (~30 min, autonomous prompt)
- B.1 Initialize Next.js 15 with TypeScript, App Router, Tailwind
- B.2 Install shadcn/ui, next-pwa, @supabase/supabase-js
- B.3 Configure tailwind.config.ts, manifest.json, basic icons
- B.4 Set up basic project structure (app/, components/, lib/)
- B.5 Add .env.local with SUPABASE_URL and SUPABASE_ANON_KEY
- B.6 Commit and push

### Phase C: Auth integration (~30 min, autonomous prompt)
- C.1 Create Supabase client utility (lib/supabase.ts)
- C.2 **Create auth bootstrap file** to capture URL params at module load (before router mounts) — required for password recovery flows even though primary auth is OTP
- C.3 Login page with **6-digit OTP code entry form** (NOT magic link click flow)
  - Email input → send OTP → user types code → verify
  - Use `supabase.auth.verifyOtp({ email, token, type: 'email' })`
- C.4 Auth context / middleware to protect routes
- C.5 **Implement 401 grace period** (30s starting value) before triggering signout — prevents spurious logouts during token refresh
- C.6 Logout button
- C.7 **Test on Safari early** (not just Chrome) — Safari is less forgiving about timing/fragment issues
- C.8 Test end-to-end auth flow on Vercel preview
- C.9 Commit and push

**Prevention items from Windex (all four integrated above):**
1. ✓ Use 6-digit OTP codes, not magic links (C.3)
2. ✓ Capture URL params at module load before router strips them (C.2)
3. ✓ Add grace period before 401s trigger signout (C.5)
4. ✓ Edge functions JWT verification — not applicable to v1 (no edge functions in scope)

### Phase D: Dashboard data + UI (~1-2 hours, autonomous prompt)
- D.1 Data fetching hooks for the three sections (health, tank chart, events)
- D.2 Service health strip component
- D.3 Tank level chart component (Chart.js or Recharts — pick best Next.js fit)
- D.4 Recent watering events table component
- D.5 Mobile-first responsive layout
- D.6 Pull-to-refresh + manual refresh button
- D.7 Loading states and error states
- D.8 Commit and push

### Phase E: PWA configuration (~30 min, autonomous prompt)
- E.1 next-pwa configuration in next.config.mjs
- E.2 manifest.json with proper icons, theme color, display mode (standalone)
- E.3 Service worker for offline shell caching
- E.4 Test "Add to Home Screen" works on iOS Safari and Android Chrome
- E.5 Commit and push

### Phase F: Polish & verification (~30 min, autonomous prompt)
- F.1 End-to-end smoke test: login, view data, refresh, logout
- F.2 Lighthouse PWA audit (should pass all PWA criteria)
- F.3 Mobile device test on at least one phone
- F.4 Document the URL and login flow in Project_Context.md

Total estimated effort: 3-4 hours across 5 autonomous prompts + 2 manual setup steps.

## Open questions for human review

1. **Email or SMS for OTP?** Email is simpler (no Twilio needed). SMS is more familiar but requires Twilio setup. Default recommendation: email. **Note:** OTP code method is decided (per Windex lessons); this question is just about delivery channel.
2. **RLS policy granularity:** authenticated users can read everything, or further restrict (e.g., only the buzz user)? For one-user system, "any authenticated user" is fine and simpler. Default: any authenticated user.
3. **Service worker scope:** cache the app shell (HTML/CSS/JS) for offline UI even when network is down, vs. cache nothing (PWA without offline). Default recommendation: cache app shell so UI loads offline; data fetches will fail gracefully but the user sees something rather than a broken page.
4. **Chart library:** Chart.js (used in current Lenovo dashboard) or Recharts (more idiomatic React)? Default: Recharts for the new project.
5. **Domain name for v1:** stick with Vercel subdomain (irrigation-monitor-app.vercel.app), or pay for a custom domain? Default: Vercel subdomain.

## Risks
- **Vercel free tier limits:** generous but not unlimited. With one user and infrequent loads, well under limits. Worth knowing the bandwidth and request limits before committing.
- **Auth complexity:** OTP works smoothly when configured right but has edge cases (rate limiting, expired codes, email deliverability). Plan for ~30 min of debugging during phase C.
- **Time zone handling:** dashboards display timestamps; the backend stores Unix epoch UTC; the PWA needs to convert to user's local time for display. Easy to get wrong; worth explicit care.
- **Two databases of truth:** as long as Lenovo desktop dashboard exists, two clients read from Supabase. They don't conflict, but their UI may show slightly different data due to caching/timing. Acceptable for v1.

## Recommended next steps

After this plan is committed:

1. **Decide on email vs SMS OTP** (5 minutes of thought)
2. **Manually create the GitHub repo and Vercel project** (Phase A, ~15 min)
3. **Run the Phase B prompt** (scaffold) when ready
4. **Continue through Phases C-F sequentially**

There's no urgency. Each phase can be its own focused session, ideally with sleep or daylight between when possible.

## Working agreement
The new irrigation-monitor-app project follows the same working agreement as irrigation-monitor (see Buzz_Project_Development_Procedure.md). Key rules that apply:
- 3.2a — Every session ends with clean git status
- 3.2b — Vercel deploys are git operations; commit source in same session
- 4.1a — N/A (this is its own repo, no path-filter needed)

---

*Last updated: 2026-05-21 — Planning phase. Auth approach decided (6-digit OTP, not magic links, per Windex lessons). No code exists yet. Next: create repo (Phase A).*
