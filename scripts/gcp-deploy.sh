#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-production}"
if [[ "$TARGET" != "production" && "$TARGET" != "preview" ]]; then
  echo "Usage: $0 [production|preview]" >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
ARTIFACT_REPO="${GCP_ARTIFACT_REPO:-polyvise}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Set GCP_PROJECT_ID or configure a gcloud project." >&2
  exit 1
fi

if [[ "$TARGET" == "preview" ]]; then
  SERVICE="${GCP_DEBATEFROG_PREVIEW_SERVICE:-debatefrog-preview-web}"
  SITE_URL="${DEBATEFROG_PREVIEW_SITE_URL:-https://preview.debatefrog.com}"
  CHANNEL="preview"
else
  SERVICE="${GCP_DEBATEFROG_SERVICE:-debatefrog-web}"
  SITE_URL="${DEBATEFROG_SITE_URL:-https://debatefrog.com}"
  CHANNEL="production"
fi

SHORT_SHA="$(git rev-parse --short HEAD)"
IMAGE="${GCP_DEBATEFROG_PREBUILT_IMAGE:-$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$SERVICE:$SHORT_SHA}"

if [[ -z "${GCP_DEBATEFROG_PREBUILT_IMAGE:-}" ]]; then
  gcloud builds submit \
    --config cloudbuild.deploy.yaml \
    --substitutions "_IMAGE=$IMAGE,_DEPLOY_CHANNEL=$CHANNEL" \
    --project "$PROJECT_ID"
fi

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --memory "${GCP_CLOUD_RUN_MEMORY:-1Gi}" \
  --cpu "${GCP_CLOUD_RUN_CPU:-1}" \
  --no-cpu-throttling \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances "${GCP_CLOUD_RUN_MAX_INSTANCES:-3}" \
  --timeout 300 \
  --set-env-vars "^|^NEXT_PUBLIC_SITE_URL=$SITE_URL|NEXT_PUBLIC_DEPLOY_CHANNEL=$CHANNEL|POLYVISE_APP_CHANNEL=$CHANNEL|POLYVISE_REPOSITORY=${POLYVISE_REPOSITORY:-firestore}|FIRESTORE_PROJECT_ID=${FIRESTORE_PROJECT_ID:-$PROJECT_ID}|POLYVISE_API_URL=${POLYVISE_API_URL:-https://api.polyvise.ai}|DEBATEFROG_CALLBACK_URL=${DEBATEFROG_CALLBACK_URL:-$SITE_URL}|POLYVISE_QUICK_MODEL=${POLYVISE_QUICK_MODEL:-openai/gpt-4o-mini}|POLYVISE_DEEP_MODEL=${POLYVISE_DEEP_MODEL:-openai/gpt-4.1}|POLYVISE_OPENING_MODEL=${POLYVISE_OPENING_MODEL:-openai/gpt-4o-mini}|POLYVISE_CROSS_EXAMINATION_MODEL=${POLYVISE_CROSS_EXAMINATION_MODEL:-openai/gpt-4o-mini}|POLYVISE_REBUTTAL_MODEL=${POLYVISE_REBUTTAL_MODEL:-openai/gpt-4.1}|POLYVISE_CLOSING_MODEL=${POLYVISE_CLOSING_MODEL:-openai/gpt-4.1}|POLYVISE_JUDGE_MODEL=${POLYVISE_JUDGE_MODEL:-openai/gpt-4.1}" \
  --set-secrets "POLYVISE_API_KEY=polyvise-api-key-debatefrog:latest"

gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format "value(status.url)"
