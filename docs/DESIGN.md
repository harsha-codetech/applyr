# applyr — design

## The one idea

A canonical field taxonomy sits between the two halves of the problem:

```
ATS DOM  ──selector pack──▶  canonical field id  ◀──profile schema──  user data
         (site-specific)      first_name               (site-agnostic)
                              years_experience
                              work_auth_us
```

Neither side knows the other exists. Adding an ATS is a JSON file; adding a
profile field is a taxonomy entry, and the editor renders it automatically.
Without this seam you get per-site branching everywhere and the project stalls
at the fourth ATS.

## Pipeline

```
detector  ──descriptors──▶  resolver  ──plan──▶  adapters  ──▶  verify
   │                           │                    │              │
 DOM walk,               4-stage cascade      one per widget   read back and
 shadow roots,           + question memory    class            compare
 label extraction
```

### 1. detector (`src/content/detector.js`)

Walks the document and open shadow roots, filters to visible fillable controls,
groups radios by name, and produces **descriptors** — a normalised view of a
field. Everything downstream works on descriptors and never touches tree
structure again, which is why the resolver is unit-testable without a DOM.

Label extraction runs seven fallbacks in order: `<label for>`, `aria-labelledby`,
`aria-label`, a wrapping or sibling label-ish node, `placeholder`/`title`,
**unmarked-up neighbour text** (the `<td>` to the left, a row `<th>`, a bare
preceding `<div>`), then a humanised attribute name. The neighbour stage is what
takes a legacy table-layout form from 0% to 92% coverage — it was added because
`fixtures/generic-unknown.html` caught the gap.

### 2. resolver (`src/content/resolver.js`)

Four stages, highest confidence first:

| stage | source | score |
|---|---|---|
| 1 | pack selector | 1.00 |
| 2 | `autocomplete` token | 0.90 |
| 3 | attribute pattern, anchored | 0.82 |
| 4 | visible label pattern | 0.75 |
| 3b | attribute pattern, loose | 0.68 |

...then, for anything still unmapped, **question memory**: fuzzy recall of what
the user answered before.

Assignment is a **greedy bipartite match**, not first-wins. On a form with both
"Name" and "First name", first-wins would let the generic input claim
`first_name` purely by document order; scoring every (descriptor, field) pair and
assigning in descending order gives each field to its strongest candidate. Each
field id is claimed once, except file fields and consent checkboxes, which
legitimately repeat.

Stages 2–4 are also **generic mode** — the reason an unknown ATS still fills.

### 3. adapters (`src/content/adapters/`)

| adapter | handles |
|---|---|
| `text.js` | text, email, tel, url, number, date, textarea, contenteditable |
| `choice.js` | native `<select>`, checkbox, radio group |
| `combobox.js` | react-select, Ashby/Workday listboxes, any `role="combobox"` |
| `file.js` | résumé and document upload |

Three mechanics are load-bearing:

**Native value setter.** React, Vue and Angular install their own `value`
property on the element instance, so a plain `el.value = x` updates the DOM while
the framework's state keeps the old value — the field *looks* filled and submits
empty. `dom.js` reaches through to the prototype's native setter and then
dispatches a bubbling `input` event, which is what makes the framework observe
the change. This works from the content script's isolated world because the DOM
node is shared across worlds. `fixtures/hard-mode.html` contains a controlled
input that reverts any write not made this way.

**Driving comboboxes rather than writing them.** Their visible text is rendered
from component state, so the adapter opens the widget, optionally types to
filter, waits for the listbox — usually portalled to `<body>`, not nested inside
the trigger — and clicks the matching option.

**DataTransfer for uploads.** `input.files` accepts a `FileList` built from a
`DataTransfer`, which is the one sanctioned way to put a file into a form from
script. Bytes arrive from the service worker as base64 because `chrome.runtime`
messaging is JSON, not structured clone, so an `ArrayBuffer` would not survive
the trip. A synthetic `drop` is fired too, for uploaders that ignore `change`.

### 4. verify (`src/content/verify.js`)

Every write is read back and compared. A masked input may reformat, a framework
may revert on the next render, a dropdown may silently reject an option.
Anything that does not match is reported as `unverified`, ringed amber, and
listed in the HUD — never counted as success. This is the difference between an
autofill tool you can trust and one that quietly submits half-empty
applications.

Comparison is deliberately loose: digits-only for phones, numeric for
`"5"` vs `"5 years"`, filename stem for uploads, substring either direction for
`"United States"` vs `"United States of America"`.

## Question memory

With no model in the loop, this is the product's entire intelligence. Each
answer is stored under a key produced by aggressive normalisation — lowercase,
punctuation and year stripped, stopwords removed — and recalled by Dice
coefficient over character trigrams at a 0.72 threshold. So "Why do you want to
work here?" answers "Why are you interested in our company?".

The content script carries a local copy of the comparison so the hot path never
round-trips to the service worker.

## Process model

```
content script (per frame, all_frames)   ⟷   service worker   ⟷   side panel
    detect / fill / HUD                      storage + router      UI
```

`all_frames` is required because Greenhouse and iCIMS render the real form in an
iframe on the employer's domain. Each frame scans, fills and reports itself; the
worker aggregates per tab.

The worker holds no durable state — MV3 tears it down after ~30s idle and
restarts it with a clean V8 context. Per-tab state goes to
`chrome.storage.session`, everything else to `chrome.storage.local` and
IndexedDB.

## Permissions

The manifest declares the known ATS hosts. Everything else is
`optional_host_permissions`, requested per-site from the panel by a user click
(`chrome.permissions.request` needs the gesture, so the call lives in the panel,
not the worker) and then registered with
`chrome.scripting.registerContentScripts`. This keeps the install-time prompt
narrow and gives the store reviewer a clear story.

## Build

There isn't one. Plain ES modules, no dependencies, no transpiler. MV3 content
scripts cannot be declared as modules, so `loader.js` is the single classic
script and it dynamic-imports `main.js`; everything else is a module.

The trade-off: no TypeScript, no JSX. In exchange the source that ships is the
source you read — which matters for a privacy claim a reviewer has to believe —
and there is no dependency supply chain in an extension holding a user's
personal data. Types are carried as JSDoc. Adding a bundler later is a contained
change: the module graph is already acyclic and import-only.
