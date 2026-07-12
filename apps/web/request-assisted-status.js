import {
  clearStatusMessage,
  formatDate,
  hasPlaceholderConfig,
  lookupRequestStatus,
  normalizeMobile,
  sanitizeText,
  setStatusMessage,
} from './request-assisted-common.js?v=20260712-1';

const form = document.getElementById('status-form');
const feedbackEl = document.getElementById('status-feedback');
const configWarningEl = document.getElementById('status-config-warning');
const resultCard = document.getElementById('status-result');

function renderResult(data) {
  document.getElementById('result-order-id').textContent = data.order_id || '—';
  document.getElementById('result-status').textContent = String(data.status || 'REQUEST RECEIVED').replace(/_/g, ' ');
  document.getElementById('result-assigned-volunteer').textContent = data.assigned_volunteer || '—';
  document.getElementById('result-created-at').textContent = formatDate(data.created_at);
  document.getElementById('result-outcome').textContent = data.result_status || 'Pending';
  document.getElementById('result-ac-number').textContent = data.ac_number || '—';
  document.getElementById('result-part-number').textContent = data.part_number || '—';
  document.getElementById('result-serial-number').textContent = data.serial_number || '—';

  let message = 'Your request has been received.';
  if (data.status === 'ASSIGNED') {
    message = 'Your request has been assigned for manual search.';
  } else if (data.status === 'COMPLETED') {
    message = 'Your request has been completed. Please wait for volunteer follow-up if needed.';
  } else if (data.status === 'NOT_FOUND') {
    message = 'The manual search is complete and no record could be located.';
  }

  document.getElementById('result-message').textContent = message;
  resultCard.hidden = false;
}

async function handleLookup(event) {
  event.preventDefault();
  clearStatusMessage(feedbackEl);
  resultCard.hidden = true;

  if (hasPlaceholderConfig()) {
    setStatusMessage(configWarningEl, 'error', 'Configure Supabase in request-assisted-config.js before using status lookup.');
    return;
  }

  const orderId = sanitizeText(form.order_id.value).toUpperCase();
  const mobile = normalizeMobile(form.mobile.value);
  if (!orderId || mobile.length !== 10) {
    setStatusMessage(feedbackEl, 'error', 'Enter a valid Ticket ID and the same 10-digit mobile number used in the request.');
    return;
  }

  setStatusMessage(feedbackEl, 'info', 'Checking request status...');
  try {
    const response = await lookupRequestStatus(orderId, mobile);
    const record = Array.isArray(response) ? response[0] : response;
    if (!record) {
      throw new Error('No request matched the provided Ticket ID and mobile number.');
    }
    clearStatusMessage(feedbackEl);
    renderResult(record);
  } catch (err) {
    setStatusMessage(feedbackEl, 'error', err.message || 'Unable to check status right now.');
  }
}

if (hasPlaceholderConfig()) {
  setStatusMessage(configWarningEl, 'error', 'Supabase is not configured yet. Replace the placeholders in request-assisted-config.js.');
}

form.addEventListener('submit', handleLookup);
