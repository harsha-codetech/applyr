# Privacy policy — applyr

_Last updated: 18 September 2026_

## The short version

applyr does not transmit your data anywhere. There is no account, no server, no
analytics, and no third-party service. Everything the extension knows is stored
in your own browser profile and is readable only by the extension.

## What is stored, and where

| Data | Where | Why |
|---|---|---|
| Profile fields (name, contact, links, address, work history, education) | `chrome.storage.local` | To fill application forms |
| Résumés, cover letters, other documents | IndexedDB (`applyr` database) | To attach to file upload fields |
| Saved answers to screening questions | `chrome.storage.local` | To recall the answer next time |
| Application log (company, role, URL, status, date) | `chrome.storage.local` | The tracker |
| Per-site fill statistics (counts only, no field contents) | `chrome.storage.local` | The coverage report in Settings |
| Per-tab scan results | `chrome.storage.session` | Cleared when the tab closes |

All of it stays on the device. None of it is synced between machines.

## What is not collected

- No usage analytics, crash reports or telemetry
- No browsing history; the extension only reads the page you ask it to fill
- No advertising identifiers, no fingerprinting, no tracking of any kind
- No data about the employers or postings beyond what you see in the tracker

## Network activity

**By default the extension makes no outbound network requests at all.** Its
selector packs are bundled files loaded from inside the extension.

There is exactly one feature that can change that, and it is off until you turn
it on.

### Selector pack updates (optional, off by default)

Applicant-tracking systems redesign their forms without notice. When they do,
the CSS selectors applyr uses stop matching and it silently stops filling that
site. **Pack updates** let applyr refresh those selectors from a static JSON
file instead of waiting for a Chrome Web Store review.

When you enable it in **Settings → Selector packs**:

- applyr requests a separate permission for the pack source. Decline it and the
  feature stays off.
- It performs a plain `GET` for one static JSON file, at most once every 12
  hours and whenever you press *Check now*.
- The request is sent with `credentials: 'omit'`. It carries **no identifier, no
  cookies, no profile data, no résumé, no application history, and no query
  parameters**. The only thing the server can observe is that some browser at
  your IP address asked for a public file — the same thing it observes for
  anyone who opens that URL.
- What comes back is **data, never code**: CSS selector strings, parsed as JSON.
  Nothing fetched is executed, imported, or inserted into any page.
- Everything fetched is validated before it is used. A bundle is rejected whole
  if any pack references a field the extension does not know, points a selector
  at a password input, routes a document upload at something that is not an
  upload, claims a host another pack already owns, or uses a wildcard host. A
  rejected bundle changes nothing and the packs that shipped with the extension
  keep working.
- A remote pack can replace or add a pack. It can never remove one, so a source
  that disappears or goes wrong degrades to what shipped in the store.

You can point it at a different URL, press *Use bundled only* to discard
everything fetched, or turn it off — at which point applyr stops making network
requests entirely again.

The default source is a static file published alongside the extension's source
code, so you can read exactly what it would fetch before enabling anything.

## Page access

applyr runs on job-application pages. The manifest lists the applicant-tracking
systems it supports. Any other site requires you to grant access explicitly,
per-site, from the side panel; you can revoke it at any time from Chrome's
extension settings.

On a page it runs on, the extension reads form fields and their labels in order
to match them to your profile, and writes the values you have saved. It does not
read or store the rest of the page.

## Demographic and protected data

Gender, race and ethnicity, veteran status, disability status and date of birth
are treated as a separate category:

- They are **never filled by default.** Filling them requires turning on "Fill
  demographic fields" in Settings.
- They are **never inferred or guessed.** Only values you typed yourself are
  ever used.
- They are stored on your device like every other field and are never
  transmitted.

Leaving them blank means applyr will always skip those questions and you answer
them yourself, or not at all.

## Submission

applyr never submits a form. It fills fields and reports what it did; you review
and submit. The extension detects that *you* submitted in order to update the
tracker — it does not perform the submission.

## Your control

- **Export** — Settings → *Export everything* produces a JSON file containing
  your profile, answers, tracker and documents.
- **Import** — restores from that file.
- **Erase** — Settings → *Erase all data* permanently clears storage and the
  document vault.
- **Uninstall** — removing the extension deletes all of its storage.

Because there is no server copy, an export is your only backup.

## Children

applyr is not directed at children and collects nothing from anyone directly.

## Contact

Open an issue on the project repository.
