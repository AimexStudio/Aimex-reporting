#!/usr/bin/env bash
# Deploys the reporting portal to Google Cloud Run. Safe to run again: setup steps are
# skipped when already done, and each run publishes the current code.
#
#   npm run deploy:gcp
#
# Optional overrides: GCP_PROJECT, GCP_REGION (default europe-west1, Belgium: supports custom domains), GCP_SERVICE,
# FIRESTORE_DATABASE_ID (only if the data is in a named Firestore database rather than "(default)").
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE="${GCP_SERVICE:-aimex-reports}"
SA_NAME="aimex-reports-run"
SECRET="session-secret"

if [ -z "$PROJECT" ]; then
  echo "No Google Cloud project selected. Run:  gcloud config set project YOUR-PROJECT-ID"; exit 1
fi
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
echo "Project: $PROJECT | Region: $REGION | Service: $SERVICE"

echo "1/5 Turning on the Google Cloud services the site needs…"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com --project "$PROJECT"

echo "2/5 Setting up the site's own identity (reads and writes Firestore; no key file needed)…"
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="Aimex reports (Cloud Run)" --project "$PROJECT"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role="roles/datastore.user" --condition=None --quiet >/dev/null
# The build itself runs as the project's default compute account, which needs permission to build.
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
BUILDER="serviceAccount:$NUM-compute@developer.gserviceaccount.com"
if ! gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
     --filter="bindings.members:$BUILDER AND bindings.role:roles/run.builder" --format="value(bindings.role)" | grep -q run.builder; then
  gcloud projects add-iam-policy-binding "$PROJECT" --member="$BUILDER" --role="roles/run.builder" --condition=None --quiet >/dev/null
  echo "   Gave the build account permission to build; waiting 90 seconds for Google to apply it…"
  sleep 90
fi

echo "3/5 Storing the sign-in secret in Secret Manager…"
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" \
    | gcloud secrets create "$SECRET" --data-file=- --replication-policy=automatic --project "$PROJECT"
fi
gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor" --project "$PROJECT" --quiet >/dev/null

# Admin Report: the ClickUp token, if it has been stored in Secret Manager as "clickup-api-token".
SECRETS="SESSION_SECRET=$SECRET:latest"
if gcloud secrets describe clickup-api-token --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets add-iam-policy-binding clickup-api-token --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" --project "$PROJECT" --quiet >/dev/null
  SECRETS="$SECRETS,CLICKUP_API_TOKEN=clickup-api-token:latest"
  echo "   Admin Report: using the ClickUp token from Secret Manager."
else
  echo "   Admin Report: no clickup-api-token secret yet, so the Admin Report page shows a “not connected” message."
fi

echo "4/5 Building and deploying (the first time takes about 5–10 minutes)…"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --project "$PROJECT" \
  --service-account "$SA" --allow-unauthenticated \
  --set-secrets "$SECRETS" \
  --set-env-vars "FIREBASE_PROJECT_ID=$PROJECT${FIRESTORE_DATABASE_ID:+,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID}${CLICKUP_TEAM_ID:+,CLICKUP_TEAM_ID=$CLICKUP_TEAM_ID}" \
  --memory 1Gi --cpu 1 --cpu-boost --min-instances 0 --max-instances 3 --timeout 300 --quiet

echo "5/5 Done."
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo ""
echo "The portal is live at: $URL"
