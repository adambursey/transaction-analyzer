#!/bin/bash

# Cloud Run Deployment Script for Transaction Analyzer

PROJECT_ID="tx-analyzer-1777844550"
REGION="us-central1"
SERVICE_NAME="transaction-analyzer"

# Allowed emails for access control
ALLOWED_EMAILS="abursey@gmail.com,annb1015@gmail.com"

# Load secrets from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found. Please create it and add your secrets."
  exit 1
fi

echo "Deploying to Google Cloud Run ($PROJECT_ID)..."

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="^|^ALLOWED_EMAILS=$ALLOWED_EMAILS|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET|SHEET_URL=$SHEET_URL|GEMINI_API_KEY=$GEMINI_API_KEY"

echo "Deployment finished."
