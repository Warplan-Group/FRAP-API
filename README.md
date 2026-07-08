# FRAP API

API for handling GHL to Zoom webhook integration.

## Local Development

### Prerequisites
- Node.js 22 or higher
- npm

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```bash
PORT=8080
ZOOM_ACCOUNT_ID=your_zoom_account_id
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret
WEBHOOK_SECRET=your_webhook_secret
```

3. Run the server:
```bash
npm start
```

Or for development:
```bash
npm run dev
```

The server will start on `http://localhost:8080`

### Testing Endpoints

**Health Check:**
```bash
curl http://localhost:8080/health
```

**Webhook Endpoint:**
```bash
curl -X POST http://localhost:8080/webhooks/ghl-to-zoom \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your_webhook_secret" \
  -d '{
    "email": "test@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "eventId": "your_event_id"
  }'
```

## Testing

### Test Zoom Event-End Webhook (Attendance)

**Using PowerShell script:**
```powershell
.\test-webhook.ps1
```

**Manual PowerShell test:**
```powershell
$body = @{
    event_id = "17avBskzRY6q10kPGHUBpw"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8080/webhooks/zoom-event-end" `
    -Method POST `
    -ContentType "application/json" `
    -Headers @{"x-webhook-secret"="your_webhook_secret"} `
    -Body $body
```

**Test on Cloud Run:**
```powershell
$body = @{
    event_id = "17avBskzRY6q10kPGHUBpw"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://frap-api-145186078912.us-south1.run.app/webhooks/zoom-event-end" `
    -Method POST `
    -ContentType "application/json" `
    -Headers @{"x-webhook-secret"="your_webhook_secret"} `
    -Body $body
```

### Testing Steps:

1. **Test locally first** - Make sure your `.env` file has all credentials
2. **Check server logs** - Watch the console for processing messages
3. **Verify GHL receives data** - Check your GHL webhook logs
4. **Test with real event** - Use an event that has registrants/attendees

## Environment Variables

- `PORT` - Server port (default: 8080)
- `ZOOM_ACCOUNT_ID` - Zoom account ID
- `ZOOM_CLIENT_ID` - Zoom OAuth client ID
- `ZOOM_CLIENT_SECRET` - Zoom OAuth client secret
- `WEBHOOK_SECRET` - Secret for manual webhook authentication (`x-webhook-secret`)
- `ZOOM_WEBHOOK_SECRET` - Zoom Event Subscription **Secret Token** (required for Marketplace URL validation)
- `GHL_WEBHOOK_URL` - GHL inbound webhook URL (optional, has default)

## Post-Zoom Report → GHL

`POST /webhooks/zoom-event-end` handles:

1. **Zoom URL validation** — responds to `endpoint.url_validation` with HMAC SHA-256 of `plainToken` using `ZOOM_WEBHOOK_SECRET`
2. **Session ended** — accepts Zoom `session_ended` payloads, returns `200` immediately, then pulls attendance and sends **one JSON batch** to GHL

Manual tests still work with `x-webhook-secret` and `{ "event_id": "..." }`.

Sends **one JSON batch** to GHL:

```json
{
  "eventId": "...",
  "webinarDate": "2026-06-29",
  "totalPeople": 51,
  "people": [
    {
      "email": "roger@...",
      "attended": "yes",
      "webinarDate": "2026-06-29",
      "timeSpentMinutes": "102",
      "engagementScore": "5.9"
    }
  ]
}
```

GHL workflow: Inbound Webhook → **Custom Code** (loop `people`, upsert each contact) → END.

