import {
  boolFromRadio,
  clearStatusMessage,
  createFilePreview,
  createSearchRequest,
  createSubmissionKey,
  ensureRequiredFiles,
  findOpenRequestByMobile,
  hasPlaceholderConfig,
  normalizeDistrict,
  normalizeMobile,
  populateDistrictSelect,
  sanitizeText,
  setStatusMessage,
  uploadFile,
} from './request-assisted-common.js?v=20260704-1';

const form = document.getElementById('assist-request-form');
const statusEl = document.getElementById('assist-status');
const configWarningEl = document.getElementById('assist-config-warning');
const submitBtn = document.getElementById('assist-submit');
const confirmationView = document.getElementById('assist-confirmation');
const formView = document.getElementById('assist-form-view');
const orderIdEl = document.getElementById('assist-order-id');
const neighborLocalityLabel = document.querySelector('label[for="neighbor_locality"]');
const districtSelectEl = document.getElementById('district');

const previewTargets = {
  primary_front: document.getElementById('preview-primary-front'),
  primary_back: document.getElementById('preview-primary-back'),
  secondary_front: document.getElementById('preview-secondary-front'),
  secondary_back: document.getElementById('preview-secondary-back'),
  old_front: document.getElementById('preview-old-front'),
  old_back: document.getElementById('preview-old-back'),
  neighbor_found_screenshot: document.getElementById('preview-neighbor-found-screenshot'),
};

function setPreview(input) {
  const target = previewTargets[input.name];
  if (!target) return;
  const file = input.files && input.files[0];
  if (!file) {
    target.innerHTML = '<span class="assist-hint">No image selected</span>';
    return;
  }
  const url = createFilePreview(file);
  target.innerHTML = `<img src="${url}" alt="${file.name.replace(/"/g, '&quot;')}">`;
}

function toggleConditionalSections() {
  const hasOld = form.elements.has_old_voter_id.value === 'yes';
  const knowsNeighbor = form.elements.knows_neighbor.value === 'yes';
  const neighborFound = knowsNeighbor && form.elements.neighbor_found_in_2002.value === 'yes';
  document.getElementById('old-voter-fields').hidden = !hasOld;
  document.getElementById('neighbor-fields').hidden = !knowsNeighbor;
  document.getElementById('neighbor-found-fields').hidden = !neighborFound;
  if (neighborLocalityLabel) {
    neighborLocalityLabel.textContent = knowsNeighbor
      ? 'Area / Locality and (if known) AC Number, Part Number, Part Serial Number'
      : 'Area / Locality';
  }
}

function showConfirmation(orderId) {
  clearStatusMessage(statusEl);
  formView.hidden = true;
  confirmationView.hidden = false;
  orderIdEl.textContent = orderId;
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const submitted = params.get('submitted');
  const orderId = params.get('order');
  if (submitted === '1' && orderId) {
    showConfirmation(orderId);
  }
}

async function uploadOptionalFile(file, submissionKey, slotName) {
  if (!file) return null;
  return uploadFile(file, submissionKey, slotName);
}

