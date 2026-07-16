// Load environment variables from .env file if it exists (for local development)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, continue without it
}

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 8080;

// Required ENV vars
const zoomAccountId = process.env.ZOOM_ACCOUNT_ID;
const zoomClientId = process.env.ZOOM_CLIENT_ID;
const zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;
const webhookSecret = process.env.WEBHOOK_SECRET;
const zoomWebhookSecret = process.env.ZOOM_WEBHOOK_SECRET;
const ghlWebhookUrl = process.env.GHL_WEBHOOK_URL || 'https://services.leadconnectorhq.com/hooks/IIj2wLTtKXJclBizkv0C/webhook-trigger/60bd96c1-ce08-4bf9-995a-6df73fba52d2';

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For URL-encoded data

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

  // Zoom returns ticket_type_id (not id)
  return types[0].ticket_type_id || types[0].id;
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
          ticket_type_id: ticketTypeId,
          send_notification: true,
          fast_join: false
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

// Pull webinar/event date from Zoom event details
function extractWebinarDate(eventData) {
  const candidates = [
    eventData?.start_time,
    eventData?.calendar?.[0]?.start_time,
    eventData?.calendar?.[0]?.start,
    eventData?.sessions?.[0]?.start_time,
    eventData?.sessions?.[0]?.start
  ];

  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return '';
}

function sumTimeSpentMinutes(sessionAttendance = []) {
  return sessionAttendance.reduce((total, session) => {
    const minutes = Number(session?.duration_spent_in_session);
    return total + (Number.isFinite(minutes) ? minutes : 0);
  }, 0);
}

function didAttend(person) {
  const eventStatus = String(person?.event_attendance || '').toLowerCase();
  if (eventStatus === 'attended' || eventStatus === 'yes') return true;
  if (eventStatus === 'absent' || eventStatus === 'no') return false;

  const sessions = person?.session_attendance || [];
  return sessions.some((session) => {
    const status = String(session?.session_attendance || '').toLowerCase();
    return status === 'attended' || status === 'yes';
  });
}

// People-tab style report: attended yes/no, time spent, optional engagement
function mapPersonSummary(person, webinarDate) {
  const timeSpentMinutes = sumTimeSpentMinutes(person?.session_attendance);
  const engagementScore =
    person?.engagement_score ??
    person?.engagementScore ??
    '';

  return {
    email: person?.email || '',
    firstName: person?.first_name || '',
    lastName: person?.last_name || '',
    webinarDate,
    attended: didAttend(person),
    timeSpentMinutes,
    engagementScore: engagementScore === null || engagementScore === undefined
      ? ''
      : String(engagementScore)
  };
}

async function fetchPaginatedAttendees(url, accessToken, label) {
  const attendees = [];
  let nextPageToken = null;
  let pageCount = 0;

  do {
    const params = { page_size: 300 };
    if (nextPageToken) params.next_page_token = nextPageToken;

    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params
    });

    const page = resp.data?.attendees || [];
    attendees.push(...page);
    nextPageToken = resp.data?.next_page_token || null;
    pageCount += 1;
    console.log(`${label} page ${pageCount}: ${page.length} people (total ${attendees.length})`);
  } while (nextPageToken);

  return attendees;
}

// Get Zoom Person Summary style attendance for an event
async function getZoomEventAttendance(eventId) {
  const accessToken = await getZoomAccessToken();

  try {
    const eventResp = await axios.get(
      `https://api.zoom.us/v2/zoom_events/events/${eventId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const eventData = eventResp.data;
    const webinarDate = extractWebinarDate(eventData);
    const sessions = eventData?.sessions || [];

    console.log(
      `Event ${eventId}: type=${eventData?.event_type}, sessions=${sessions.length}, webinarDate=${webinarDate || 'unknown'}`
    );

    // Primary source: Zoom Events People/attendance report (closest to Person Summary CSV)
    try {
      const reportPeople = await fetchPaginatedAttendees(
        `https://api.zoom.us/v2/zoom_events/events/${eventId}/reports/event_attendance`,
        accessToken,
        'event_attendance'
      );

      if (reportPeople.length > 0) {
        const mapped = reportPeople
          .map((person) => mapPersonSummary(person, webinarDate))
          .filter((person) => person.email);

        console.log(`Mapped ${mapped.length} people from event_attendance report`);
        console.log('Sample person summary:', JSON.stringify(mapped[0], null, 2));
        return mapped;
      }

      console.log('event_attendance returned 0 people — trying session attendance reports');
    } catch (reportErr) {
      console.error(
        'event_attendance report failed:',
        reportErr.response?.data || reportErr.message
      );
    }

    // Fallback: per-session attendance reports aggregated by email
    if (sessions.length > 0) {
      const byEmail = new Map();

      for (const session of sessions) {
        const sessionId = session.id || session.session_id;
        if (!sessionId) continue;

        try {
          const sessionPeople = await fetchPaginatedAttendees(
            `https://api.zoom.us/v2/zoom_events/events/${eventId}/reports/sessions/${sessionId}/attendance`,
            accessToken,
            `session ${sessionId}`
          );

          for (const person of sessionPeople) {
            const email = person?.email;
            if (!email) continue;

            const existing = byEmail.get(email) || {
              email,
              first_name: person.first_name,
              last_name: person.last_name,
              engagement_score: person.engagement_score,
              session_attendance: []
            };

            existing.session_attendance.push({
              session_id: sessionId,
              session_attendance: person.session_attendance,
              duration_spent_in_session: person.duration_spent_in_session,
              chat_messages_sent: person.chat_messages_sent
            });

            byEmail.set(email, existing);
          }
        } catch (sessionErr) {
          console.error(
            `Session attendance failed for ${sessionId}:`,
            sessionErr.response?.data || sessionErr.message
          );
        }
      }

      const mapped = [...byEmail.values()].map((person) =>
        mapPersonSummary(person, webinarDate)
      );

      if (mapped.length > 0) {
        console.log(`Mapped ${mapped.length} people from session attendance reports`);
        return mapped;
      }
    }

    console.log('WARNING: No person summary data found for event');
    return [];
  } catch (err) {
    console.error('Error fetching attendance:', err.response?.data || err.message);
    throw err;
  }
}

