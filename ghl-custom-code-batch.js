/**
 * GHL Custom Code — batch upsert contacts
 *
 * Input Data:
 *   people → {{inboundWebhookRequest.people}}
 *
 * Uses GHL's customRequest format:
 *   customRequest.post(url, { data, headers })
 */

const GHL_TOKEN = 'PASTE_PRIVATE_INTEGRATION_TOKEN';
const LOCATION_ID = 'IIj2wLTtKXJclBizkv0C';

const FIELD_ATTENDED = 'attended';
const FIELD_WEBINAR_DATE = 'date';
const FIELD_TIME_SPENT = 'time_spent';
const FIELD_ENGAGEMENT = 'engagement_score';

function parsePeople(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

async function upsertContact(person) {
  const url = 'https://services.leadconnectorhq.com/contacts/upsert';

  const headers = {
    Authorization: 'Bearer ' + GHL_TOKEN,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    locationId: LOCATION_ID
  };

  const data = {
    locationId: LOCATION_ID,
    email: String(person.email || ''),
    customFields: [
      { key: FIELD_ATTENDED, field_value: String(person.attended ?? '') },
      { key: FIELD_WEBINAR_DATE, field_value: String(person.webinarDate ?? '') },
      { key: FIELD_TIME_SPENT, field_value: String(person.timeSpentMinutes ?? '') },
      { key: FIELD_ENGAGEMENT, field_value: String(person.engagementScore ?? '') }
    ]
  };

  const postResponse = await customRequest.post(url, { data, headers });
  const status = Number(postResponse && postResponse.status ? postResponse.status : 0);

  if (status >= 400) {
    throw new Error('HTTP ' + status);
  }

  return true;
}

const people = parsePeople(inputData.people);
const results = [];

if (people.length === 0) {
  return {
    processed: 0,
    successCount: 0,
    errorCount: 0,
    results: [],
    hint: 'Add people array in Test Setup tab'
  };
}

for (let i = 0; i < people.length; i++) {
  const person = people[i];
  const email = String(person.email || '');

  if (!email) {
    results.push({ email: '', status: 'skipped' });
    continue;
  }

  try {
    await upsertContact(person);
    results.push({ email: email, status: 'success' });
  } catch (err) {
    results.push({
      email: email,
      status: 'error',
      error: String(err && err.message ? err.message : err)
    });
  }
}

let successCount = 0;
let errorCount = 0;

for (let j = 0; j < results.length; j++) {
  if (results[j].status === 'success') successCount++;
  if (results[j].status === 'error') errorCount++;
}

return {
  processed: results.length,
  successCount: successCount,
  errorCount: errorCount,
  results: results
};