async function handleSubmit(event) {
  event.preventDefault();
  clearStatusMessage(statusEl);

  if (hasPlaceholderConfig()) {
    setStatusMessage(configWarningEl, 'error', 'Configure Supabase in request-assisted-config.js before using this form.');
    return;
  }

  const applicantName = sanitizeText(form.applicant_name.value);
  const mobile = normalizeMobile(form.mobile.value);
  const district = normalizeDistrict(form.district.value);
  const houseAddress2002 = sanitizeText(form.house_address_2002.value);
  const primaryVoterId = sanitizeText(form.primary_voter_id.value);
  const secondaryVoterId = sanitizeText(form.secondary_voter_id.value);
  const oldVoterId = sanitizeText(form.old_voter_id.value);
  const neighborName = sanitizeText(form.neighbor_name.value);
  const neighborLocality = sanitizeText(form.neighbor_locality.value);
  const neighborVoterId = sanitizeText(form.neighbor_voter_id.value);
  const neighborAcNumber = sanitizeText(form.neighbor_ac_number.value);
  const neighborPartNumber = sanitizeText(form.neighbor_part_number.value);
  const neighborSerialNumber = sanitizeText(form.neighbor_serial_number.value);
  const hasOldVoterId = boolFromRadio(form.elements.has_old_voter_id.value);
  const knowsNeighbor = boolFromRadio(form.elements.knows_neighbor.value);
  const neighborFoundIn2002 = knowsNeighbor ? boolFromRadio(form.elements.neighbor_found_in_2002.value) : null;
  const declarationAccepted = form.declaration.checked;

  if (!applicantName || mobile.length !== 10 || !district || !houseAddress2002 || !primaryVoterId) {
    setStatusMessage(statusEl, 'error', 'Applicant name, 10-digit mobile number, district, 2002 house address, and primary voter ID are required.');
    return;
  }
  if (!declarationAccepted) {
    setStatusMessage(statusEl, 'error', 'Please accept the declaration before submitting.');
    return;
  }

  submitBtn.disabled = true;
  setStatusMessage(statusEl, 'info', 'Checking if you already have an open ticket for this mobile number...');
  try {
    const existingResponse = await findOpenRequestByMobile(mobile);
    const existing = Array.isArray(existingResponse) ? existingResponse[0] : existingResponse;
    if (existing && existing.order_id) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('submitted', '1');
      nextUrl.searchParams.set('order', existing.order_id);
      window.history.replaceState({}, '', nextUrl.toString());
      showConfirmation(existing.order_id);
      return;
    }
  } catch (_) {
  } finally {
    submitBtn.disabled = false;
  }

  const primaryFront = form.primary_front.files[0];
  const primaryBack = form.primary_back.files[0];
  const neighborFoundScreenshot = knowsNeighbor && neighborFoundIn2002
    ? form.neighbor_found_screenshot.files[0]
    : null;
  try {
    ensureRequiredFiles([
      [primaryFront, 'Primary voter ID front image'],
      [primaryBack, 'Primary voter ID back image'],
    ]);
    if (knowsNeighbor && neighborFoundIn2002) {
      ensureRequiredFiles([
        [neighborFoundScreenshot, 'Neighbor found PDF screenshot'],
      ]);
    }
  } catch (err) {
    setStatusMessage(statusEl, 'error', err.message);
    return;
  }

  const submissionKey = createSubmissionKey();
  submitBtn.disabled = true;
  setStatusMessage(statusEl, 'info', 'Uploading images and creating your request. Please wait...');

  try {
    const primaryFrontUrl = await uploadFile(primaryFront, submissionKey, 'primary-front');
    const primaryBackUrl = await uploadFile(primaryBack, submissionKey, 'primary-back');
    const secondaryFrontUrl = await uploadOptionalFile(form.secondary_front.files[0], submissionKey, 'secondary-front');
    const secondaryBackUrl = await uploadOptionalFile(form.secondary_back.files[0], submissionKey, 'secondary-back');
    const oldFrontUrl = hasOldVoterId ? await uploadOptionalFile(form.old_front.files[0], submissionKey, 'old-front') : null;
    const oldBackUrl = hasOldVoterId ? await uploadOptionalFile(form.old_back.files[0], submissionKey, 'old-back') : null;
    const neighborFoundScreenshotUrl = neighborFoundScreenshot
      ? await uploadOptionalFile(neighborFoundScreenshot, submissionKey, 'neighbor-found-screenshot')
      : null;

    const response = await createSearchRequest({
      applicant_name: applicantName,
      mobile,
      district,
      house_address_2002: houseAddress2002,
      primary_voter_id: primaryVoterId,
      secondary_voter_id: secondaryVoterId || null,
      old_voter_id: hasOldVoterId ? (oldVoterId || null) : null,
      has_old_voter_id: hasOldVoterId,
      knows_neighbor: knowsNeighbor,
      neighbor_found_in_2002: neighborFoundIn2002,
      neighbor_name: knowsNeighbor ? (neighborName || null) : null,
      neighbor_locality: knowsNeighbor ? (neighborLocality || null) : null,
      neighbor_voter_id: knowsNeighbor ? (neighborVoterId || null) : null,
      neighbor_ac_number: knowsNeighbor && neighborFoundIn2002 ? (neighborAcNumber || null) : null,
      neighbor_part_number: knowsNeighbor && neighborFoundIn2002 ? (neighborPartNumber || null) : null,
      neighbor_serial_number: knowsNeighbor && neighborFoundIn2002 ? (neighborSerialNumber || null) : null,
      neighbor_found_screenshot_url: knowsNeighbor && neighborFoundIn2002 ? neighborFoundScreenshotUrl : null,
      declaration_accepted: declarationAccepted,
      primary_front_url: primaryFrontUrl,
      primary_back_url: primaryBackUrl,
      secondary_front_url: secondaryFrontUrl,
      secondary_back_url: secondaryBackUrl,
      old_front_url: oldFrontUrl,
      old_back_url: oldBackUrl,
      submission_key: submissionKey,
    });

    const orderId = response && (response.order_id || response.orderId || (Array.isArray(response) && response[0] && response[0].order_id));
    if (!orderId) {
      throw new Error('Request created, but no Ticket ID was returned by the server.');
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('submitted', '1');
    nextUrl.searchParams.set('order', orderId);
    window.history.replaceState({}, '', nextUrl.toString());
    showConfirmation(orderId);
  } catch (err) {
    setStatusMessage(statusEl, 'error', err.message || 'Unable to submit the request right now.');
  } finally {
    submitBtn.disabled = false;
  }
}

Object.keys(previewTargets).forEach((name) => {
  const input = form.elements[name];
  if (input) {
    input.addEventListener('change', () => setPreview(input));
  }
});

Array.from(form.querySelectorAll('input[name="has_old_voter_id"]')).forEach((el) => {
  el.addEventListener('change', toggleConditionalSections);
});
Array.from(form.querySelectorAll('input[name="knows_neighbor"]')).forEach((el) => {
  el.addEventListener('change', toggleConditionalSections);
});
Array.from(form.querySelectorAll('input[name="neighbor_found_in_2002"]')).forEach((el) => {
  el.addEventListener('change', toggleConditionalSections);
});

if (hasPlaceholderConfig()) {
  setStatusMessage(configWarningEl, 'error', 'Supabase is not configured yet. Replace the placeholders in request-assisted-config.js.');
}

populateDistrictSelect(districtSelectEl);
toggleConditionalSections();
hydrateFromQuery();
form.addEventListener('submit', handleSubmit);
