#!/usr/bin/env bash
# One-time Google Cloud setup for the Listening reader.
# Run it in Google Cloud Shell (the >_ button at the top of console.cloud.google.com):
#   bash <(curl -sL https://tinkeringdad.github.io/listen/setup.sh)
# It is safe to run more than once. It creates no public files.
set -euo pipefail

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ]; then
  echo "No project selected. Pick your project in the console's top bar, then run this again."; exit 1
fi
ROBOT_NAME="listening-robot"
ROBOT="$ROBOT_NAME@$PROJECT.iam.gserviceaccount.com"
BUCKET="$PROJECT-listening"
READER_ORIGIN="https://tinkeringdad.github.io"

# Google takes a little while to finish creating a new robot account, so
# steps that use it are retried for up to two minutes.
retry() {
  for i in $(seq 1 12); do
    if "$@" >/dev/null 2>/tmp/listening-err; then return 0; fi
    echo "   ...waiting for Google to finish setting up the robot ($i/12)"
    sleep 10
  done
  cat /tmp/listening-err; return 1
}

if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)" = "False" ]; then
  echo "Project $PROJECT has no billing account. Turn on billing for it in the console, then run this again."; exit 1
fi

echo "== 1/5 Turning on Text-to-Speech, Drive and Cloud Storage for project $PROJECT"
gcloud services enable texttospeech.googleapis.com drive.googleapis.com storage.googleapis.com

echo "== 2/5 Creating the robot account GitHub will use"
gcloud iam service-accounts describe "$ROBOT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$ROBOT_NAME" --display-name="Listening audio robot"
retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$ROBOT" \
  --role="roles/serviceusage.serviceUsageConsumer" --condition=None

echo "== 3/5 Creating the private audio bucket gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location=us-east1 \
    --uniform-bucket-level-access --public-access-prevention
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$ROBOT" --role="roles/storage.objectAdmin"

echo "== 4/5 Letting the reader page (and only it) download from the bucket after you sign in"
cat > /tmp/listening-cors.json <<JSON
[{"origin": ["$READER_ORIGIN", "http://localhost:8000"],
  "method": ["GET", "HEAD"],
  "responseHeader": ["Authorization", "Content-Type", "Range"],
  "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/listening-cors.json

echo "== 5/5 Making the robot's key (goes into GitHub Secrets, nowhere else)"
KEYFILE="$HOME/listening-robot-key.json"
[ -s "$KEYFILE" ] || retry gcloud iam service-accounts keys create "$KEYFILE" --iam-account="$ROBOT"

cat <<DONE

==================================================================
Done. Three things to copy:

 A) Robot email (share your Drive "Listening" folder with it, as Viewer):
    $ROBOT

 B) Project ID (send this to Claude, it is not a secret):
    $PROJECT

 C) The key, for GitHub Secrets. Print it with:
      cat $KEYFILE
    Copy everything from { to }, then delete the file with:
      rm $KEYFILE
==================================================================
DONE
