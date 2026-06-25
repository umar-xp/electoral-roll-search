import {
  adminLogin,
  clearFoundRequests,
  clearSession,
  clearStatusMessage,
  escapeHtml,
  fetchRequestDashboardStats,
  fetchRequests,
  formatDate,
  getCurrentAdminUser,
  getSession,
  hasPlaceholderConfig,
  setStatusMessage,
  updateRequest,
} from './request-assisted-common.js?v=20260625-2';

const loginCard = document.getElementById('admin-login-card');
const dashboard = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('admin-login-form');
const feedbackEl = document.getElementById('admin-feedback');
const configWarningEl = document.getElementById('admin-config-warning');
const resultsMessageEl = document.getElementById('admin-results-message');
const selectedRequestEl = document.getElementById('admin-selected-request');
const orderListEl = document.getElementById('admin-order-list');
const volunteerFilterEl = document.getElementById('admin-volunteer-filter');
const searchInputEl = document.getElementById('admin-search');
const userLabelEl = document.getElementById('admin-user-label');
const clearFoundBtn = document.getElementById('admin-clear-found');
const foundCountEl = document.getElementById('admin-found-count');
const topVolunteerEl = document.getElementById('admin-top-volunteer');
const topVolunteerCountEl = document.getElementById('admin-top-volunteer-count');

let currentRequests = [];
let selectedRequestId = null;

function badgeClass(status) {
  return `assist-badge assist-badge-status-${String(status || '').toLowerCase()}`;
}

function statusLabel(status) {
  return String(status || 'NEW').replace(/_/g, ' ');
}

