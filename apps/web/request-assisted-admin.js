import {
  adminLogin,
  clearSession,
  clearStatusMessage,
  escapeHtml,
  fetchRequests,
  formatDate,
  getCurrentAdminUser,
  getSession,
  hasPlaceholderConfig,
  setStatusMessage,
  updateRequest,
} from './request-assisted-common.js';

const loginCard = document.getElementById('admin-login-card');
const dashboard = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('admin-login-form');
const feedbackEl = document.getElementById('admin-feedback');
const configWarningEl = document.getElementById('admin-config-warning');
const resultsMessageEl = document.getElementById('admin-results-message');
const selectedRequestEl = document.getElementById('admin-selected-request');
const orderListEl = document.getElementById('admin-order-list');
const statusFilterEl = document.getElementById('admin-status-filter');
const volunteerFilterEl = document.getElementById('admin-volunteer-filter');
const searchInputEl = document.getElementById('admin-search');
const userLabelEl = document.getElementById('admin-user-label');

let activeTab = 'ALL';
let currentRequests = [];
let selectedRequestId = null;

function badgeClass(status) {
  return `assist-badge assist-badge-status-${String(status || '').toLowerCase()}`;
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
              <input class="assist-input" data-role="ac_number" value="${escapeHtml(record.ac_number || '')}">
            </div>
            <div class="assist-field">
              <label class="assist-label">Part Number</label>
              <input class="assist-input" data-role="part_number" value="${escapeHtml(record.part_number || '')}">
            </div>
            <div class="assist-field">
              <label class="assist-label">Serial Number</label>
              <input class="assist-input" data-role="serial_number" value="${escapeHtml(record.serial_number || '')}">
            </div>
            <div class="assist-field assist-field-full">
              <label class="assist-label">Remarks</label>
              <textarea class="assist-textarea" data-role="remarks">${escapeHtml(record.remarks || '')}</textarea>
            </div>
          </div>
          <div class="assist-actions" style="margin-top:12px;">
            <button class="assist-button" type="button" data-action="found">Mark Found</button>
            <button class="assist-button-danger" type="button" data-action="not_found">Mark Not Found</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function filteredRequests() {
  return currentRequests.filter((record) => {
    if (activeTab !== 'ALL' && record.status !== activeTab) {
      return false;
    }
    return true;
  });
}

function renderOrderList(records) {
  if (!records.length) {
    orderListEl.innerHTML = '<div class="assist-empty">No order IDs match the current filters.</div>';
    return;
  }
  orderListEl.innerHTML = records.map((record) => `
    <button class="assist-order-item${String(record.id) === String(selectedRequestId) ? ' active' : ''}" type="button" data-order-id="${record.id}">
      <strong>${escapeHtml(record.order_id || 'No Order ID')}</strong>
      <span>${escapeHtml(record.applicant_name || 'Unknown applicant')}</span>
      <small>${escapeHtml(record.mobile || '—')} · ${escapeHtml(record.status || 'NEW')}</small>
    </button>
  `).join('');
}

function renderRequests() {
  const records = filteredRequests();
  if (!records.length) {
    selectedRequestId = null;
    selectedRequestEl.innerHTML = '<div class="assist-empty">No requests match the current filters.</div>';
    renderOrderList(records);
    return;
  }
  if (!records.some((record) => String(record.id) === String(selectedRequestId))) {
    selectedRequestId = records[0].id;
  }
  const selected = records.find((record) => String(record.id) === String(selectedRequestId)) || records[0];
  selectedRequestId = selected.id;
  selectedRequestEl.innerHTML = renderRequestDetail(selected);
  renderOrderList(records);
}

async function loadRequests() {
  setStatusMessage(resultsMessageEl, 'info', 'Loading requests...');
  try {
    currentRequests = await fetchRequests({
      status: statusFilterEl.value,
      volunteer: volunteerFilterEl.value,
      search: searchInputEl.value,
    });
    clearStatusMessage(resultsMessageEl);
    renderRequests();
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to load requests.');
  }
}

function collectPatch(card) {
  return {
    assigned_volunteer: card.querySelector('[data-role="volunteer"]').value.trim() || null,
    ac_number: card.querySelector('[data-role="ac_number"]').value.trim() || null,
    part_number: card.querySelector('[data-role="part_number"]').value.trim() || null,
    serial_number: card.querySelector('[data-role="serial_number"]').value.trim() || null,
    remarks: card.querySelector('[data-role="remarks"]').value.trim() || null,
  };
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

function bindTabs() {
  document.getElementById('admin-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.assist-tab').forEach((node) => {
      node.classList.toggle('active', node === tab);
    });
    renderRequests();
  });
}

function bindFilters() {
  document.getElementById('admin-refresh').addEventListener('click', loadRequests);
  selectedRequestEl.addEventListener('click', handleCardAction);
  orderListEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-order-id]');
    if (!button) return;
    selectedRequestId = button.dataset.orderId;
    renderRequests();
  });
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

bindTabs();
bindFilters();
loginForm.addEventListener('submit', handleLogin);

if (getSession()) {
  showDashboard();
}
