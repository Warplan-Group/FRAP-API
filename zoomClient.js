const axios = require('axios');

async function getZoomAccessToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(
    'https://zoom.us/oauth/token',
    new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: accountId
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
}

async function createZoomTicket({ email, firstName, lastName }) {
  const eventId = process.env.ZOOM_EVENT_ID;
  const accessToken = await getZoomAccessToken();

  const response = await axios.post(
    `https://api.zoom.us/v2/zoom_events/events/${eventId}/tickets`,
    {
      tickets: [
        {
          email,
          first_name: firstName,
          last_name: lastName
          // add ticket_type_id if you have multiple ticket types
          // ticket_type_id: 'YOUR_TICKET_TYPE_ID'
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

  return response.data;
}

module.exports = { getZoomAccessToken, createZoomTicket };
