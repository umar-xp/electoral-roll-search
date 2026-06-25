import {
  boolFromRadio,
  clearStatusMessage,
  createFilePreview,
  createSearchRequest,
  createSubmissionKey,
  ensureRequiredFiles,
  hasPlaceholderConfig,
  isValidEmail,
  normalizeMobile,
  sanitizeText,
  setStatusMessage,
  uploadFile,
} from './request-assisted-common.js?v=20260625-3';

const form = document.getElementById('assist-request-form');
const statusEl = document.getElementById('assist-status');
const configWarningEl = document.getElementById('assist-config-warning');
const submitBtn = document.getElementById('assist-submit');
const confirmationView = document.getElementById('assist-confirmation');
const formView = document.getElementById('assist-form-view');
const orderIdEl = document.getElementById('assist-order-id');

// #region debug-point B:form-module-loaded
function reportRequestAssistFormDebug(hypothesisId, location, msg, data) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'request-assist-submit',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
reportRequestAssistFormDebug('B', 'request-assisted-form.js:23', 'form module loaded', {
  href: window.location.href,
});
// #endregion

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
  const email = sanitizeText(form.email.value);
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

  // #region debug-point B:submit-input-state
  reportRequestAssistFormDebug('B', 'request-assisted-form.js:118', 'submit started', {
    applicantNamePresent: !!applicantName,
    mobileLength: mobile.length,
    primaryVoterIdPresent: !!primaryVoterId,
    hasOldVoterId,
    knowsNeighbor,
    neighborFoundIn2002,
  });
  // #endregion

  if (!applicantName || mobile.length !== 10 || !primaryVoterId) {
    setStatusMessage(statusEl, 'error', 'Applicant name, 10-digit mobile number, and primary voter ID are required.');
    return;
  }
  if (!isValidEmail(email)) {
    setStatusMessage(statusEl, 'error', 'Please enter a valid email address or leave it blank.');
    return;
  }
  if (!declarationAccepted) {
    setStatusMessage(statusEl, 'error', 'Please accept the declaration before submitting.');
    return;
  }

  const primaryFront = form.primary_front.files[0];
  const primaryBack = form.primary_back.files[0];
  const neighborFoundScreenshot = knowsNeighbor && neighborFoundIn2002
    ? form.neighbor_found_screenshot.files[0]
    : null;
  // #region debug-point B:submit-file-state
  reportRequestAssistFormDebug('B', 'request-assisted-form.js:140', 'submit file snapshot', {
    primaryFrontPresent: !!primaryFront,
    primaryBackPresent: !!primaryBack,
    secondaryFrontPresent: !!(form.secondary_front.files && form.secondary_front.files[0]),
    secondaryBackPresent: !!(form.secondary_back.files && form.secondary_back.files[0]),
    oldFrontPresent: !!(form.old_front.files && form.old_front.files[0]),
    oldBackPresent: !!(form.old_back.files && form.old_back.files[0]),
    neighborFoundScreenshotPresent: !!neighborFoundScreenshot,
  });
  // #endregion
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
      email: email || null,
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
      throw new Error('Request created, but no order ID was returned by the server.');
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

toggleConditionalSections();
hydrateFromQuery();
form.addEventListener('submit', handleSubmit);
