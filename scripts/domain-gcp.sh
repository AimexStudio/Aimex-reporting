#!/usr/bin/env bash
# Points your own domain (e.g. reports.aimexstudio.co.za) at the Cloud Run service and prints
# the DNS record to add at your domain registrar. Google then issues the HTTPS certificate itself.
#
#   npm run domain:gcp -- reports.aimexstudio.co.za
set -euo pipefail
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then echo "Usage: npm run domain:gcp -- reports.yourdomain.co.za"; exit 1; fi
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE="${GCP_SERVICE:-aimex-reports}"
ROOT="$(echo "$DOMAIN" | awk -F. '{ if (NF>=3 && $(NF-1) ~ /^(co|org|net|ac|gov)$/) print $(NF-2)"."$(NF-1)"."$NF; else print $(NF-1)"."$NF }')"

echo "Domain: $DOMAIN | Project: $PROJECT | Region: $REGION | Service: $SERVICE"
gcloud components install beta --quiet >/dev/null 2>&1 || true

# Google only maps domains you've proven you own (once per domain and Google account).
# Either the domain itself (e.g. reports.example.co.za) or any parent domain may be the verified one.
VERIFIED="$(gcloud domains list-user-verified --format='value(id)' 2>/dev/null || true)"
covered=""
d="$DOMAIN"
while [ -n "$d" ]; do
  if printf '%s\n' "$VERIFIED" | grep -qx "$d"; then covered="$d"; break; fi
  case "$d" in *.*) d="${d#*.}" ;; *) d="" ;; esac
done
if [ -z "$covered" ]; then
  echo ""
  echo "First, prove you own $ROOT. A browser page opens: follow it (it gives you a TXT record to add at your"
  echo "domain registrar), then run this command again. If you verified $ROOT for another project, use the same Google account."
  gcloud domains verify "$ROOT"
  exit 0
fi

echo "Ownership confirmed through: $covered"
gcloud beta run domain-mappings describe --domain "$DOMAIN" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud beta run domain-mappings create --service "$SERVICE" --domain "$DOMAIN" --region "$REGION" --project "$PROJECT"

echo ""
echo "Add this DNS record at your domain registrar (where $ROOT is managed):"
gcloud beta run domain-mappings describe --domain "$DOMAIN" --region "$REGION" --project "$PROJECT" \
  --format="table[box](status.resourceRecords[].name:label=NAME,status.resourceRecords[].type:label=TYPE,status.resourceRecords[].rrdata:label=VALUE)"
echo ""
echo "Once the record is in place, Google issues the HTTPS certificate (usually 15 minutes, up to a day)."
echo "Check progress with:  gcloud beta run domain-mappings describe --domain $DOMAIN --region $REGION"
