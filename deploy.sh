#!/bin/bash

# Cloud Run Deployment Script for Transaction Analyzer

PROJECT_ID="tx-analyzer-1777844550"
REGION="us-central1"
SERVICE_NAME="transaction-analyzer"

# Allowed emails for access control
ALLOWED_EMAILS="abursey@gmail.com,annb1015@gmail.com"

# TODO: Please fill in your secrets before running this script!
GOOGLE_CLIENT_ID="489644758279-10834amjc0k3moguamitr22msih1qu59.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="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"
SHEET_URL="https://docs.google.com/spreadsheets/d/1BcpK8KVnEHMQdBXSeV2tdcU7_5ch0fthAmbzGteXX-Y/edit?gid=2121452751#gid=2121452751"
GEMINI_API_KEY="AQ.Ab8RN6LDY98LySzNkVds6E47FSZ4slFP1qNoVDCTZuOOPL5WXQ"

echo "Deploying to Google Cloud Run ($PROJECT_ID)..."

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="^|^ALLOWED_EMAILS=$ALLOWED_EMAILS|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET|SHEET_URL=$SHEET_URL|GEMINI_API_KEY=$GEMINI_API_KEY"

echo "Deployment finished."
