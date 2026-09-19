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

## Remote selector packs — done

The upgrade the pack format was designed for from day one. `npm run packs:bundle`
writes `packs.json`; an install that has opted in fetches it and a broken
selector becomes a one-hour fix instead of a store-review cycle.

Three things keep it from being a back door:

1. **Data, never code.** JSON of CSS selector strings, parsed with `JSON.parse`.
   Nothing fetched is executed, imported, or inserted into a page — which is what
   keeps it legal under MV3’s ban on remotely-hosted code.
2. **Off by default, with its own permission.** With it off the extension makes
   no network requests at all, and the permission is requested only on enable.
   The privacy claim in the README and PRIVACY.md was rewritten to match rather
   than left as it was.
3. **Validated before use, rejected whole.** `core/pack-source.js` refuses a
   bundle if any pack references an unknown field, points a selector at a
   password input, routes a document upload at something that is not an upload,
   claims a host another pack owns, or uses a wildcard host. A remote pack can
   replace or add, never remove, so a source that goes wrong degrades to what
   shipped.

The e2e serves a deliberately hostile bundle (`fixtures/bad-packs.json`) and
asserts it is refused with the reason, that the previously good packs survive,
and that filling still works afterwards — the rule is tested, not asserted.

## Naukri assisted mode — done

Read-only, exactly as scoped. Selectors confirmed against a live Naukri search
page on 18 Sep 2026: `.srp-jobtuple-wrapper[data-job-id]` cards with `a.title`,
`a.comp-name`, `.expwdth`, `.locWdth`, `.sal-wrap`, `.tag-li`, `.job-post-day` —
20 cards per page, every field resolving.

New concepts:

- **Board profiles** (`src/boards/*.json`) — the read-only counterpart to packs.
  A pack says how to *fill* a form; a board profile says how to *read* the cards
  on a listings page. They are kept apart deliberately: nothing in a board
  profile can cause a write, and nothing in it describes navigation.
- **`src/core/matching.js`** — local scoring, no model: skills overlap (0.45),
  experience fit (0.30), location (0.15), title similarity (0.10). Every score
  carries its reasons so the panel can explain itself and the user can disagree.
  Missing profile data degrades to neutral rather than zero — an empty profile
  makes jobs *unknown*, not bad.
- **`skills` in the taxonomy** — needed for scoring, and it fills ATS skills
  fields too.

The boundary, enforced by the e2e: the board page is never treated as an
application, nothing is written to it, and applyr does not navigate it. It reads
what the user is looking at and reorders it. There is no code path that visits a
URL the user did not.

Not done and not planned: applying through Naukri. Where a listing leads to the
employer's own ATS, the normal packs take over there.

## Workday — engine done, pack partially verified

Workday is not like the others, and the honest summary is that the machinery is
finished and tested while the selectors are not confirmed.

**Verified live** on a real tenant: the job posting page, the apply chooser
(`adventureButton` → `autofillWithResume` / `applyManually` /
`useMyLastApplication`), and the apply-flow shell (`applyFlowPage`,
`progressBar`, `progressBarActiveStep`, `backToJobPosting`, `jobTitleHeading`).

**Not verifiable**: step 1 of 6 is mandatory account creation, so My Information,
My Experience, Application Questions, Voluntary Disclosures and Self Identify are
only reachable with credentials. Those selectors follow Workday's documented
`data-automation-id` conventions and are exercised against
`fixtures/workday-like.html`, but no real form has ever been seen. The pack
records `verifiedAgainstLiveForm: null` and says why in its notes. Treat the
first real application as the verification pass.

### Engine work this required

- **Split date fields.** Workday renders one date as three boxes
  (`dateSectionMonth-input`, `-Day-`, `-Year-`). The detector now groups them
  into a single `date-group` descriptor carrying the wrapper's label, and a new
  adapter fills each segment with its own events — the widget validates per
  segment, so writing all three silently does nothing otherwise.
- **Wizard step reporting.** Accessible multi-step forms announce "current step
  2 of 6" as text, so one regex covers every ATS that bothers, with no per-site
  configuration. The panel shows it.
- **A refusal to fill credential screens.** Marking the account gate "not an
  application" was not enough on its own: an explicit Fill still typed the
  user's email into it. The content script now refuses any page containing a
  password field. Known trade-off: some iCIMS and Taleo flows combine account
  creation with the application, and those will refuse too until this can tell
  the two apart.
- **submit is empty for Workday on purpose.** There is no single submit control —
  each step ends with `bottom-navigation-next-button` and only the final Review
  step sends anything, so matching a Next button would log an application that
  was never submitted.

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

## iCIMS — done

The first of the legacy enterprise ATSs, and the one that required real engine
changes rather than just a selector file.

Verified against globalcareers-customer0.icims.com on 19 Sep 2026: the iframe
wrapper (`#icims_content_iframe`), the email step (`css_loginName`,
`accept_privacy`, `#enterEmailSubmitButton`) and the hCaptcha textarea are all
confirmed live. The post-login form fields follow iCIMS's `css_*` naming
convention but are not verifiable without an account.

### Engine work this required

- **Frame priority in the service worker.** On iframe-embedded forms the wrapper
  page (0 fields) would report after the child frame (the actual form), erasing
  the child's report. The frame that found the most fields now keeps the tab
  state, which also fixes a latent bug in iframe-embedded Greenhouse forms.
- **Pack-matched detection bypass.** `looksLikeApplication()` required ≥ 3
  fields. iCIMS's email step has only 2 visible fields (email + consent). When a
  site pack claimed the page, a `packMatched` option now bypasses the field-count
  check — password fields still outrank.
- **Fixture with iframe.** `icims-like.html` wraps `icims-inner.html` in an
  `#icims_content_iframe`, exercised by the e2e.

## v1.1 — done

- **Wave-2 packs — complete.** Workable, SmartRecruiters, Pinpoint
  and JazzHR were each written against a live application form and their
  selectors verified read-only in the browser on 18 Sep 2026. Recruitee and
  BambooHR were later verified live and added with the honeypot fix.
  - Each pack now carries `verifiedAgainstLiveForm`, enforced by a test, so
    fixture-only packs are visibly distinguished from live-verified ones.
  - Note on SmartRecruiters: its apply flow is a wizard of `<spl-button>` custom
    elements with no real submit button, and the only `button[type=submit]` on
    the page is the cookie-settings control. Its `submit` list is therefore
    deliberately empty so the tracker cannot log a false submission; detection
    falls back to the confirmation-screen heuristic.

## v2 — done

- **Workday** — done. Multi-step wizard, split-date fields, credential-screen
  refusal. Shell verified live; form steps are account-gated and exercised
  against fixtures.
- **Naukri assisted mode** — done. Read-only scoring of job cards against the
  profile. No navigation, no applying through the board.
- **Remote selector packs** — done. Off by default, validated before use, hostile
  bundles refused. `npm run packs:bundle` regenerates `packs.json`.
- **iCIMS** — done. Iframe-embedded forms, frame priority, pack-matched
  detection bypass. Email step verified live; form steps are account-gated.

## Future

- **Taleo, SuccessFactors, Avature** — legacy enterprise ATSs. Generic mode
  already gets partial fill. Add packs when a live form can be inspected.
- **Fixture capture command** — snapshot a live page into `fixtures/` so a pack
  can be written against a real DOM offline.
- **Résumé-per-application** — pick which document goes with which posting
  rather than always using the default.

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
