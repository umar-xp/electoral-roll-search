import {
  clearStatusMessage,
  escapeHtml,
  fetchPublicRequestDetail,
  fetchPublicRequests,
  formatDate,
  hasPlaceholderConfig,
  publicUpdateRequest,
  setStatusMessage,
} from './request-assisted-common.js?v=20260703-5';

const configWarningEl = document.getElementById('admin-config-warning');
const resultsMessageEl = document.getElementById('admin-results-message');
const searchInputEl = document.getElementById('admin-search');
const refreshBtn = document.getElementById('admin-refresh');
const tableNewEl = document.getElementById('admin-table-new');
const tableFoundEl = document.getElementById('admin-table-found');
const tableNotFoundEl = document.getElementById('admin-table-notfound');
const modalEl = document.getElementById('admin-modal');
const modalTitleEl = document.getElementById('admin-modal-title');
const modalSubtitleEl = document.getElementById('admin-modal-subtitle');
const modalBodyEl = document.getElementById('admin-modal-body');

let allRows = [];
let openTicketId = null;

function normalizeCodeField(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 4);
}

function currentValidationValue(record) {
  if (record.kannada_roll_validated === true) return 'yes';
  if (record.kannada_roll_validated === false) return 'no';
  return '';
}

function renderEmptyRow() {
  return '<tr><td colspan="3" class="assist-empty">No requests</td></tr>';
}

