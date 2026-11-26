#!/usr/bin/env bash
# Sets up (or updates) your Listening server on Google Cloud. Run it in
# Google Cloud Shell (the >_ button at console.cloud.google.com):
#   bash <(curl -sL https://tinkeringdad.github.io/listen/setup.sh)
# Safe to run again any time; running it again installs the latest version.
set -euo pipefail

REF="${1:-main}"   # which version of the code to install (a branch name)
PROJECT="$(gcloud config get-value project 2>/dev/null)"
ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
[ -n "$PROJECT" ] || { echo "Pick your project in the console's top bar, then run this again."; exit 1; }
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
REGION="us-east1"
ROBOT="listening-robot@$PROJECT.iam.gserviceaccount.com"
BUCKET="$PROJECT-listening"
CLIENT_ID="488710691850-f3b4ma6isrgomdb80eskh89eqr0g59ja.apps.googleusercontent.com"

retry() {
  for i in $(seq 1 12); do
    if "$@" >/dev/null 2>/tmp/listening-err; then return 0; fi
    echo "   ...waiting for Google to finish a previous step ($i/12)"; sleep 10
  done
  cat /tmp/listening-err; return 1
}

echo "== 1/6 Turning on the Google services it uses"
gcloud services enable texttospeech.googleapis.com drive.googleapis.com storage.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

echo "== 2/6 The robot account the server runs as"
gcloud iam service-accounts describe "$ROBOT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create listening-robot --display-name="Listening audio robot"
retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$ROBOT" \
  --role="roles/serviceusage.serviceUsageConsumer" --condition=None

echo "== 3/6 The private bucket for audio"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$ROBOT" --role="roles/storage.objectAdmin"

echo "== 4/6 Allowing Google to build the server"
retry gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role="roles/run.builder" --condition=None

echo "== 5/6 Building and starting the server (takes 2-4 minutes)"
SRC="$(mktemp -d)"
git clone -q --depth 1 --branch "$REF" https://github.com/tinkeringdad/tinkeringdad.github.io "$SRC"
gcloud run deploy listening-api --source "$SRC/listen/server" --region "$REGION" --quiet \
  --service-account "$ROBOT" --allow-unauthenticated \
  --set-env-vars "BUCKET=$BUCKET,CLIENT_ID=$CLIENT_ID,ALLOWED_EMAILS=$ACCOUNT" \
  --memory 512Mi --timeout 600 --concurrency 20 --max-instances 2
rm -rf "$SRC"

echo "== 6/6 Removing old robot keys (the server needs none)"
for k in $(gcloud iam service-accounts keys list --iam-account "$ROBOT" --managed-by=user --format='value(name.basename())'); do
  gcloud iam service-accounts keys delete "$k" --iam-account "$ROBOT" --quiet
done
rm -f "$HOME/listening-robot-key.json"

URL="$(gcloud run services describe listening-api --region "$REGION" --format='value(status.url)')"
cat <<DONE

==================================================================
Done. Your Listening server is at:
  $URL
Only $ACCOUNT can use it.
Open https://tinkeringdad.github.io/listen/ on your phone.
==================================================================
DONE
