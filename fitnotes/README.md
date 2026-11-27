# FitNotes "today" shortcut (Termux)

One tap on the home screen turns the newest FitNotes export in
`Download/_Fitnotes Filter` into `FitNotes_YYYY-MM-DD.csv` with only that day's rows.

## One-time setup

1. From **F-Droid** (not the Play Store), install **Termux**, **Termux:API** and **Termux:Widget**.
   All three must come from F-Droid, or they won't talk to each other.
2. Open Termux and paste these one at a time:

```
pkg update -y && pkg install termux-api -y
termux-setup-storage
```

   Tap **Allow** when Android asks about files.

3. Install the shortcut:

```
mkdir -p ~/.shortcuts ~/bin && curl -fsSL https://raw.githubusercontent.com/tinkeringdad/tinkeringdad.github.io/ccr-2da5f9ea-329cca/fitnotes/fitnotes-today.sh -o ~/.shortcuts/FitNotes && chmod +x ~/.shortcuts/FitNotes && ln -sf ~/.shortcuts/FitNotes ~/bin/fitnotes-today && echo INSTALLED
```

4. Test it once from Termux: `~/.shortcuts/FitNotes`
5. Long-press the home screen → **Widgets** → **Termux:Widget** → drag the 1×1 shortcut
   widget out and pick **FitNotes**.

## If something goes wrong

- **"Can't open the FitNotes folder" / Permission denied** — run `termux-setup-storage` again.
  If no prompt appears: Settings → Apps → Termux → Permissions → Files and media → Allow.
- **Widget tap does nothing** — Settings → Apps → Termux → *Display over other apps* → Allow.
  Then remove the widget and add it again.
- **FitNotes isn't in the widget list** — run `ls ~/.shortcuts` in Termux; it should show
  `FitNotes`. Re-run step 3 if not.
- **No toast pops up** — Termux:API isn't installed, or came from a different store than Termux.
  The result still prints in the Termux window.
- **Wrong date** — the summary shows which date was used; check the phone's timezone setting.
