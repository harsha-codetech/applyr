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

## First run in real Chrome — done

`npm run e2e` installs the extension into a real Chrome over the DevTools
Protocol and drives it end to end: 23 checks, all passing. Chrome 137+ silently
ignores `--load-extension`, so `Extensions.loadUnpacked` is used instead, behind
`--enable-unsafe-extension-debugging`.

The first run found three bugs that no unit test or fixture could have caught:

- **Backup and restore were completely broken.** `exportAll` and `importAll`
  used `await import('./util.js')`, and dynamic import is forbidden in a service
  worker by the HTML spec. Both threw on every call — in the one feature the
  README calls the user's only backup. Now statically imported.
- **The resume was never attached, anywhere.** The resolver looked for
  `values.resume_file`, but documents live in the vault, not in the values map,
  so every upload was marked skipped before the adapter could consult the
  vault. The fixture runs had recorded that as expected output, which is why it
  went unnoticed. Generic-mode coverage went from 92% to 100% once fixed.
- **The tracker duplicated entries.** find-by-url and write were two separate
  awaits, so two frames of one page each created their own row. With
  `all_frames` enabled that is the normal case on an iframe-embedded Greenhouse.
  All read-modify-write storage operations are now serialized through one
  promise chain, and the find-and-write is a single atomic call.

## Live verification of wave-1 — done

Lever, Greenhouse and Ashby were re-checked against real postings on 18 Sep 2026
and all three needed fixes. Selector resolution was done read-only; nothing was
written to a live employer form.

- **Greenhouse had drifted a generation.** The modern board
  (job-boards.greenhouse.io) drops `name` attributes entirely, uses bare ids, and
  renders Country and every EEO question as `role=combobox` text inputs instead
  of `<select>`. Every EEO selector in the old pack missed. Both generations are
  now covered, modern selectors first.
- **Ashby only has three real system fields.** Phone, location and the link
  fields are per-employer custom fields named with a bare UUID and cannot be
  packed at all — generic mode answers them from their labels. The resume input
  has `id=_systemfield_resume` but no `name`, so the old selector missed. The
  bare `input[type=file]` fallback was removed: the first file input on the page
  is the autofill-from-resume uploader, so the fallback would have attached the
  resume to the wrong control. EEO groups are radios suffixed
  `__systemfield_eeoc_*` — including `_veteran_status` and `_disability_status`,
  not the shorter names first assumed.
- **Lever was accurate**; added the confirmed `location` field and the pronouns
  radio group.
- **Greenhouse renders reCAPTCHA as a real `<textarea>`.** The detector now
  ignores captcha, CSRF, honeypot and `aria-hidden` controls, so question memory
  can never be poured into the field that decides whether you are a bot.

## Wave-2 packs — complete

Recruitee and BambooHR, the two deferred for want of a live form, are done. All
nine packs are now checked against a real application form.

- **Recruitee** — the form lives at `/o/<slug>/c/new`, not on the posting page.
  Everything is namespaced `candidate.*`, EEO answers are radio groups named
  `eeo.<attribute>`, and screening questions carry a per-posting id. 9/9 hit.
- **BambooHR** — the form does not exist until "Apply for This Job" is clicked;
  the MutationObserver picks it up. Address parts use a `.value` suffix. 14/14
  hit. Its Submit and Cancel buttons are *both* `type=submit`, so the pack ships
  an empty `submit` list and relies on the button-text heuristic — a selector
  there would have logged a submission every time someone cancelled.

### The honeypot

The BambooHR form carries a honeypot named `nickname_hpcsaf`, labelled "Please
leave this field blank". It is **fully visible** — 214x28 pixels, opacity 1, no
`display:none` — so nothing about its geometry gives it away, and "nickname"
matches the taxonomy's `preferred_name` pattern. applyr would have filled it and
told the employer a bot submitted the application.

The detector now ignores controls whose name matches a honeypot suffix pattern
or whose label says to leave them blank. A copy of the real field is in
`fixtures/generic-unknown.html`, and the e2e asserts it stays empty and never
enters the fill plan.

The first version of that fix also excluded every `tabindex="-1"` control, which
looked like a strong signal and was not: on the same BambooHR form the real
Country and Highest Education selects are `tabindex="-1"` because they sit
behind custom widgets, and Greenhouse marks its combobox inner inputs the same
way. It was dropped, with a test pinning the decision.

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