function renderImageCard(label, url) {
  if (!url) return '';
  return `
    <div class="assist-image-card">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} preview" loading="lazy">
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function currentValidationValue(record) {
  if (record.kannada_roll_validated === true) return 'yes';
  if (record.kannada_roll_validated === false) return 'no';
  return '';
}

function renderValidationHint(value) {
  if (value === 'yes') {
    return 'Kannada rolls were checked. Please inform the voter manually.';
  }
  if (value === 'no') {
    return 'Validate once in the Kannada/PDF rolls and inform the voter by calling.';
  }
  return 'Volunteer must answer this before marking a request as found.';
}

function normalizeCodeField(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 4);
}

function hasValidFoundCodes(patch) {
  return [patch.ac_number, patch.part_number, patch.serial_number].every((value) => /^\d{1,4}$/.test(value || ''));
}

function renderRequestDetail(record) {
  const images = [
    renderImageCard('Primary Front', record.primary_front_url),
    renderImageCard('Primary Back', record.primary_back_url),
    renderImageCard('Secondary Front', record.secondary_front_url),
    renderImageCard('Secondary Back', record.secondary_back_url),
    renderImageCard('Old ID Front', record.old_front_url),
    renderImageCard('Old ID Back', record.old_back_url),
    renderImageCard('Neighbor Found Screenshot', record.neighbor_found_screenshot_url),
  ].filter(Boolean).join('');

  return `
    <article class="assist-request" data-request-id="${record.id}">
      <div class="assist-request-header">
        <div>
          <h4>${escapeHtml(record.order_id || 'No Order ID')}</h4>
          <p class="assist-hint">${escapeHtml(record.applicant_name || 'Unknown applicant')} · ${escapeHtml(record.mobile || '—')}</p>
        </div>
        <div class="assist-badges">
          <span class="${badgeClass(record.status)}">${escapeHtml(record.status || 'NEW')}</span>
          <span class="assist-badge">${escapeHtml(formatDate(record.created_at))}</span>
          ${record.result_status ? `<span class="assist-badge">${escapeHtml(record.result_status)}</span>` : ''}
        </div>
      </div>
      <div class="assist-request-body">
        <div class="assist-request-grid">
          <div class="assist-kv">
            <span class="assist-hint">Applicant</span>
            <strong>${escapeHtml(record.applicant_name || '—')}</strong>
            <span>${escapeHtml(record.email || 'No email')}</span>
          </div>
          <div class="assist-kv">
            <span class="assist-hint">Question Responses</span>
            <strong>Old voter ID: ${record.has_old_voter_id ? 'Yes' : 'No'}</strong>
            <span>Knows neighbor: ${record.knows_neighbor ? 'Yes' : 'No'}</span>
            ${record.knows_neighbor ? `<span>Neighbor found in 2002 list: ${record.neighbor_found_in_2002 ? 'Yes' : 'No'}</span>` : ''}
          </div>
          <div class="assist-kv">
            <span class="assist-hint">Primary / Secondary IDs</span>
            <strong>${escapeHtml(record.primary_voter_id || '—')}</strong>
            <span>${escapeHtml(record.secondary_voter_id || 'No secondary ID')}</span>
            ${record.old_voter_id ? `<span>Old ID: ${escapeHtml(record.old_voter_id)}</span>` : ''}
          </div>
          <div class="assist-kv">
            <span class="assist-hint">Neighbor Details</span>
            <strong>${escapeHtml(record.neighbor_name || '—')}</strong>
            <span>${escapeHtml(record.neighbor_voter_id || 'No neighbor voter ID')}</span>
            <span>${escapeHtml(record.neighbor_locality || 'No locality provided')}</span>
            ${record.neighbor_found_in_2002 ? `<span>AC: ${escapeHtml(record.neighbor_ac_number || '—')} · Part: ${escapeHtml(record.neighbor_part_number || '—')} · Serial: ${escapeHtml(record.neighbor_serial_number || '—')}</span>` : ''}
          </div>
          <div class="assist-kv assist-field-full">
            <span class="assist-hint">Uploaded Voter ID Images</span>
            <div class="assist-image-grid">${images || '<div class="assist-empty">No images uploaded</div>'}</div>
          </div>
        </div>

        <div class="assist-section" style="margin-top:16px;">
          <div class="assist-section-title">Assignment</div>
          <div class="assist-field-grid">
            <div class="assist-field">
              <label class="assist-label">Volunteer</label>
              <input class="assist-input" data-role="volunteer" value="${escapeHtml(record.assigned_volunteer || '')}" placeholder="Enter volunteer name">
            </div>
            <div class="assist-field">
              <label class="assist-label">Assigned Date</label>
              <input class="assist-input" value="${escapeHtml(formatDate(record.assigned_date))}" disabled>
            </div>
          </div>
          <div class="assist-actions" style="margin-top:12px;">
            <button class="assist-button-secondary" type="button" data-action="assign">Save Assignment</button>
          </div>
        </div>

        <div class="assist-section" style="margin-top:16px;">
          <div class="assist-section-title">Search Result Entry</div>
          <div class="assist-field-grid">
            <div class="assist-field">
              <label class="assist-label">AC Number</label>
              <input class="assist-input" data-role="ac_number" inputmode="numeric" maxlength="4" pattern="[0-9]{1,4}" value="${escapeHtml(normalizeCodeField(record.ac_number || ''))}">
            </div>
            <div class="assist-field">
              <label class="assist-label">Part Number</label>
              <input class="assist-input" data-role="part_number" inputmode="numeric" maxlength="4" pattern="[0-9]{1,4}" value="${escapeHtml(normalizeCodeField(record.part_number || ''))}">
            </div>
            <div class="assist-field">
              <label class="assist-label">Part Serial Number</label>
              <input class="assist-input" data-role="serial_number" inputmode="numeric" maxlength="4" pattern="[0-9]{1,4}" value="${escapeHtml(normalizeCodeField(record.serial_number || ''))}">
            </div>
            <div class="assist-field assist-field-full">
              <label class="assist-label">Remarks</label>
              <textarea class="assist-textarea" data-role="remarks">${escapeHtml(record.remarks || '')}</textarea>
            </div>
          </div>
          <div class="assist-subsection">
            <div class="assist-section-title">Kannada Roll Validation</div>
            <p class="assist-hint">This answer is mandatory before marking a request as found.</p>
            <div class="assist-choice-row">
              <label class="assist-choice">
                <input type="radio" name="kannada_roll_validated_${record.id}" data-role="kannada_roll_validated" value="yes"${currentValidationValue(record) === 'yes' ? ' checked' : ''}>
                Yes, Kannada electoral rolls were checked
              </label>
              <label class="assist-choice">
                <input type="radio" name="kannada_roll_validated_${record.id}" data-role="kannada_roll_validated" value="no"${currentValidationValue(record) === 'no' ? ' checked' : ''}>
                No, validate once in the PDF rolls and call the voter
              </label>
            </div>
            <div class="assist-inline-note">${escapeHtml(renderValidationHint(currentValidationValue(record)))}</div>
          </div>
          <div class="assist-actions" style="margin-top:12px;">
            <button class="assist-button" type="button" data-action="found"${currentValidationValue(record) ? '' : ' disabled'}>Mark Found</button>
            <button class="assist-button-danger" type="button" data-action="not_found">Mark Not Found</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function getVisibleRecords() {
  return currentRequests.filter((record) => !(record.status === 'COMPLETED' && record.details_cleared_at));
}

function getGroupedRecords() {
  const visible = getVisibleRecords();
  return {
    open: visible.filter((record) => record.status === 'NEW' || record.status === 'ASSIGNED'),
    notFound: visible.filter((record) => record.status === 'NOT_FOUND'),
    completed: visible.filter((record) => record.status === 'COMPLETED'),
  };
}

function renderOrderItems(records) {
  if (!records.length) {
    return '<div class="assist-empty">No requests in this section.</div>';
  }
  return `
    <div class="assist-order-list">
      ${records.map((record) => `
        <button class="assist-order-item${String(record.id) === String(selectedRequestId) ? ' active' : ''}" type="button" data-order-id="${record.id}">
          <strong>${escapeHtml(record.order_id || 'No Order ID')}</strong>
          <span>${escapeHtml(record.applicant_name || 'Unknown applicant')}</span>
          <small class="assist-order-meta">${escapeHtml(record.mobile || '—')} · ${escapeHtml(statusLabel(record.status))}</small>
        </button>
      `).join('')}
    </div>
  `;
}

function renderOrderList(groups) {
  const totalVisible = groups.open.length + groups.notFound.length + groups.completed.length;
  if (!totalVisible) {
    orderListEl.innerHTML = '<div class="assist-empty">No order IDs match the current filters.</div>';
    return;
  }
  orderListEl.innerHTML = `
    <section class="assist-order-group">
      <div class="assist-order-group-title">New Requests (${groups.open.length})</div>
      ${renderOrderItems(groups.open)}
    </section>
    <section class="assist-order-group">
      <div class="assist-order-group-title">Not Found (${groups.notFound.length})</div>
      ${renderOrderItems(groups.notFound)}
    </section>
    <details class="assist-order-group assist-order-group-collapsible">
      <summary class="assist-order-group-title">Found One's (${groups.completed.length})</summary>
      ${renderOrderItems(groups.completed)}
    </details>
  `;
}

function renderRequests() {
  const groups = getGroupedRecords();
  const records = [...groups.open, ...groups.notFound, ...groups.completed];
  if (!records.length) {
    selectedRequestId = null;
    selectedRequestEl.innerHTML = '<div class="assist-empty">No requests match the current filters.</div>';
    renderOrderList(groups);
    return;
  }
  if (!records.some((record) => String(record.id) === String(selectedRequestId))) {
    selectedRequestId = records[0].id;
  }
  const selected = records.find((record) => String(record.id) === String(selectedRequestId)) || records[0];
  selectedRequestId = selected.id;
  selectedRequestEl.innerHTML = renderRequestDetail(selected);
  const selectedCard = selectedRequestEl.querySelector('[data-request-id]');
  if (selectedCard) {
    syncValidationState(selectedCard);
  }
  renderOrderList(groups);
}

async function loadRequests() {
  setStatusMessage(resultsMessageEl, 'info', 'Loading requests...');
  try {
    currentRequests = await fetchRequests({
      volunteer: volunteerFilterEl.value,
      search: searchInputEl.value,
      limit: 500,
    });
    clearStatusMessage(resultsMessageEl);
    await loadSummary();
    renderRequests();
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to load requests.');
  }
}

async function loadSummary() {
  try {
    const stats = await fetchRequestDashboardStats();
    foundCountEl.textContent = String(stats?.total_found_voter_ids || 0);
    topVolunteerEl.textContent = stats?.top_volunteer || '—';
    topVolunteerCountEl.textContent = `${stats?.top_volunteer_found_count || 0} successful searches`;
  } catch (_) {
    foundCountEl.textContent = '—';
    topVolunteerEl.textContent = '—';
    topVolunteerCountEl.textContent = 'Unable to load summary';
  }
}

function readKannadaValidation(card) {
  const selected = card.querySelector('input[data-role="kannada_roll_validated"]:checked');
  if (!selected) return null;
  return selected.value === 'yes';
}

function collectPatch(card) {
  return {
    assigned_volunteer: card.querySelector('[data-role="volunteer"]').value.trim() || null,
    ac_number: normalizeCodeField(card.querySelector('[data-role="ac_number"]').value) || null,
    part_number: normalizeCodeField(card.querySelector('[data-role="part_number"]').value) || null,
    serial_number: normalizeCodeField(card.querySelector('[data-role="serial_number"]').value) || null,
    remarks: card.querySelector('[data-role="remarks"]').value.trim() || null,
    kannada_roll_validated: readKannadaValidation(card),
  };
}

function syncValidationState(card) {
  const foundBtn = card.querySelector('[data-action="found"]');
  const note = card.querySelector('.assist-inline-note');
  const selected = card.querySelector('input[data-role="kannada_roll_validated"]:checked');
  const value = selected ? selected.value : '';
  ['ac_number', 'part_number', 'serial_number'].forEach((role) => {
    const input = card.querySelector(`[data-role="${role}"]`);
    if (!input) return;
    const normalized = normalizeCodeField(input.value);
    if (input.value !== normalized) {
      input.value = normalized;
    }
  });
  const codesValid = hasValidFoundCodes(collectPatch(card));
  if (foundBtn) {
    foundBtn.disabled = !value || !codesValid;
  }
  if (note) {
    if (!codesValid) {
      note.textContent = 'Enter AC Number, Part Number, and Part Serial Number using digits only (1 to 4 digits each).';
    } else {
      note.textContent = renderValidationHint(value);
    }
  }
}

async function handleCardAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const card = event.target.closest('[data-request-id]');
  if (!card) return;
  const id = card.dataset.requestId;
  const basePatch = collectPatch(card);

  try {
    if (button.dataset.action === 'assign') {
      if (!basePatch.assigned_volunteer) {
        throw new Error('Enter a volunteer name before assigning.');
      }
      await updateRequest(id, {
        ...basePatch,
        status: 'ASSIGNED',
        assigned_date: new Date().toISOString(),
      });
      setStatusMessage(resultsMessageEl, 'success', 'Volunteer assignment saved.');
    } else if (button.dataset.action === 'found') {
      if (basePatch.kannada_roll_validated === null) {
        throw new Error('Volunteer must answer the Kannada roll validation question before marking found.');
      }
      if (!hasValidFoundCodes(basePatch)) {
        throw new Error('AC Number, Part Number, and Part Serial Number are required and must contain digits only (up to 4 digits each).');
      }
      await updateRequest(id, {
        ...basePatch,
        status: 'COMPLETED',
        result_status: 'FOUND',
        completed_at: new Date().toISOString(),
      });
      setStatusMessage(resultsMessageEl, 'success', 'Request marked as FOUND.');
    } else if (button.dataset.action === 'not_found') {
      await updateRequest(id, {
        ...basePatch,
        status: 'NOT_FOUND',
        result_status: 'NOT_FOUND',
        completed_at: new Date().toISOString(),
      });
      setStatusMessage(resultsMessageEl, 'success', 'Request marked as NOT FOUND.');
    }
    await loadRequests();
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to update request.');
  }
}

