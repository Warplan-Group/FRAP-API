#!/bin/bash

# Test script for /webhooks/ghl-to-zoom endpoint
# Usage: ./test-ghl-to-zoom.sh [email] [eventId] [firstName] [lastName] [webhookSecret]

# Configuration
API_URL="${API_URL:-http://localhost:8080/webhooks/ghl-to-zoom}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-${5:-${WEBHOOK_SECRET}}}"

# Parameters (can be passed as arguments or use defaults)
EMAIL="${1:-test@example.com}"
EVENT_ID="${2:-your-event-id-here}"
FIRST_NAME="${3:-John}"
LAST_NAME="${4:-Doe}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Testing GHL to Zoom Webhook${NC}"
echo "=================================="
echo "URL: $API_URL"
echo "Email: $EMAIL"
echo "Event ID: $EVENT_ID"
echo "First Name: $FIRST_NAME"
echo "Last Name: $LAST_NAME"
echo ""

# Check if webhook secret is provided
if [ -z "$WEBHOOK_SECRET" ]; then
    echo -e "${RED}Warning: WEBHOOK_SECRET not provided. Request may fail with 401.${NC}"
    echo "Set it via: export WEBHOOK_SECRET=52778d6e55fc369bd0af2cdd128878bc5f14acd1d3dacd00a37d1adfedb774f7"
    echo "Or pass as 5th argument: ./test-ghl-to-zoom.sh email eventId firstName lastName secret"
    echo ""
fi

# Prepare JSON body
JSON_BODY=$(cat <<EOF
{
  "email": "$EMAIL",
  "firstName": "$FIRST_NAME",
  "lastName": "$LAST_NAME",
  "eventId": "$EVENT_ID"
}
EOF
)

# Make the request
echo -e "${YELLOW}Sending request...${NC}"
echo ""

if [ -z "$WEBHOOK_SECRET" ]; then
    # Request without secret (will likely fail, but useful for testing)
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "$JSON_BODY")
else
    # Request with secret in header
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "x-webhook-secret: $WEBHOOK_SECRET" \
        -d "$JSON_BODY")
fi

# Split response body and status code
HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

# Display results
echo -e "${YELLOW}Response Status:${NC} $HTTP_CODE"
echo ""
echo -e "${YELLOW}Response Body:${NC}"
echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"
echo ""

# Check if successful
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✓ Success!${NC}"
    # Extract join link if available
    JOIN_LINK=$(echo "$HTTP_BODY" | jq -r '.joinLink // empty' 2>/dev/null)
    if [ -n "$JOIN_LINK" ] && [ "$JOIN_LINK" != "null" ]; then
        echo -e "${GREEN}Join Link: $JOIN_LINK${NC}"
    fi
elif [ "$HTTP_CODE" -eq 401 ]; then
    echo -e "${RED}✗ Unauthorized - Check your WEBHOOK_SECRET${NC}"
elif [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${RED}✗ Bad Request - Check your email and eventId${NC}"
else
    echo -e "${RED}✗ Request failed${NC}"
fi

