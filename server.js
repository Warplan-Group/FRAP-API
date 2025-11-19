// Load environment variables from .env file if it exists (for local development)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, continue without it
}

const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 8080;

// Required ENV vars
const zoomAccountId = process.env.ZOOM_ACCOUNT_ID;
const zoomClientId = process.env.ZOOM_CLIENT_ID;
const zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;
const webhookSecret = process.env.WEBHOOK_SECRET;

// ===== MIDDLEWARE =====
app.use(express.json());

// ===== ZOOM HELPERS =====

// Get Access Token (Zapier Step 2)
async function getZoomAccessToken() {
  const authHeader = Buffer.from(`${zoomClientId}:${zoomClientSecret}`).toString('base64');

  const resp = await axios.post(
    'https://zoom.us/oauth/token',
    new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: zoomAccountId
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return resp.data.access_token;
}

// Optionally dynamically fetch ticket type (Zapier Step 3)
async function getZoomTicketTypeId(accessToken, eventId) {
  const resp = await axios.get(
    `https://api.zoom.us/v2/zoom_events/events/${eventId}/ticket_types`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const types = resp.data?.ticket_types || [];

  if (!types.length) {
    throw new Error(`No ticket types found for event ${eventId}`);
  }

  // Use the first ticket type (same as your Zap)
  return types[0].id;
}

// Create Ticket (Zapier Step 4)
async function createZoomTicket({ email, firstName, lastName, eventId }) {
  const accessToken = await getZoomAccessToken();

  // Step 3: dynamically pick ticket type
  const ticketTypeId = await getZoomTicketTypeId(accessToken, eventId);

  const resp = await axios.post(
    `https://api.zoom.us/v2/zoom_events/events/${eventId}/tickets`,
    {
      tickets: [
        {
          email,
          first_name: firstName,
          last_name: lastName,
          ticket_type_id: ticketTypeId
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return resp.data;
}

// Extract join link (Zapier Step 5)
function extractJoinLink(zoomData) {
  const ticket = zoomData?.tickets?.[0];
  if (!ticket) return null;

  return (
    ticket.event_join_link ||
    ticket.join_link ||
    ticket.registration_link ||
    null
  );
}

// ===== ROUTES =====

// Health check
app.get('/health', (_, res) => res.send('OK'));

// Main endpoint (replaces entire Zap)
app.post('/webhooks/ghl-to-zoom', async (req, res) => {
  try {
    // Shared secret check
    const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
    if (!webhookSecret || providedSecret !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Required fields from GHL
    const {
      email,
      firstName = '',
      lastName = '',
      eventId
    } = req.body;

    if (!email || !eventId) {
      return res.status(400).json({ error: 'Missing email or eventId' });
    }

    // Steps 2 → 5
    const zoomResponse = await createZoomTicket({
      email,
      firstName,
      lastName,
      eventId
    });

    const joinLink = extractJoinLink(zoomResponse);

    return res.status(200).json({
      status: 'success',
      email,
      eventId,
      joinLink,
      zoomResponse
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Zoom API error',
      message: err.message,
      zoomError: err.response?.data || null
    });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
