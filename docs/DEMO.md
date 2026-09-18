# Running applyr locally — demo guide

About five minutes, entirely offline. Nothing is sent to a real employer.

## 1. Load the extension

```bash
git clone https://github.com/harsha-codetech/applyr.git
cd applyr
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `applyr` folder
4. The welcome page opens. Pin the applyr icon to the toolbar.

No `npm install`, no build — the source is what runs.

## 2. Start the demo forms

```bash
npm run serve
```

Four fixtures at **http://localhost:5173/fixtures/** — offline stand-ins for
Lever, Greenhouse, an unknown legacy ATS, and a deliberately hostile page.

## 3. Load the demo profile

Open any fixture, click the applyr icon to open the side panel, then:

**Settings → Import backup → `fixtures/demo-profile.json`**

That loads a complete fake candidate — 33 profile fields, work history,
education, four saved screening answers, and a sample résumé PDF — so you can
demo without typing anything. All fictional (Ada Lovelace, `example.com`).

> On the fixtures, the panel will first ask you to **Enable applyr on this site**
> for `http://localhost:5173`. Click it, the page reloads, and you're ready.
> This is the same per-site permission flow a real user sees on an unsupported
> career site.

## 4. The demo, in order

### a. The easy case — `lever-like.html`
Click **Fill this form**. Everything fills, the résumé attaches, and each field
gets a green ring. Point out the footer: *applyr never submits for you.*

### b. Widgets and restraint — `greenhouse-like.html`
Fill it. Three things to call out:
- The **radio groups** answer work authorisation and sponsorship correctly
- The **"How did you hear about us?"** dropdown is not a `<select>` — applyr
  opens it and clicks the option, because its visible text is component state
- **Gender and Veteran Status are deliberately skipped**, marked *opt-in off*.
  Toggle Settings → *Fill demographic fields*, refill, and they populate. Turn
  it back off. This is the ethical default, not a limitation.

### c. The hard one — `hard-mode.html`
The money shot. Fill it, then:
- Under the name field, the page prints its own component state. It reads
  **`component state: Ada Lovelace`** — proof the value committed to the
  framework, not just the DOM. A naive `el.value = x` gets reverted here on the
  next frame.
- The **phone field lives inside a shadow root** and still fills.
- The **country dropdown** renders its list at the end of `<body>`, not inside
  the control, and applyr still finds and clicks it.
- Click **Next**. A second step appears that did not exist a moment ago; the
  panel's field count updates within a second. Fill again — including
  *"Why do you want to work at our company?"*, answered **from memory**, not
  from the profile.

### d. No pack at all — `generic-unknown.html`
The panel says **Generic mode — no pack for this site yet**. Fill it anyway:
**11 of 12 fields**, matched purely from the `<td>` text beside each input,
with "Willing to relocate?" resolving `yes` to the option value `Y`. This is
what happens on an ATS nobody has written a pack for.

### e. Memory
Find something unresolved, click **Teach answer** in the in-page HUD, type an
answer, save. Reload and refill — it comes back, tagged *via memory*. Then open
the **Answers** tab to show the bank, and note that matching is fuzzy: the
stored *"Why do you want to work at our company?"* also answers *"Why are you
interested in us?"*.

### f. Tracker
Open **Applications**. Every form you filled is already logged, with company,
role, ATS and status. Click a fixture's Submit button (the fixtures block the
actual submission) and the status flips to **submitted**.

### g. The privacy claim
**Settings → Export everything** downloads the entire dataset as JSON. There is
no server copy — that file is the only backup. `chrome://extensions` → applyr →
*Details* shows the extension requests no permissions beyond the ATS hosts and
what you granted per-site.

## 5. Reset between demos

**Settings → Erase all data**, then re-import `demo-profile.json`.

## Talking points

- **Six minutes to about thirty seconds** per application.
- **Verification, not optimism**: every write is read back. Amber rings mean
  "this did not take" — the extension tells you when it failed rather than
  quietly submitting a half-empty form.
- **One taxonomy, two sides**: a new ATS is a JSON file; a new profile field is
  one taxonomy entry and the editor grows an input by itself.
- **Nothing leaves the device**, and demographic questions are opt-in only.
- **It never submits and never automates a job board** — that boundary is why
  it can ship to the Web Store and why it cannot get anyone's account banned.

## Troubleshooting

| | |
|---|---|
| Panel says applyr isn't running | Click **Enable applyr on this site**, let the page reload |
| Nothing fills | Check **Profile** — import `fixtures/demo-profile.json` |
| Changed the code | `chrome://extensions` → reload applyr → reload the page |
| Port 5173 busy | `PORT=5180 npm run serve` |
