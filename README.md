# applyr

A Chrome extension that fills job applications from one profile you control.
No account, no server, no telemetry — everything lives in your browser profile.

**applyr never submits a form.** It fills, verifies, and rings every field it
touched; reviewing and clicking Submit stays with you. That is the design, not a
missing feature — see [Scope](#scope).

---

## Install (unpacked)

```bash
git clone <this repo> && cd applyr
```

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. Click the applyr icon to open the side panel, fill in your profile, upload a résumé

There is no build step. The source you read is the source that runs.

For a guided walkthrough with sample data, see [docs/DEMO.md](docs/DEMO.md).

## Use

| | |
|---|---|
| Fill the current form | `Alt+Shift+F`, or the button in the side panel |
| Teach an unknown answer | "Teach answer" in the in-page HUD, or the **Answers** tab |
| Enable a site applyr doesn't ship a pack for | **This page** → *Enable applyr on this site* |
| Back up your data | **Settings** → *Export everything* |

## What works where

**Bundled selector packs** (near-total coverage). Nine of the ten have been
checked against a real application form, with their selectors resolved read-only
in the browser — no values were ever written to a live employer form. Workday is
the exception, and says so:

| Pack | Checked against |
|---|---|
| Lever | live posting, 18 Sep 2026 |
| Greenhouse | live posting, 18 Sep 2026 |
| Ashby | live posting, 18 Sep 2026 |
| Workable | live posting, 18 Sep 2026 |
| SmartRecruiters | live posting, 18 Sep 2026 |
| Pinpoint | live posting, 18 Sep 2026 |
| JazzHR | live posting, 18 Sep 2026 |
| Recruitee | live posting, 18 Sep 2026 |
| BambooHR | live posting, 18 Sep 2026 |
| Workday | **shell only** — apply flow verified live, form steps are account-gated |

Each pack carries a `verifiedAgainstLiveForm` date, enforced by a test, so a
pack written from guesswork cannot quietly pass as a checked one. ATSs redesign;
re-check after any visible change to their forms.

**Generic mode** (no pack, ~70–90% coverage): every other site. The resolver
falls back to `autocomplete` tokens, name/id patterns and visible label text, so
an unknown ATS still fills most of the form. Verified against the legacy-style
fixture at 92%.

Manifest-declared hosts also include Teamtailor, Breezy and iCIMS — those run in
generic mode until a pack is written for them.

**Workday is the honest exception.** Its public apply flow was verified live, but
Workday puts step 1 of 6 behind mandatory account creation, so the form steps
themselves have never been seen by this code. Those selectors follow Workday’s
documented conventions and are exercised against a fixture, but expect to correct
some of them on your first real application. The pack records this as
`verifiedAgainstLiveForm: null`.

applyr also refuses outright to fill any page containing a password field, which
is what Workday’s step 1 is.

## Develop

```bash
npm test          # 51 engine tests, no dependencies
npm run serve     # fixtures at http://localhost:5173/fixtures/
npm run e2e       # loads the extension into real Chrome and drives it over CDP
npm run zip       # dist/applyr-<version>.zip for the Web Store
```

The fixtures are offline stand-ins for the real boards, so the engine can be
exercised without sending anything to a real employer. `fixtures/hard-mode.html`
reproduces the three things that break naive autofill: a framework-controlled
input that reverts unauthorised writes, a field inside a shadow root, and a
wizard step that only exists after a click.

Chrome 137+ ignores `--load-extension`, so `npm run e2e` installs the extension
over the DevTools Protocol instead and then drives it: service worker, side
panel, content script, fill, upload and tracker. Start `npm run serve` first.

See [tests/MANUAL.md](tests/MANUAL.md) for the browser checklist and
[docs/DESIGN.md](docs/DESIGN.md) for how the engine works.

## Adding an ATS

Write a JSON file in `src/packs/`, add it to `index.json`. No engine changes.

```json
{
  "id": "workable",
  "name": "Workable",
  "match": ["apply.workable.com"],
  "detect": { "any": ["form[data-ui='application-form']"] },
  "submit": ["button[data-ui='submit']"],
  "fields": [
    { "id": "first_name", "selector": ["input[name='firstname']"] },
    { "id": "resume_file", "selector": ["input[type='file'][name='resume']"] }
  ]
}
```

`id` is a canonical field from [`src/core/taxonomy.js`](src/core/taxonomy.js).
Packs are data, never code — which is what keeps the planned "fetch updated
packs from a URL" upgrade legal under MV3's remote-code ban.

## Scope

applyr does not automate job boards, does not click Submit, does not rotate
fingerprints, and does not evade bot detection. It runs in your own browser, in
your own session, at the speed you work.

That is a deliberate boundary and it is also the practical one: on a logged-in
account the platform already knows who you are, so spoofing a fingerprint
changes nothing about detection while inconsistency across sessions is itself a
signal. LinkedIn, Naukri, Fiverr and Upwork all prohibit automated interaction
and enforce it behaviourally — with suspensions that cost far more than the
minutes saved. Removing the final click buys very little and risks the account
the applications are for.

What is left after that boundary is most of the value: a six-minute application
becomes about thirty seconds.

## Privacy

No network requests leave the extension. Profile, résumés, saved answers and the
application log are stored in this browser profile only — `chrome.storage.local`
for structured data, IndexedDB for file bytes. There is no cloud copy, which also
means **your only backup is the one you export**.

Demographic questions (gender, race, veteran and disability status, date of
birth) are never filled unless you explicitly turn that on in Settings, and only
ever from values you typed yourself. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Layout

```
manifest.json          MV3 manifest
src/core/              taxonomy, profile schema, storage, packs, messages
src/content/           detector → resolver → adapters → verify, plus the in-page HUD
src/background/        service worker: storage owner and message router
src/sidepanel/         profile editor, fill controls, answers, tracker, settings
src/packs/             per-ATS selector packs (JSON)
fixtures/              offline test pages
tests/                 node:test engine suite
```

## Status

v1 is complete and verified in a real Chrome: engine, generic mode, ten packs,
question memory, document vault, tracker, and a Web Store package. 51 unit tests
and 32 end-to-end checks pass.

What has not happened yet: a real application submitted through it. Workday's
form steps in particular have never been seen by this code. See
[docs/PLAN.md](docs/PLAN.md) for what is left, and
[tests/MANUAL.md](tests/MANUAL.md) for the checks a person still has to make.
