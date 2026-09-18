# applyr — plan and status

Decisions locked at the start of the project:

| | |
|---|---|
| Audience | Chrome Web Store product |
| Data | Local-only, IndexedDB + `chrome.storage`, no LLM, no backend |
| First targets | Lever + Greenhouse + Ashby, with "everything" as the roadmap |
| Boundary | Assist-only. No auto-submit, no job-board automation, no detection evasion |

---

## v1 — shipped

| Phase | State | Notes |
|---|---|---|
| 0. Scaffold | done | MV3, no build step, no dependencies |
| 1. Data layer | done | Taxonomy (58 fields), profile schema, IndexedDB vault, editor |
| 2. Fill engine | done | Detector → resolver → adapters → verify |
| 3. Test harness | done | 31 `node:test` cases + 4 browser fixtures |
| 4. ATS packs | done | Lever, Greenhouse, Ashby |
| 4b. Generic mode | done | 92% on the legacy fixture with no pack |
| 5. Question memory | done | Trigram recall at 0.72, teach-from-HUD |
| 6. Tracker | done | Auto-logged on fill and on detected submit, CSV export |
| 7. Store package | done | `npm run zip`, privacy policy, onboarding, per-site permissions |

Measured on the fixtures: Lever 8/8 fillable, Greenhouse 7/7 (+2 correctly
withheld as demographic), hard-mode 8/8 across both wizard steps, unknown
legacy form 11/12.

## v1.1 — in progress

- **Wave-2 packs — done for four of six.** Workable, SmartRecruiters, Pinpoint
  and JazzHR were each written against a live application form and their
  selectors verified read-only in the browser on 18 Sep 2026.
  - *Recruitee* and *BambooHR* are deferred: every company board reachable at
    the time redirected to the vendor marketing site, so no live form could be
    inspected. Rather than ship guessed selectors they stay in generic mode.
    Revisit when a live board is available.
  - Each pack now carries `verifiedAgainstLiveForm`, enforced by a test, so
    fixture-only packs (Lever, Greenhouse, Ashby) are visibly distinguished from
    live-verified ones.
  - Note on SmartRecruiters: its apply flow is a wizard of `<spl-button>` custom
    elements with no real submit button, and the only `button[type=submit]` on
    the page is the cookie-settings control. Its `submit` list is therefore
    deliberately empty so the tracker cannot log a false submission; detection
    falls back to the confirmation-screen heuristic.
- **Fixture capture command** — snapshot a live page into `fixtures/` so a pack
  can be written against a real DOM offline.
- **Résumé-per-application** — pick which document goes with which posting
  rather than always using the default.

## v2

- **Workday** (4–6d). Its own phase: multi-step wizard state machine keyed on
  `data-automation-id`, per-employer accounts, tenant selector drift. Expect
  ~70% coverage and ongoing maintenance. The MutationObserver rescan built in
  Phase 2 is the foundation; hard-mode.html already exercises it.
- **Naukri assisted mode** (3d). Read-only: parse the listings you are already
  browsing, score against the profile, surface matches in the panel, one-click
  open and fill. No automated submission, no background crawling, no velocity
  beyond your own browsing.
- **Remote selector packs** (2d). Fetch `index.json` and the packs from a static
  URL with the bundled copy as fallback, so a selector break is a one-hour fix
  instead of a store-review cycle. Legal under MV3 because packs are data, not
  code — the format was designed for this from day one. Needs no backend: a
  static file on any CDN.

## v2.1+

- **Legacy enterprise**: iCIMS, Taleo, SuccessFactors, Avature (2–3d each).
  Deliberately last — the most work per point of coverage, and generic mode
  already gets partial fill there.

## Explicitly out of scope

- Clicking Submit
- Automating LinkedIn, Naukri, Indeed or any job board's own UI
- Fingerprint rotation, stealth plugins, or any anti-detection work
- Fiverr/Upwork proposal automation — a different product (bidding, not
  applying), and a fast route to account suspension

The reasoning is in the README under **Scope**. Short version: on a logged-in
account the platform already knows who you are, so fingerprint spoofing changes
nothing about behavioural detection while inconsistency is itself a signal —
and removing the final click buys little against the risk to the account the
applications are for.
