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
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$SERVICE:$SHORT_SHA"

gcloud builds submit \
  --config cloudbuild.deploy.yaml \
  --substitutions "_IMAGE=$IMAGE" \
  --project "$PROJECT_ID"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --memory "${GCP_CLOUD_RUN_MEMORY:-1Gi}" \
  --cpu "${GCP_CLOUD_RUN_CPU:-1}" \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances "${GCP_CLOUD_RUN_MAX_INSTANCES:-3}" \
  --timeout 300 \
  --set-env-vars "^|^NEXT_PUBLIC_SITE_URL=$SITE_URL|NEXT_PUBLIC_DEPLOY_CHANNEL=$CHANNEL|POLYVISE_APP_CHANNEL=$CHANNEL|POLYVISE_REPOSITORY=${POLYVISE_REPOSITORY:-firestore}|FIRESTORE_PROJECT_ID=${FIRESTORE_PROJECT_ID:-$PROJECT_ID}|POLYVISE_ENABLE_MOCK_LLM=${POLYVISE_ENABLE_MOCK_LLM:-false}|POLYVISE_EVIDENCE_PROVIDER=${POLYVISE_EVIDENCE_PROVIDER:-tavily}|POLYVISE_QUICK_MODEL=${POLYVISE_QUICK_MODEL:-openai/gpt-4o-mini}|POLYVISE_DEEP_MODEL=${POLYVISE_DEEP_MODEL:-openai/gpt-4o-mini}|POLYVISE_YES_MODEL=${POLYVISE_YES_MODEL:-${POLYVISE_QUICK_MODEL:-openai/gpt-4o-mini}}|POLYVISE_NO_MODEL=${POLYVISE_NO_MODEL:-${POLYVISE_DEEP_MODEL:-openai/gpt-4o-mini}}|POLYVISE_JUDGE_MODEL=${POLYVISE_JUDGE_MODEL:-openai/gpt-4o-mini}|POLYVISE_LLM_TIMEOUT_MS=${POLYVISE_LLM_TIMEOUT_MS:-45000}|POLYVISE_LLM_MAX_TOKENS=${POLYVISE_LLM_MAX_TOKENS:-2200}" \
  --update-secrets "OPENROUTER_API_KEY=debatefrog-openrouter-api-key:latest,TAVILY_API_KEY=debatefrog-tavily-api-key:latest"

gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format "value(status.url)"