function isZoomWebhookPayload(body) {
  return Boolean(body && typeof body.event === 'string');
}

function extractZoomEventId(body) {
  return (
    body?.event_id ||
    body?.eventId ||
    body?.event?.id ||
    body?.payload?.object?.event_id ||
    body?.payload?.event_id ||
    null
  );
}

function handleZoomUrlValidation(req, res) {
  const plainToken = req.body?.payload?.plainToken;

  if (!plainToken) {
    return res.status(400).json({ error: 'Missing plainToken' });
  }

  if (!zoomWebhookSecret) {
    return res.status(500).json({ error: 'ZOOM_WEBHOOK_SECRET not configured' });
  }

  const encryptedToken = crypto
    .createHmac('sha256', zoomWebhookSecret)
    .update(plainToken)
    .digest('hex');

  return res.status(200).json({ plainToken, encryptedToken });
}

async function processEventEndReport(eventId) {
  console.log(`Processing person summary report for event: ${eventId}`);

  const people = await getZoomEventAttendance(eventId);

  if (!people || people.length === 0) {
    console.log(`No people found for event ${eventId}`);
    return { eventId, processed: 0 };
  }

  const peopleWithEmail = people.filter((person) => person.email);
  if (peopleWithEmail.length === 0) {
    console.log(`No people with email found for event ${eventId}`);
    return { eventId, processed: 0 };
  }

  const webinarDate = peopleWithEmail[0]?.webinarDate || '';
  console.log(
    `Sending 1 GHL batch for event ${eventId}: ${peopleWithEmail.length} people`
  );

  await sendAttendanceBatchToGHL({
    eventId,
    webinarDate,
    people: peopleWithEmail
  });

  return {
    eventId,
    mode: 'batch',
    processed: peopleWithEmail.length,
    attended: peopleWithEmail.filter((p) => p.attended).length,
    absent: peopleWithEmail.filter((p) => !p.attended).length
  };
}

// One GHL webhook for the whole event (batch). GHL Custom Code loops people[].
async function sendAttendanceBatchToGHL({ eventId, webinarDate, people }) {
  const payload = {
    eventId,
    webinarDate: webinarDate || '',
    totalPeople: people.length,
    attendedCount: people.filter((p) => p.attended).length,
    absentCount: people.filter((p) => !p.attended).length,
    people: people.map((person) => ({
      email: person.email,
      attended: person.attended ? 'yes' : 'no',
      webinarDate: person.webinarDate || webinarDate || '',
      timeSpentMinutes: String(person.timeSpentMinutes ?? 0),
      engagementScore: person.engagementScore || ''
    }))
  };

  try {
    const response = await axios.post(ghlWebhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    return response.data;
  } catch (err) {
    console.error('Error sending batch to GHL:', err.response?.data || err.message);
    throw err;
  }
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

// Zoom webhook endpoint - handles event end and sends attendance to GHL
app.post('/webhooks/zoom-event-end', async (req, res) => {
  try {
    if (req.body?.event === 'endpoint.url_validation') {
      return handleZoomUrlValidation(req, res);
    }

    const isZoom = isZoomWebhookPayload(req.body);

    if (!isZoom) {
      const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
      if (webhookSecret && providedSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const eventId = extractZoomEventId(req.body);

    if (!eventId) {
      return res.status(400).json({ error: 'Missing eventId in webhook payload' });
    }

    if (isZoom) {
      res.status(200).json({ status: 'accepted', eventId });
      processEventEndReport(eventId).catch((err) => {
        console.error(`Background report failed for ${eventId}:`, err);
      });
      return;
    }

    const result = await processEventEndReport(eventId);

    return res.status(200).json({
      status: 'success',
      ...result,
      ghl: 'single webhook push'
    });
  } catch (err) {
    console.error('Zoom webhook error:', err);
    return res.status(500).json({
      error: 'Webhook processing error',
      message: err.message,
      zoomError: err.response?.data || null
    });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`Server running on port ${port}`));
