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

The extension makes no outbound network requests. Its selector packs are bundled
files loaded from inside the extension, not fetched.

If a future version adds remotely-updated selector packs, it will fetch a static
JSON file containing CSS selectors only. Such a request would contain no
personal data and no identifier; this policy will be updated before any such
version ships.

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
