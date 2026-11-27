#!/data/data/com.termux/files/usr/bin/bash
# FitNotes "today's workout" extractor for Termux.
# Finds the newest non-empty FitNotes export, keeps the header plus one day's
# rows, and writes FitNotes_YYYY-MM-DD.csv next to it. Never touches the exports.

FOLDER="${FITNOTES_FOLDER:-/storage/emulated/0/Download/_Fitnotes Filter}"

# Use the phone's own timezone even if TZ isn't set in this shell.
if [ -z "$TZ" ] && command -v getprop >/dev/null 2>&1; then
    PHONE_TZ=$(getprop persist.sys.timezone 2>/dev/null)
    [ -n "$PHONE_TZ" ] && export TZ="$PHONE_TZ"
fi

notify() {
    echo "$1"
    command -v termux-toast >/dev/null 2>&1 && termux-toast -g top "$1"
}

finish() {
    echo
    read -r -p "Press Enter to close..."
    exit "${1:-0}"
}

TODAY=$(date +%F)

if [ ! -d "$FOLDER" ]; then
    notify "Can't open the FitNotes folder."
    echo "Looked for: $FOLDER"
    echo "If it exists, run: termux-setup-storage   (then allow Files access)"
    finish 1
fi

# Newest export by the timestamp in its NAME (FitNotes_Export_YYYY_MM_DD_HH_MM_SS),
# skipping 0-byte files. Names sort chronologically, so reverse name order = newest first.
SRC=""
FILES=( "$FOLDER"/FitNotes_Export_*.csv )
for (( i=${#FILES[@]}-1; i>=0; i-- )); do
    [ -s "${FILES[i]}" ] && { SRC="${FILES[i]}"; break; }
done

if [ -z "$SRC" ]; then
    notify "No usable FitNotes export found."
    echo "Looked in: $FOLDER"
    echo "(If files are there but 0 bytes, re-export from FitNotes.)"
    finish 1
fi

# Read the export as whole CSV records: strips Windows line endings and keeps
# a quoted comment that spans lines together with its row.
# mode "latest" prints the newest date; mode "rows" prints header + that day's rows.
csv_pass() {
    awk -v mode="$1" -v want="$2" -v countfile="$TMP.n" '
        { sub(/\r$/, "") }
        {
            rec = (open ? rec "\n" $0 : $0)
            n = gsub(/"/, "\"", $0)
            if (n % 2) open = !open
            if (open) next
        }
        NR_REC++ == 0 { if (mode == "rows") print rec; next }
        {
            d = substr(rec, 1, 10)
            if (mode == "latest") {
                if (d ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ && d > max) max = d
            } else if (substr(rec, 1, 11) == want ",") {
                print rec
                cnt++
            }
        }
        END {
            if (mode == "latest") print max
            else print cnt + 0 > countfile
        }
    ' "$SRC"
}

TARGET="$TODAY"
TMP="$FOLDER/.fitnotes_tmp_$$"
csv_pass rows "$TARGET" > "$TMP"
COUNT=$(cat "$TMP.n")

if [ "$COUNT" -eq 0 ]; then
    TARGET=$(csv_pass latest)
    if [ -z "$TARGET" ]; then
        rm -f "$TMP" "$TMP.n"
        notify "That export has no workout rows."
        echo "Source: $(basename "$SRC")"
        finish 1
    fi
    FELL_BACK=1
    csv_pass rows "$TARGET" > "$TMP"
    COUNT=$(cat "$TMP.n")
fi

OUT="$FOLDER/FitNotes_$TARGET.csv"
mv -f "$TMP" "$OUT"
rm -f "$TMP.n"

command -v termux-media-scan >/dev/null 2>&1 && termux-media-scan "$OUT" >/dev/null 2>&1

echo "─────────────────────────────────────"
echo "Source : $(basename "$SRC")"
[ -n "$FELL_BACK" ] && echo "Note   : no rows dated $TODAY — used $TARGET instead"
echo "Date   : $TARGET"
echo "Rows   : $COUNT"
echo "Output : $(basename "$OUT")"
echo "─────────────────────────────────────"

if [ -n "$FELL_BACK" ]; then
    notify "No rows for today. $COUNT rows from $TARGET ready"
else
    notify "$COUNT rows from $TARGET ready"
fi
finish 0
