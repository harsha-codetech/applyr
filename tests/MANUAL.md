# Manual test checklist

`npm test` covers the pure engine — normalisation, the resolver cascade, option
matching, verification. What it cannot cover is the DOM: native setters,
comboboxes, shadow roots, uploads. That is what the fixtures are for.

```bash
npm run serve     # http://localhost:5173/fixtures/
```

Load the extension unpacked, then open the side panel and grant access to
`http://localhost:5173` from **This page → Enable applyr on this site**.

Seed a profile first: name, email, phone, city, country, LinkedIn, one work
history entry, one education entry, and a résumé PDF under **Documents**.

---

## 1. `lever-like.html` — the easy case

- [ ] Panel shows **Lever pack** … (it matches on DOM fingerprint, not host)
- [ ] Every text field fills; full name goes in as one string
- [ ] `urls[LinkedIn]`, `urls[GitHub]`, `urls[Portfolio]` each get the right link
- [ ] Résumé attaches and the filename appears next to the file input
- [ ] Every filled field is ringed green

## 2. `greenhouse-like.html` — widgets and gating

- [ ] First/last name split correctly from the profile
- [ ] Both radio groups answer from `work_auth_us` / `requires_sponsorship`
- [ ] "How did you hear about us?" combobox opens and commits an option —
      the control's own text changes, not just a hidden input
- [ ] Gender and Veteran Status are **skipped** and reported as *opt-in off*
- [ ] Turn on Settings → *Fill demographic fields*, refill: both now fill
- [ ] Turn it back off

## 3. `hard-mode.html` — the three killers

- [ ] "Full name (controlled input)" fills **and** the line below reads
      `component state: <your name>` — if the field shows text but the state
      line is empty, the native-setter path has regressed
- [ ] The phone field inside `<shadow-field>` fills (it lives in a shadow root)
- [ ] The Country combobox commits via the portalled listbox under `<body>`
- [ ] Click **Next**; within ~1s the panel field count rises and, with
      *Fill automatically* on, step 2 fills without a second click
- [ ] Teach an answer for "Why do you want to work at our company?" from the
      HUD; reload and refill — it fills from memory, marked *via memory*

## 4. `generic-unknown.html` — generic mode

- [ ] Panel says **Generic mode — no pack for this site yet**
- [ ] ≥ 10 of 12 fields fill, matched purely from the `<td>` labels
- [ ] "Willing to relocate?" select resolves `yes` to the option value `Y`
- [ ] Anything unresolved offers **Teach answer** in the HUD

## 5. Cross-cutting

- [ ] `Alt+Shift+F` fills without opening the panel
- [ ] Badge on the toolbar icon shows the filled count
- [ ] A field you typed into yourself is **skipped**, not overwritten
- [ ] Turn on *Overwrite fields that already have a value* — now it is replaced
- [ ] Clicking the fixture's submit button logs an application as **submitted**
      in the Applications tab (the fixture blocks the actual submission)
- [ ] Filling twice does not create two tracker entries for the same URL
- [ ] Settings → Export, then Erase, then Import: profile, answers, documents
      and tracker all come back
- [ ] Reload the extension mid-session (`chrome://extensions`) and fill again —
      the worker restarts cleanly and nothing is lost

## 6. Before shipping to real sites

Run against one live posting per pack, on a job you are genuinely applying for,
and **read every field before submitting**. Selector drift is silent: the
verifier catches a value that did not stick, but it cannot catch a value that
landed in the wrong field. Live-check each pack after any ATS redesign.
