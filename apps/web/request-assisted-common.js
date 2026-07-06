const CONFIG = window.REQUEST_ASSISTED_CONFIG || {};
const SESSION_KEY = 'vsr-admin-session';
export const KARNATAKA_DISTRICTS = Object.freeze([
  'Bagalkot',
  'Ballari',
  'Belagavi',
  'Bengaluru Rural',
  'Bengaluru Urban',
  'Bidar',
  'Chamarajanagar',
  'Chikkaballapur',
  'Chikkamagaluru',
  'Chitradurga',
  'Dakshina Kannada',
  'Davanagere',
  'Dharwad',
  'Gadag',
  'Hassan',
  'Haveri',
  'Kalaburagi',
  'Kodagu',
  'Kolar',
  'Koppal',
  'Mandya',
  'Mysuru',
  'Raichur',
  'Ramanagara',
  'Shivamogga',
  'Tumakuru',
  'Udupi',
  'Uttara Kannada',
  'Vijayapura',
  'Yadgir',
]);

function requiredConfigValue(key) {
  const value = CONFIG[key];
  if (!value) {
    throw new Error(`Missing Request Assisted Search config: ${key}`);
  }
  return value;
}

export function getConfig() {
  return {
    supabaseUrl: requiredConfigValue('supabaseUrl').replace(/\/+$/, ''),
    supabaseAnonKey: requiredConfigValue('supabaseAnonKey'),
    storageBucket: requiredConfigValue('storageBucket'),
    orderPrefix: CONFIG.orderPrefix || 'VSR',
    volunteerOptions: Array.isArray(CONFIG.volunteerOptions) ? CONFIG.volunteerOptions : [],
    siteName: CONFIG.siteName || 'Karnataka 2002 Voter List Search',
  };
}

export function hasPlaceholderConfig() {
  try {
    const cfg = getConfig();
    return cfg.supabaseUrl.includes('YOUR_PROJECT_ID') || cfg.supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY');
  } catch (_) {
    return true;
  }
}

export function normalizeMobile(input) {
  return String(input || '').replace(/\D+/g, '').slice(-10);
}

export function sanitizeText(input) {
  return String(input || '').trim();
}

export function normalizeDistrict(input) {
  return sanitizeText(input);
}

export function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createSubmissionKey() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `vsr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFilePreview(file) {
  return file ? URL.createObjectURL(file) : '';
}

export function populateDistrictSelect(selectEl, { includeAll = false, allLabel = 'All districts' } = {}) {
  if (!selectEl) return;
  const current = selectEl.value;
  const options = [];
  if (includeAll) {
    options.push('<option value="">All districts</option>');
  } else {
    options.push('<option value="">Select district</option>');
  }
  KARNATAKA_DISTRICTS.forEach((district) => {
    const selected = district === current ? ' selected' : '';
    options.push(`<option value="${escapeHtml(district)}"${selected}>${escapeHtml(district)}</option>`);
  });
  selectEl.innerHTML = options.join('');
  if (!current && includeAll) {
    selectEl.value = '';
  } else if (current) {
    selectEl.value = current;
  }
}

export function publicStorageUrl(objectPath) {
  const cfg = getConfig();
  return `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.storageBucket}/${encodeURI(objectPath)}`;
}

function buildHeaders({ authToken, json } = {}) {
  const cfg = getConfig();
  const headers = {
    apikey: cfg.supabaseAnonKey,
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else {
    headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
  }
  if (json) {
    headers['Content-Type'] = 'application/json';
    headers.Accept = 'application/json';
  }
  return headers;
}

async function parseErrorResponse(response) {
  let message = `Request failed (${response.status})`;
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      message = data.message || data.error_description || data.error || data.msg || message;
    } else {
      const text = await response.text();
      if (text) message = text;
    }
  } catch (_) {
    // Keep fallback message.
  }
  throw new Error(message);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    await parseErrorResponse(response);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function uploadFile(file, submissionKey, slotName) {
  const cfg = getConfig();
  const safeName = String(file.name || slotName)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const objectPath = `request-assisted/${submissionKey}/${slotName}-${safeName || 'upload'}`;
  const uploadUrl = `${cfg.supabaseUrl}/storage/v1/object/${cfg.storageBucket}/${encodeURIComponent(objectPath)}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...buildHeaders(),
      'x-upsert': 'false',
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!response.ok) {
    await parseErrorResponse(response);
  }
  return publicStorageUrl(objectPath);
}

export async function callRpc(name, body, authToken) {
  const cfg = getConfig();
  return fetchJson(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: buildHeaders({ authToken, json: true }),
    body: JSON.stringify(body || {}),
  });
}

export async function createSearchRequest(payload) {
  return callRpc('public_create_search_request', payload);
}

export async function lookupRequestStatus(orderId, mobile) {
  return callRpc('public_get_search_request_status', {
    p_order_id: sanitizeText(orderId).toUpperCase(),
    p_mobile: normalizeMobile(mobile),
  });
}

