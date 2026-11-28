#!/data/data/com.termux/files/usr/bin/bash
# One-time setup for the FitNotes "latest workout" button (Termux, F-Droid build).
# Safe to run again; it skips anything already done.

set -e
BASE="https://tinkeringdad.github.io/fitnotes/termux"
FOLDER="/storage/emulated/0/Download/_Fitnotes Filter"
SHORTCUT="$HOME/.shortcuts/Latest Workout"

step() { printf '\n\033[33m== %s ==\033[0m\n' "$1"; }

step "1/5  Installing Python and rclone (takes a few minutes)"
yes | pkg update -y >/dev/null 2>&1 || true
yes | pkg upgrade -y -o Dpkg::Options::=--force-confnew
pkg install -y python rclone termux-tools

step "2/5  Phone storage access"
if [ ! -r /storage/emulated/0/Download ]; then
  echo "Android will ask to let Termux access your files."
  echo "Tap ALLOW, or if a settings page opens, turn the switch ON and press Back."
  termux-setup-storage
  for i in $(seq 1 60); do [ -r /storage/emulated/0/Download ] && break; sleep 1; done
fi
[ -r /storage/emulated/0/Download ] || { echo "No storage access. Allow it in Settings > Apps > Termux > Permissions, then run setup again."; exit 1; }
echo "OK"

step "3/5  Installing the script into: $FOLDER"
mkdir -p "$FOLDER"
curl -fsSL "$BASE/fitnotes_today.py" -o "$FOLDER/fitnotes_today.py"
echo "OK"

step "4/5  Creating the home-screen button"
mkdir -p "$HOME/.shortcuts"
cat > "$SHORTCUT" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
python "$FOLDER/fitnotes_today.py"
EOF
chmod 700 "$HOME/.shortcuts" "$SHORTCUT"
echo "OK"

step "5/5  Connecting Google Drive"
# rclone opens the sign-in page with xdg-open; make sure that works in Termux.
if ! command -v xdg-open >/dev/null; then
  printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-open-url "$1"\n' > "$PREFIX/bin/xdg-open"
  chmod 755 "$PREFIX/bin/xdg-open"
fi
if rclone listremotes | grep -qx 'gdrive:'; then
  echo "Already connected."
else
  echo "Your browser will open a Google sign-in page."
  echo "Pick your Google account and tap Allow/Continue."
  echo "When the browser says 'Success', come back to Termux."
  echo "(If the browser doesn't open, long-press the http://127.0.0.1 link below and choose Open.)"
  echo
  rclone config create gdrive drive scope=drive.file
fi

step "Test run"
if ls "$FOLDER"/FitNotes_Export_*.csv >/dev/null 2>&1; then
  python "$FOLDER/fitnotes_today.py"
else
  echo "No FitNotes export in the folder yet. Export from FitNotes, then use the button."
fi

printf '\n\033[32mSetup complete.\033[0m Now add the Termux:Widget to your home screen.\n'
