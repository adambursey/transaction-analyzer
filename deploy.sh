#!/bin/bash

# Cloud Run Deployment Script for Transaction Analyzer

PROJECT_ID="tx-analyzer-1777844550"
REGION="us-central1"
SERVICE_NAME="transaction-analyzer"

# Allowed emails for access control
ALLOWED_EMAILS="abursey@gmail.com,annb1015@gmail.com"

# TODO: Please fill in your secrets before running this script!
GOOGLE_CLIENT_ID="y464729360910-lth6branimqo13kmirv5cl4vbvsj7tk1.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="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"
SHEET_URL="https://docs.google.com/spreadsheets/d/1BcpK8KVnEHMQdBXSeV2tdcU7_5ch0fthAmbzGteXX-Y/edit?gid=2121452751#gid=2121452751"

echo "Deploying to Google Cloud Run ($PROJECT_ID)..."

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="^|^ALLOWED_EMAILS=$ALLOWED_EMAILS|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET|SHEET_URL=$SHEET_URL"

echo "Deployment finished."
