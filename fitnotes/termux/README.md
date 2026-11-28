# FitNotes → Latest Workout (one-tap, Android)

Tap one home-screen button and your most recent FitNotes workout day is:

- saved as `FitNotes_YYYY-MM-DD.csv` in **Download → _Fitnotes Filter**
- uploaded to Google Drive folder **FitNotes Daily** as both
  `FitNotes_YYYY-MM-DD.csv` and `FitNotes_Latest.csv`
- older full exports are deleted (the newest 3 are kept)

Your trainer chat in Claude reads `FitNotes_Latest.csv` from Google Drive by itself.

## Files

| File | What it is |
|---|---|
| `fitnotes_today.py` | The program the button runs. Lives in the `_Fitnotes Filter` folder. |
| `setup.sh` | One-time installer for Termux. |
| `fitnotes_filter.html` | The old manual browser version (kept for reference/fallback). |

## One-time setup

Needs **Termux** and **Termux:Widget**, both from F-Droid.

1. Open **Termux**. Paste this line and press Enter:

   ```
   curl -fsSL https://raw.githubusercontent.com/tinkeringdad/tinkeringdad.github.io/claude/fitnotes-daily-export-filter-10jzlf/fitnotes/termux/setup.sh | bash
   ```

2. Answer the prompts:
   - **File access**: allow it (turn the switch on if a settings page opens, then press Back).
   - **Google sign-in**: the browser opens. Pick your account → Continue/Allow.
     When it says *Success*, switch back to Termux.
     The uploader can only see files it creates itself, not the rest of your Drive.
3. **Add the button**: long-press an empty spot on the home screen → **Widgets** →
   **Termux:Widget** → drag it out. The widget lists **Latest Workout**; tap it.
   (Or use the 1×1 "Termux shortcut" widget and pick **Latest Workout** for a single icon.)

## Daily routine

1. FitNotes → export CSV into **Download → _Fitnotes Filter**
2. Tap **Latest Workout**
3. Open the trainer chat

## Trainer chat instruction

Add this to the trainer chat's project instructions (Google Drive connector must be on):

> At the start of each workout review, open my Google Drive folder **FitNotes Daily** and read
> **FitNotes_Latest.csv**. That's my most recent FitNotes workout (one row per set, with my
> comments). The date is in the Date column. Dated copies (`FitNotes_YYYY-MM-DD.csv`) in the
> same folder hold earlier workouts if you need to compare. Combine it with the Garmin file I attach.

## Troubleshooting

- **Button does nothing** → Settings → Apps → Termux → *Appear on top* / *Display over other apps* → Allow.
- **"Drive: upload FAILED"** → check internet and tap again. If it keeps failing, re-run the setup line.
- **"Latest workout is …, not today"** → you probably didn't re-export after logging.
- **Change how many exports are kept** → edit `KEEP_EXPORTS = 3` near the top of `fitnotes_today.py`.