async function handleClearFound() {
  if (!window.confirm("Clear all found request details and keep only the lightweight completed records?")) {
    return;
  }
  try {
    const result = await clearFoundRequests();
    setStatusMessage(resultsMessageEl, 'success', `${result?.cleared_count || 0} found request(s) cleared.`);
    await loadRequests();
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to clear found requests.');
  }
}

async function showDashboard() {
  const user = await getCurrentAdminUser();
  if (!user) {
    loginCard.hidden = false;
    dashboard.hidden = true;
    return;
  }
  loginCard.hidden = true;
  dashboard.hidden = false;
  userLabelEl.textContent = `Signed in as ${user.email || user.id}`;
  await loadRequests();
}

async function handleLogin(event) {
  event.preventDefault();
  clearStatusMessage(feedbackEl);

  if (hasPlaceholderConfig()) {
    setStatusMessage(configWarningEl, 'error', 'Configure Supabase in request-assisted-config.js before using the admin dashboard.');
    return;
  }

  try {
    await adminLogin(loginForm.email.value, loginForm.password.value);
    await showDashboard();
  } catch (err) {
    setStatusMessage(feedbackEl, 'error', err.message || 'Unable to sign in.');
  }
}

function bindFilters() {
  document.getElementById('admin-refresh').addEventListener('click', loadRequests);
  selectedRequestEl.addEventListener('click', handleCardAction);
  selectedRequestEl.addEventListener('change', (event) => {
    const card = event.target.closest('[data-request-id]');
    if (!card) return;
    syncValidationState(card);
  });
  orderListEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-order-id]');
    if (!button) return;
    selectedRequestId = button.dataset.orderId;
    renderRequests();
  });
  clearFoundBtn.addEventListener('click', handleClearFound);
  document.getElementById('admin-signout').addEventListener('click', () => {
    clearSession();
    loginCard.hidden = false;
    dashboard.hidden = true;
    selectedRequestId = null;
    setStatusMessage(feedbackEl, 'success', 'Signed out successfully.');
  });
}

if (hasPlaceholderConfig()) {
  setStatusMessage(configWarningEl, 'error', 'Supabase is not configured yet. Replace the placeholders in request-assisted-config.js.');
}

bindFilters();
loginForm.addEventListener('submit', handleLogin);

if (getSession()) {
  showDashboard();
}