function recordMatches(record, query) {
  if (!query) return true;
  const hay = [
    record.order_id,
    record.primary_voter_id,
    record.applicant_name,
    record.assigned_volunteer,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return hay.includes(query);
}

function groupRecords(rows) {
  const query = String(searchInputEl.value || '').trim().toLowerCase();
  const filtered = rows.filter((r) => recordMatches(r, query));
  return {
    new: filtered.filter((r) => r.status === 'NEW' || r.status === 'ASSIGNED'),
    found: filtered.filter((r) => r.status === 'COMPLETED' && String(r.result_status || '').toUpperCase() === 'FOUND'),
    notFound: filtered.filter((r) => r.status === 'NOT_FOUND'),
  };
}

function renderTable(tbody, records) {
  if (!records.length) {
    tbody.innerHTML = renderEmptyRow();
    return;
  }
  tbody.innerHTML = records.map((record) => `
    <tr class="assist-row" data-ticket-id="${escapeHtml(record.order_id || '')}">
      <td>${escapeHtml(record.primary_voter_id || '—')}</td>
      <td>${escapeHtml(record.applicant_name || '—')}</td>
      <td>${escapeHtml(record.assigned_volunteer || '—')}</td>
    </tr>
  `).join('');
}

function openModal(ticketId) {
  openTicketId = ticketId;
  modalEl.style.display = 'grid';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalEl.style.display = 'none';
  modalTitleEl.textContent = '';
  modalSubtitleEl.textContent = '';
  modalBodyEl.innerHTML = '';
  openTicketId = null;
  document.body.style.overflow = '';
}

function ensureImageViewer() {
  let viewer = document.getElementById('admin-image-viewer');
  if (viewer) return viewer;
  viewer = document.createElement('div');
  viewer.id = 'admin-image-viewer';
  viewer.className = 'assist-modal';
  viewer.hidden = true;
  viewer.innerHTML = `
    <div class="assist-modal-backdrop" data-action="close-image"></div>
    <div class="assist-modal-card assist-modal-image">
      <img id="admin-image-viewer-img" alt="Uploaded image preview">
      <div class="assist-actions" style="justify-content:center;margin-top:12px;">
        <button class="assist-button-muted" type="button" data-action="close-image">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(viewer);
  viewer.addEventListener('click', (event) => {
    const action = event.target && event.target.dataset ? event.target.dataset.action : '';
    if (action === 'close-image') {
      viewer.hidden = true;
      document.body.style.overflow = '';
    }
  });
  return viewer;
}

function showImage(url) {
  if (!url) return;
  const viewer = ensureImageViewer();
  const img = document.getElementById('admin-image-viewer-img');
  img.src = url;
  viewer.hidden = false;
  document.body.style.overflow = 'hidden';
}

function renderImageButton(label, url) {
  if (!url) return '';
  return `
    <button type="button" class="assist-image-card" data-image-url="${escapeHtml(url)}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} preview" loading="lazy">
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderValidationHint(value) {
  if (value === 'yes') return 'Kannada rolls were checked. Please inform the voter manually.';
  if (value === 'no') return 'Validate once in the Kannada/PDF rolls and inform the voter by calling.';
  return 'Volunteer must answer this before marking a request as found.';
}

function hasValidFoundCodes(patch) {
  return [patch.ac_number, patch.part_number, patch.serial_number].every((value) => /^\d{1,4}$/.test(value || ''));
}

function collectPatch() {
  return {
    assigned_volunteer: (modalBodyEl.querySelector('[data-role="volunteer"]')?.value || '').trim() || null,
    ac_number: normalizeCodeField(modalBodyEl.querySelector('[data-role="ac_number"]')?.value) || null,
    part_number: normalizeCodeField(modalBodyEl.querySelector('[data-role="part_number"]')?.value) || null,
    serial_number: normalizeCodeField(modalBodyEl.querySelector('[data-role="serial_number"]')?.value) || null,
    remarks: (modalBodyEl.querySelector('[data-role="remarks"]')?.value || '').trim() || null,
    kannada_roll_validated: (() => {
      const selected = modalBodyEl.querySelector('input[data-role="kannada_roll_validated"]:checked');
      if (!selected) return null;
      return selected.value === 'yes';
    })(),
  };
}

function syncValidationState() {
  ['ac_number', 'part_number', 'serial_number'].forEach((role) => {
    const input = modalBodyEl.querySelector(`[data-role="${role}"]`);
    if (!input) return;
    const normalized = normalizeCodeField(input.value);
    if (input.value !== normalized) {
      input.value = normalized;
    }
  });
  const selected = modalBodyEl.querySelector('input[data-role="kannada_roll_validated"]:checked');
  const value = selected ? selected.value : '';
  const patch = collectPatch();
  const foundBtn = modalBodyEl.querySelector('[data-action="found"]');
  const note = modalBodyEl.querySelector('.assist-inline-note');
  const codesValid = hasValidFoundCodes(patch);
  if (foundBtn) foundBtn.disabled = !value || !codesValid;
  if (note) {
    note.textContent = codesValid ? renderValidationHint(value) : 'Enter AC Number, Part Number, and Part Serial Number using digits only (1 to 4 digits each).';
  }
}

function renderDetail(record) {
  const images = [
    renderImageButton('Primary Front', record.primary_front_url),
    renderImageButton('Primary Back', record.primary_back_url),
    renderImageButton('Secondary Front', record.secondary_front_url),
    renderImageButton('Secondary Back', record.secondary_back_url),
    renderImageButton('Old ID Front', record.old_front_url),
    renderImageButton('Old ID Back', record.old_back_url),
    renderImageButton('Neighbor Found Screenshot', record.neighbor_found_screenshot_url),
  ].filter(Boolean).join('');

  const validationValue = currentValidationValue(record);

  modalTitleEl.textContent = `Ticket ID: ${record.order_id || ''}`;
  modalSubtitleEl.textContent = `${record.applicant_name || '—'} · ${record.mobile || '—'} · ${formatDate(record.created_at)}`;

  modalBodyEl.innerHTML = `
    <div class="assist-request-grid">
      <div class="assist-kv">
        <span class="assist-hint">Primary Voter ID</span>
        <strong>${escapeHtml(record.primary_voter_id || '—')}</strong>
        <span>${escapeHtml(record.secondary_voter_id || 'No secondary ID')}</span>
      </div>
      <div class="assist-kv">
        <span class="assist-hint">Neighbor</span>
        <strong>${escapeHtml(record.knows_neighbor ? 'Yes' : 'No')}</strong>
        <span>${escapeHtml(record.neighbor_name || '—')}</span>
        <span>${escapeHtml(record.neighbor_locality || '—')}</span>
      </div>
      <div class="assist-kv assist-field-full">
        <span class="assist-hint">Uploaded Images (tap to enlarge)</span>
        <div class="assist-image-grid">${images || '<div class="assist-empty">No images uploaded</div>'}</div>
      </div>
    </div>

    <div class="assist-section" style="margin-top:16px;">
      <div class="assist-section-title">Assignment</div>
      <div class="assist-field-grid">
        <div class="assist-field">
          <label class="assist-label">Volunteer (Name + optional mobile)</label>
          <input class="assist-input" data-role="volunteer" value="${escapeHtml(record.assigned_volunteer || '')}" placeholder="Example: Ramesh 99xxxxxx01">
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
            <input type="radio" name="kannada_roll_validated_modal" data-role="kannada_roll_validated" value="yes"${validationValue === 'yes' ? ' checked' : ''}>
            Yes, Kannada electoral rolls were checked
          </label>
          <label class="assist-choice">
            <input type="radio" name="kannada_roll_validated_modal" data-role="kannada_roll_validated" value="no"${validationValue === 'no' ? ' checked' : ''}>
            No, validate once in the PDF rolls and call the voter
          </label>
        </div>
        <div class="assist-inline-note">${escapeHtml(renderValidationHint(validationValue))}</div>
      </div>
      <div class="assist-actions" style="margin-top:12px;">
        <button class="assist-button" type="button" data-action="found"${validationValue ? '' : ' disabled'}>Mark Found</button>
        <button class="assist-button-danger" type="button" data-action="not_found">Mark Not Found</button>
      </div>
    </div>
  `;

  syncValidationState();
}

async function loadDetail(ticketId) {
  setStatusMessage(resultsMessageEl, 'info', 'Loading ticket...');
  try {
    const response = await fetchPublicRequestDetail(ticketId);
    const record = Array.isArray(response) ? response[0] : response;
    if (!record) throw new Error('Ticket not found.');
    clearStatusMessage(resultsMessageEl);
    renderDetail(record);
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to load ticket.');
  }
}

async function refreshTables() {
  setStatusMessage(resultsMessageEl, 'info', 'Loading requests...');
  try {
    const response = await fetchPublicRequests();
    allRows = Array.isArray(response) ? response : [];
    clearStatusMessage(resultsMessageEl);
    const groups = groupRecords(allRows);
    renderTable(tableNewEl, groups.new);
    renderTable(tableFoundEl, groups.found);
    renderTable(tableNotFoundEl, groups.notFound);
  } catch (err) {
    setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to load requests.');
  }
}

async function handleUpdate(action) {
  if (!openTicketId) return;
  const patch = collectPatch();
  if (action === 'ASSIGN') {
    if (!patch.assigned_volunteer) {
      throw new Error('Enter a volunteer name before assigning.');
    }
  }
  if (action === 'FOUND') {
    if (patch.kannada_roll_validated === null) {
      throw new Error('Volunteer must answer the Kannada roll validation question before marking found.');
    }
    if (!hasValidFoundCodes(patch)) {
      throw new Error('AC Number, Part Number, and Part Serial Number are required and must contain digits only (up to 4 digits each).');
    }
  }

  setStatusMessage(resultsMessageEl, 'info', 'Saving update...');
  const payload = {
    p_order_id: openTicketId,
    p_action: action,
    p_assigned_volunteer: patch.assigned_volunteer,
    p_ac_number: patch.ac_number,
    p_part_number: patch.part_number,
    p_serial_number: patch.serial_number,
    p_remarks: patch.remarks,
    p_kannada_roll_validated: patch.kannada_roll_validated,
  };
  const response = await publicUpdateRequest(payload);
  const record = Array.isArray(response) ? response[0] : response;
  clearStatusMessage(resultsMessageEl);
  setStatusMessage(resultsMessageEl, 'success', `Saved: ${record?.status || action}`);
  await refreshTables();
  await loadDetail(openTicketId);
}

function findTicketIdFromEvent(event) {
  const row = event.target.closest('tr[data-ticket-id]');
  if (!row) return null;
  return row.dataset.ticketId || null;
}

function bindEvents() {
  refreshBtn.addEventListener('click', refreshTables);
  searchInputEl.addEventListener('input', () => {
    const groups = groupRecords(allRows);
    renderTable(tableNewEl, groups.new);
    renderTable(tableFoundEl, groups.found);
    renderTable(tableNotFoundEl, groups.notFound);
  });

  [tableNewEl, tableFoundEl, tableNotFoundEl].forEach((tbody) => {
    tbody.addEventListener('click', async (event) => {
      const ticketId = findTicketIdFromEvent(event);
      if (!ticketId) return;
      openModal(ticketId);
      await loadDetail(ticketId);
    });
  });

  modalEl.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action="close"]')) {
      closeModal();
      return;
    }
    const imageBtn = event.target.closest('[data-image-url]');
    if (imageBtn && imageBtn.dataset && imageBtn.dataset.imageUrl) {
      showImage(imageBtn.dataset.imageUrl);
      return;
    }
    const btn = event.target.closest('[data-action="assign"],[data-action="found"],[data-action="not_found"]');
    if (!btn) return;
    try {
      if (btn.dataset.action === 'assign') {
        await handleUpdate('ASSIGN');
      } else if (btn.dataset.action === 'found') {
        await handleUpdate('FOUND');
      } else if (btn.dataset.action === 'not_found') {
        await handleUpdate('NOT_FOUND');
      }
    } catch (err) {
      setStatusMessage(resultsMessageEl, 'error', err.message || 'Unable to update request.');
    }
  });

  modalEl.addEventListener('change', (event) => {
    if (event.target && event.target.matches('input[data-role="kannada_roll_validated"], input[data-role="ac_number"], input[data-role="part_number"], input[data-role="serial_number"]')) {
      syncValidationState();
    }
  });
}

if (hasPlaceholderConfig()) {
  setStatusMessage(configWarningEl, 'error', 'Supabase is not configured yet. Replace the placeholders in request-assisted-config.js.');
}

closeModal();
bindEvents();
refreshTables();
