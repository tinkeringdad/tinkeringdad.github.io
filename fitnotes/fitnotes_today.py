#!/usr/bin/env python3
"""FitNotes "latest workout" extractor for Termux on Android.

One tap does all of this:
  1. Finds the newest FitNotes_Export_*.csv in this script's folder.
  2. Pulls out every row from the most recent workout day in that export.
  3. Saves it next to the export as FitNotes_YYYY-MM-DD.csv.
  4. Uploads it to Google Drive (folder "FitNotes Daily") twice:
       FitNotes_YYYY-MM-DD.csv  (dated history)
       FitNotes_Latest.csv      (always the newest workout)
  5. Deletes older full exports, keeping the newest KEEP_EXPORTS.

Uses only the Python standard library plus the rclone command.
"""

import csv
import datetime as dt
import os
import re
import shutil
import subprocess
import sys

# ── Settings ────────────────────────────────────────────────────────────────
FOLDER = os.path.dirname(os.path.abspath(__file__))
KEEP_EXPORTS = 3
RCLONE_REMOTE = "gdrive"
DRIVE_FOLDER = "FitNotes Daily"
LATEST_NAME = "FitNotes_Latest.csv"

EXPORT_RE = re.compile(r"^FitNotes_Export_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2}).*\.csv$", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

GREEN, YELLOW, RED, DIM, RESET = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"


def say(msg, color=""):
    print(f"{color}{msg}{RESET}" if color else msg, flush=True)


def fail(msg):
    say(f"✗ {msg}", RED)
    sys.exit(1)


def find_exports():
    """Return FitNotes exports, newest first (by timestamp in the filename)."""
    found = []
    for name in os.listdir(FOLDER):
        m = EXPORT_RE.match(name)
        if m:
            stamp = tuple(int(x) for x in m.groups())
            path = os.path.join(FOLDER, name)
            found.append((stamp, os.path.getmtime(path), path))
    found.sort(reverse=True)
    return [p for _, _, p in found]


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        rows = [r for r in reader if r and any(c.strip() for c in r)]
    if not header or header[0].strip() != "Date":
        fail(f"{os.path.basename(path)} doesn't look like a FitNotes export (first column isn't 'Date').")
    return header, rows


def upload(local_path, remote_name):
    """Copy a file to Google Drive with rclone. Returns True on success."""
    target = f"{RCLONE_REMOTE}:{DRIVE_FOLDER}/{remote_name}"
    result = subprocess.run(["rclone", "copyto", local_path, target],
                            capture_output=True, text=True)
    if result.returncode != 0:
        say(f"  upload error: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'unknown'}", DIM)
    return result.returncode == 0


def main():
    say("FitNotes → latest workout\n", YELLOW)

    exports = find_exports()
    if not exports:
        fail(f"No FitNotes_Export_*.csv found in:\n  {FOLDER}\nExport from FitNotes into this folder, then tap again.")
    newest = exports[0]
    say(f"Export:  {os.path.basename(newest)}", DIM)

    header, rows = read_rows(newest)
    dates = [r[0].strip() for r in rows if DATE_RE.match(r[0].strip())]
    if not dates:
        fail("The export has no workout rows.")
    day = max(dates)
    day_rows = [r for r in rows if r[0].strip() == day]

    # Save today's (latest day's) file next to the export
    out_name = f"FitNotes_{day}.csv"
    out_path = os.path.join(FOLDER, out_name)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(day_rows)

    exercises = len({r[1] for r in day_rows if len(r) > 1})
    say(f"Workout: {day}  ·  {len(day_rows)} sets  ·  {exercises} exercises")
    say(f"Saved:   {out_name}", GREEN)

    today = dt.date.today().isoformat()
    if day != today:
        say(f"Note:    latest workout is {day}, not today ({today}).\n"
            f"         Did you re-export from FitNotes after logging?", YELLOW)

    # Upload to Google Drive
    if shutil.which("rclone") is None:
        say("Drive:   skipped (rclone not installed — run setup again)", YELLOW)
    else:
        ok = upload(out_path, out_name) and upload(out_path, LATEST_NAME)
        if ok:
            say(f"Drive:   uploaded to '{DRIVE_FOLDER}' ({out_name} + {LATEST_NAME})", GREEN)
        else:
            say("Drive:   upload FAILED — the file is still saved locally.\n"
                "         Check your internet, then tap again.", RED)

    # Keep only the newest KEEP_EXPORTS full exports
    removed = 0
    for old in exports[KEEP_EXPORTS:]:
        try:
            os.remove(old)
            removed += 1
        except OSError as e:
            say(f"  couldn't delete {os.path.basename(old)}: {e}", DIM)
    if removed:
        say(f"Cleanup: deleted {removed} old export(s), kept newest {KEEP_EXPORTS}", DIM)

    say("\n✓ Done", GREEN)


if __name__ == "__main__":
    main()