export async function findOpenRequestByMobile(mobile) {
  return callRpc('public_find_open_request_by_mobile', {
    p_mobile: normalizeMobile(mobile),
  });
}

export async function fetchPublicRequests() {
  return callRpc('public_list_search_requests', {});
}

export async function fetchPublicRequestDetail(orderId) {
  return callRpc('public_get_search_request_detail', {
    p_order_id: sanitizeText(orderId).toUpperCase(),
  });
}

export async function publicUpdateRequest(payload) {
  return callRpc('public_update_search_request', payload);
}

export async function adminLogin(email, password) {
  const cfg = getConfig();
  const response = await fetchJson(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ json: true }),
    },
    body: JSON.stringify({
      email: sanitizeText(email),
      password: String(password || ''),
    }),
  });
  persistSession(response);
  return response;
}

export function persistSession(session) {
  const stored = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user: session.user || null,
    expires_at: session.expires_at || null,
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  return stored;
}

export function getSession() {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export async function getCurrentAdminUser() {
  const cfg = getConfig();
  const session = getSession();
  if (!session || !session.access_token) return null;
  try {
    return await fetchJson(`${cfg.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: buildHeaders({ authToken: session.access_token }),
    });
  } catch (_) {
    clearSession();
    return null;
  }
}

function encodeFilterValue(value) {
  return encodeURIComponent(String(value || ''));
}

export async function fetchRequests(filters = {}) {
  const cfg = getConfig();
  const session = getSession();
  if (!session || !session.access_token) {
    throw new Error('Admin session not found. Please sign in again.');
  }

  const params = new URLSearchParams();
  params.set('select', [
    'id',
    'order_id',
    'created_at',
    'applicant_name',
    'mobile',
    'email',
    'primary_voter_id',
    'secondary_voter_id',
    'old_voter_id',
    'has_old_voter_id',
    'knows_neighbor',
    'neighbor_found_in_2002',
    'neighbor_name',
    'neighbor_locality',
    'neighbor_voter_id',
    'neighbor_ac_number',
    'neighbor_part_number',
    'neighbor_serial_number',
    'neighbor_found_screenshot_url',
    'declaration_accepted',
    'primary_front_url',
    'primary_back_url',
    'secondary_front_url',
    'secondary_back_url',
    'old_front_url',
    'old_back_url',
    'status',
    'assigned_volunteer',
    'assigned_date',
    'ac_number',
    'part_number',
    'serial_number',
    'result_status',
    'remarks',
    'kannada_roll_validated',
    'completed_at',
    'details_cleared_at',
  ].join(','));
  params.set('order', 'created_at.desc');
  params.set('limit', String(filters.limit || 200));

  if (filters.status && filters.status !== 'ALL') {
    params.set('status', `eq.${filters.status}`);
  }
  if (filters.volunteer) {
    params.set('assigned_volunteer', `ilike.*${filters.volunteer}*`);
  }

  if (filters.search) {
    const search = sanitizeText(filters.search);
    if (search.toUpperCase().startsWith('VSR-')) {
      params.set('order_id', `ilike.*${search.toUpperCase()}*`);
    } else {
      params.set('mobile', `like.*${normalizeMobile(search)}*`);
    }
  }

  return fetchJson(`${cfg.supabaseUrl}/rest/v1/search_requests?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders({ authToken: session.access_token }),
  });
}

export async function fetchRequestDashboardStats() {
  const session = getSession();
  if (!session || !session.access_token) {
    throw new Error('Admin session not found. Please sign in again.');
  }
  const response = await callRpc('admin_get_request_dashboard_stats', {}, session.access_token);
  return Array.isArray(response) ? response[0] : response;
}

export async function clearFoundRequests() {
  const session = getSession();
  if (!session || !session.access_token) {
    throw new Error('Admin session not found. Please sign in again.');
  }
  const response = await callRpc('admin_cleanup_found_requests', {}, session.access_token);
  return Array.isArray(response) ? response[0] : response;
}

export async function updateRequest(id, patch) {
  const cfg = getConfig();
  const session = getSession();
  if (!session || !session.access_token) {
    throw new Error('Admin session not found. Please sign in again.');
  }

  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/search_requests?id=eq.${encodeFilterValue(id)}`, {
    method: 'PATCH',
    headers: {
      ...buildHeaders({ authToken: session.access_token, json: true }),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    await parseErrorResponse(response);
  }
  return response.json();
}

export function setStatusMessage(el, type, message) {
  el.className = `assist-alert assist-alert-${type}`;
  el.textContent = message;
  el.hidden = false;
}

export function clearStatusMessage(el) {
  el.hidden = true;
  el.textContent = '';
  el.className = 'assist-alert';
}

export function serializeForm(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

export function boolFromRadio(value) {
  return value === 'yes';
}

export function ensureRequiredFiles(files, labels) {
  const entries = Array.isArray(labels) ? labels : files;
  const missing = [];
  entries.forEach(([file, label]) => {
    if (!file) missing.push(label);
  });
  if (missing.length) {
    throw new Error(`Please upload: ${missing.join(', ')}`);
  }
}
