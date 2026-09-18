# Chrome Web Store submission

Everything the listing form asks for. Build the upload with `npm run zip`.

## Listing

**Name** — applyr — job application autofill

**Short description** (132 max)
> Fill job applications from one profile. Works on Lever, Greenhouse, Ashby and
> most other career sites. 100% on-device.

**Category** — Workflow & Planning

**Single purpose**
> Fill in job application forms on employer career sites using information the
> user has saved in the extension.

Everything shipped serves that purpose: the profile editor supplies the values,
the document vault supplies the résumé, the saved-answers bank supplies
screening answers, and the tracker records which forms were filled. Nothing in
the extension does anything else.

**Detailed description**

> applyr fills job applications from one profile you control, so a six-minute
> form takes about thirty seconds.
>
> • Works out of the box on Lever, Greenhouse and Ashby, and falls back to
>   generic matching on almost any other career site.
> • Remembers your answers to screening questions and recalls them when another
>   employer asks the same thing in different words.
> • Attaches your résumé to file-upload fields.
> • Rings every field it touched and flags anything that did not take, so you
>   can check the form before you send it.
> • Keeps a log of what you applied to.
>
> applyr never submits a form for you. It fills, verifies and reports; reviewing
> and clicking Submit stays with you.
>
> Your data never leaves your device. There is no account, no server and no
> analytics — your profile, résumés and saved answers are stored in your own
> browser and are readable only by this extension. Export a backup any time from
> Settings.
>
> applyr makes no network requests unless you turn on selector updates, which
> fetch a list of CSS selectors so it keeps working when a career site is
> redesigned. That request sends nothing about you.
>
> Demographic questions (gender, race, veteran and disability status) are never
> filled unless you explicitly turn that on, and only ever from values you typed
> yourself.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Stores the user's profile, saved answers and application log locally. Nothing is transmitted. |
| `unlimitedStorage` | Résumés and cover letters are held in IndexedDB; several PDFs can exceed the default quota. |
| `sidePanel` | The extension's entire UI — profile editor, fill controls, saved answers, tracker — is a side panel. |
| `scripting` | Registers the content script on sites the user has explicitly granted access to at runtime. |
| `tabs` | Reads the active tab's URL so the panel can show whether applyr is running on that page and offer per-site access. |
| Host permissions (listed ATS domains) | The content script must read form fields and their labels on application pages in order to fill them. Each listed domain is an applicant-tracking system that hosts job applications. |
| `*://*.naukri.com/*` | Assisted mode reads the job cards already rendered on a search page the user opened, so the side panel can rank them against the user's profile. It is read-only: no navigation, no requests, no form submission on that domain. |
| `https://raw.githubusercontent.com/*` (optional) | Not granted at install. Requested only if the user turns on selector-pack updates, which fetch one static JSON file of CSS selectors so a broken ATS selector can be fixed without a store review. The request sends no user data and omits credentials. |
| `*://*/*` (optional) | Not granted at install. Requested per-site, from a user click in the panel, only when the user wants applyr on a career site not covered above. |

## Data-safety declaration

**Collected:** none transmitted. Declare *"This extension does not collect or
use user data"* only if the form's definition of "collect" is limited to
transmission; otherwise declare the categories below as **stored locally, not
transmitted**:

- Personally identifiable information — name, email, phone, address: stored on
  the user's device to fill forms. Not sent anywhere.
- Personal communications — none.
- Location — only a home address the user typed. Not sent anywhere.
- Web history — none.
- User activity — none.

Certifications required by the form:
- [x] Does not sell or transfer user data to third parties
- [x] Does not use or transfer data for purposes unrelated to the single purpose
- [x] Does not use or transfer data to determine creditworthiness or for lending

**Privacy policy URL** — host `docs/PRIVACY.md` as a public page and link it.

## Remote code

None. No `eval`, no remotely-hosted scripts, no CDN-loaded libraries.

The optional pack-update feature fetches a static **JSON** file of CSS selector
strings. It is parsed with `JSON.parse` and every value is used as a selector;
nothing fetched is executed, imported or inserted into a page, and the feature is
off unless the user enables it. This is data, not remotely-hosted code, and it is
validated against a strict schema before use — see `src/core/pack-source.js` and
its tests.

## Pre-submission checklist

- [ ] `npm test` passes (including the pack-source validation suite)
- [ ] `npm run packs:bundle` is current and `packs.json` is committed
- [ ] `tests/MANUAL.md` walked end to end on a fresh Chrome profile
- [ ] Version bumped in `manifest.json`
- [ ] `npm run zip` and the zip loads unpacked cleanly after extraction
- [ ] Privacy policy published at a public URL
- [ ] Screenshots: side panel with a filled profile, a form mid-fill with the
      rings visible, the saved-answers bank, the tracker (1280×800)
- [ ] Each pack live-checked against one real posting
