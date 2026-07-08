# Test script for Zoom event-end webhook
# Usage: .\test-webhook.ps1

$eventId = "xLypxcWCRu2u8N0KSYf1Hw"
# Get webhook secret from .env file, or use default
$envContent = Get-Content .env -ErrorAction SilentlyContinue
if ($envContent) {
    $webhookSecretLine = $envContent | Select-String "WEBHOOK_SECRET="
    if ($webhookSecretLine) {
        $webhookSecret = ($webhookSecretLine -split "=")[1].Trim()
    } else {
        $webhookSecret = "52778d6e55fc369bd0af2cdd128878bc5f14acd1d3dacd00a37d1adfedb774f7"
    }
} else {
    $webhookSecret = "52778d6e55fc369bd0af2cdd128878bc5f14acd1d3dacd00a37d1adfedb774f7"
}
$baseUrl = "http://localhost:8080"  # Change to Cloud Run URL when testing production

# Test payload (simulating Zoom webhook)
$body = @{
    event_id = $eventId
    event = @{
        id = $eventId
    }
} | ConvertTo-Json

Write-Host "Testing Zoom event-end webhook..." -ForegroundColor Cyan
Write-Host "Event ID: $eventId" -ForegroundColor Yellow
Write-Host "URL: $baseUrl/webhooks/zoom-event-end" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/webhooks/zoom-event-end" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{"x-webhook-secret"=$webhookSecret} `
        -Body $body
    
    Write-Host "Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Red
    }
}

