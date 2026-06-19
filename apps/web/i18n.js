/**
 * Language Switcher — English ↔ Kannada
 * ======================================
 * Translates all UI strings. Default: English.
 * Stores preference in localStorage.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'votersearch_lang';

  const translations = {
    // Header
    'site-title': { en: 'Karnataka 2002 Voter List Search', kn: 'ಕರ್ನಾಟಕ 2002 ಮತದಾರರ ಪಟ್ಟಿ ಹುಡುಕಾಟ' },
    'site-subtitle': { en: 'ಕರ್ನಾಟಕ 2002 ಮತದಾರರ ಪಟ್ಟಿ ಹುಡುಕಾಟ', kn: 'Karnataka 2002 Voter List Search' },
    'header-records': { en: '7M+ Records', kn: '7M+ ದಾಖಲೆಗಳು' },

    // Disclaimer
    'disclaimer-strong': { en: '⚠️ This is NOT an official Election Commission of India website.', kn: '⚠️ ಇದು ಅಧಿಕೃತ ಭಾರತ ಚುನಾವಣಾ ಆಯೋಗದ ವೆಬ್‌ಸೈಟ್ ಅಲ್ಲ.' },
    'disclaimer-text': { en: 'This is an independent community tool to make historical voter rolls searchable.', kn: 'ಐತಿಹಾಸಿಕ ಮತದಾರರ ಪಟ್ಟಿಯನ್ನು ಹುಡುಕಬಹುದಾದ ಸ್ವತಂತ್ರ ಸಮುದಾಯ ಸಾಧನ.' },

    // Tabs
    'tab-db-label': { en: 'Search by Name', kn: 'ಹೆಸರಿನಿಂದ ಹುಡುಕಿ' },
    'tab-db-desc': { en: 'No upload needed', kn: 'ಅಪ್ಲೋಡ್ ಅಗತ್ಯವಿಲ್ಲ' },
    'tab-upload-label': { en: 'Upload PDF & Search', kn: 'PDF ಅಪ್ಲೋಡ್ ಮಾಡಿ & ಹುಡುಕಿ' },
    'tab-upload-desc': { en: 'Any district', kn: 'ಯಾವುದೇ ಜಿಲ್ಲೆ' },

    // Search Card Header
    'search-card-title': { en: 'Search by Elector Details', kn: 'ಮತದಾರರ ವಿವರಗಳಿಂದ ಹುಡುಕಿ' },
    'search-card-hint': { en: 'Search historical Karnataka electoral rolls (2002 onwards)', kn: 'ಐತಿಹಾಸಿಕ ಕರ್ನಾಟಕ ಮತದಾರರ ಪಟ್ಟಿಯನ್ನು ಹುಡುಕಿ (2002 ರಿಂದ)' },

    // Labels
    'lbl-district': { en: 'District *', kn: 'ಜಿಲ್ಲೆ *' },
    'lbl-ac': { en: 'Assembly Constituency *', kn: 'ವಿಧಾನಸಭಾ ಕ್ಷೇತ್ರ *' },
    'lbl-part': { en: 'Part Number (Optional)', kn: 'ಭಾಗ ಸಂಖ್ಯೆ (ಐಚ್ಛಿಕ)' },
    'lbl-voter-name': { en: 'Voter Full Name *', kn: 'ಮತದಾರರ ಪೂರ್ಣ ಹೆಸರು *' },
    'lbl-relative-name': { en: 'Father/Mother/Husband Name (Optional)', kn: 'ತಂದೆ/ತಾಯಿ/ಗಂಡನ ಹೆಸರು (ಐಚ್ಛಿಕ)' },
    'lbl-age': { en: 'Age (Optional, ±2yr)', kn: 'ವಯಸ್ಸು (ಐಚ್ಛಿಕ, ±2ವರ್ಷ)' },
    'lbl-rel-type': { en: 'Relative Type', kn: 'ಸಂಬಂಧ ವಿಧ' },
    'lbl-gender': { en: 'Gender', kn: 'ಲಿಂಗ' },
    'lbl-voter-id': { en: 'Voter ID | EPIC No.', kn: 'ಮತದಾರ ID | EPIC ಸಂಖ್ಯೆ' },

    // Placeholders
    'ph-district': { en: 'Select District', kn: 'ಜಿಲ್ಲೆ ಆಯ್ಕೆ ಮಾಡಿ' },
    'ph-ac': { en: 'Select AC', kn: 'ಕ್ಷೇತ್ರ ಆಯ್ಕೆ ಮಾಡಿ' },
    'ph-part': { en: 'All Parts', kn: 'ಎಲ್ಲಾ ಭಾಗಗಳು' },
    'ph-voter-name': { en: 'e.g. Abdul Rehman', kn: 'ಉದಾ. ಅಬ್ದುಲ್ ರೆಹಮಾನ್' },
    'ph-relative-name': { en: 'e.g. Mohammad Ibrahim', kn: 'ಉದಾ. ಮೊಹಮದ್ ಇಬ್ರಾಹಿಂ' },
    'ph-age': { en: 'e.g. 35', kn: 'ಉದಾ. 35' },

    // Scope
    'scope-legend': { en: 'Search Scope', kn: 'ಹುಡುಕಾಟ ವ್ಯಾಪ್ತಿ' },
    'scope-all': { en: 'Search entire constituency', kn: 'ಈ ಕ್ಷೇತ್ರದ ಎಲ್ಲಾ ಭಾಗಗಳು' },
    'scope-part': { en: 'Specific part only (faster)', kn: 'ಆಯ್ದ ಭಾಗ ಮಾತ್ರ (ವೇಗ)' },

    // Advanced
    'advanced-toggle': { en: '▼ Advanced Filters', kn: '▼ ಹೆಚ್ಚಿನ ಫಿಲ್ಟರ್' },
    'opt-any': { en: 'Any', kn: 'ಯಾವುದಾದರೂ' },

    // Buttons
    'btn-search-text': { en: '🔍 Search', kn: '🔍 ಹುಡುಕಿ' },
    'btn-global-text': { en: '🌐 Search All Districts', kn: '🌐 ಎಲ್ಲಾ ಜಿಲ್ಲೆಗಳಲ್ಲಿ ಹುಡುಕಿ' },
    'btn-clear-text': { en: '✕ Clear', kn: '✕ ಅಳಿಸಿ' },
    'search-hint-text': { en: '→ Select a District & AC above, then enter a name', kn: '→ ಮೇಲೆ ಜಿಲ್ಲೆ & ಕ್ಷೇತ್ರ ಆಯ್ಕೆ ಮಾಡಿ, ನಂತರ ಹೆಸರು ನಮೂದಿಸಿ' },

    // Empty State
    'empty-title': { en: 'Your search results will appear here', kn: 'ನಿಮ್ಮ ಹುಡುಕಾಟ ಫಲಿತಾಂಶಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ' },
    'empty-sub': { en: 'Select a district, enter a name, and hit Search', kn: 'ಜಿಲ್ಲೆ ಆಯ್ಕೆ ಮಾಡಿ, ಹೆಸರು ನಮೂದಿಸಿ, ಹುಡುಕಿ ಒತ್ತಿ' },

    // Upload Tab
    'upload-title': { en: 'Upload Electoral Roll PDF', kn: 'ಮತದಾರರ ಪಟ್ಟಿ PDF ಅಪ್ಲೋಡ್' },
    'upload-drop': { en: 'Click to upload or drag & drop PDF(s) here', kn: 'PDF ಅಪ್ಲೋಡ್ ಮಾಡಲು ಕ್ಲಿಕ್ ಮಾಡಿ ಅಥವಾ ಇಲ್ಲಿ ಡ್ರ್ಯಾಗ್ & ಡ್ರಾಪ್ ಮಾಡಿ' },
    'upload-hint': { en: 'CEO Karnataka format only — e.g. A1620037.pdf. AC is auto-detected.', kn: 'CEO ಕರ್ನಾಟಕ ಫಾರ್ಮ್ಯಾಟ್ ಮಾತ್ರ — ಉದಾ. A1620037.pdf. AC ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಪತ್ತೆಯಾಗುತ್ತದೆ.' },
    'search-voter-title': { en: 'Search Voter', kn: 'ಮತದಾರರನ್ನು ಹುಡುಕಿ' },
    'lbl-your-name': { en: 'Your Name (full or partial)', kn: 'ನಿಮ್ಮ ಹೆಸರು (ಪೂರ್ಣ ಅಥವಾ ಭಾಗಶಃ)' },
    'lbl-father-name': { en: "Father's / Husband's Name", kn: 'ತಂದೆ / ಗಂಡನ ಹೆಸರು' },
    'hint-works-in': { en: 'Works in English, Kannada, or any phonetic spelling', kn: 'ಇಂಗ್ಲಿಷ್, ಕನ್ನಡ, ಅಥವಾ ಫೋನೆಟಿಕ್ ಸ್ಪೆಲ್ಲಿಂಗ್ ನಲ್ಲಿ ಕೆಲಸ ಮಾಡುತ್ತದೆ' },
    'hint-optional-narrow': { en: 'Optional — helps narrow down results', kn: 'ಐಚ್ಛಿಕ — ಫಲಿತಾಂಶಗಳನ್ನು ಸಂಕುಚಿಸಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ' },
    'btn-clear-stored-text': { en: '🗑️ Clear all stored PDF data', kn: '🗑️ ಎಲ್ಲಾ ಸಂಗ್ರಹಿಸಿದ PDF ಡೇಟಾ ಅಳಿಸಿ' },
    'clear-hint-text': { en: 'Removes cached results — useful when uploading new PDFs', kn: 'ಕ್ಯಾಶ್ ಮಾಡಿದ ಫಲಿತಾಂಶಗಳನ್ನು ತೆಗೆದುಹಾಕುತ್ತದೆ' },

    // Secondary
    'secondary-toggle-text': { en: 'ℹ️ More: Videos, Guide, Links & Vote for Next District', kn: 'ℹ️ ಹೆಚ್ಚು: ವೀಡಿಯೊಗಳು, ಮಾರ್ಗದರ್ಶಿ, ಲಿಂಕ್‌ಗಳು & ಮುಂದಿನ ಜಿಲ್ಲೆಗೆ ಮತ' },
    'video-title': { en: 'Watch: How to Use This Tool', kn: 'ನೋಡಿ: ಈ ಸಾಧನವನ್ನು ಹೇಗೆ ಬಳಸುವುದು' },
    'guide-title': { en: 'Quick Guide', kn: 'ತ್ವರಿತ ಮಾರ್ಗದರ್ಶಿ' },
    'guide-note-text': { en: 'Few districts are added in the full search. For other districts, use the following 3 steps.', kn: 'ಪೂರ್ಣ ಹುಡುಕಾಟದಲ್ಲಿ ಕೆಲವು ಜಿಲ್ಲೆಗಳು ಮಾತ್ರ ಲಭ್ಯ. ಇತರ ಜಿಲ್ಲೆಗಳಿಗೆ, ಈ 3 ಹಂತಗಳನ್ನು ಅನುಸರಿಸಿ.' },
    'guide-step-1': { en: 'Visit voters.eci.gov.in and look for the most likely polling station or part number where your name may exist.', kn: 'voters.eci.gov.in ಗೆ ಭೇಟಿ ನೀಡಿ ಮತ್ತು ನಿಮ್ಮ ಹೆಸರು ಇರಬಹುದಾದ ಮತಗಟ್ಟೆ ಅಥವಾ ಭಾಗ ಸಂಖ್ಯೆಯನ್ನು ಹುಡುಕಿ.' },
    'guide-step-2': { en: 'Go to ceo.karnataka.gov.in/voter_list/en and download the PDF(s) for your AC and part number.', kn: 'ceo.karnataka.gov.in/voter_list/en ಗೆ ಹೋಗಿ ನಿಮ್ಮ AC ಮತ್ತು ಭಾಗ ಸಂಖ್ಯೆಯ PDF(ಗಳನ್ನು) ಡೌನ್ಲೋಡ್ ಮಾಡಿ.' },
    'guide-step-3': { en: 'Upload the PDF(s) below and enter your name. The tool will OCR and search the roll for you.', kn: 'ಕೆಳಗೆ PDF(ಗಳನ್ನು) ಅಪ್ಲೋಡ್ ಮಾಡಿ ಮತ್ತು ನಿಮ್ಮ ಹೆಸರನ್ನು ನಮೂದಿಸಿ. ಸಾಧನ OCR ಮಾಡಿ ಹುಡುಕುತ್ತದೆ.' },
    'links-label': { en: '🔗 Important Links', kn: '🔗 ಮುಖ್ಯ ಲಿಂಕ್‌ಗಳು' },
    'share-label': { en: '📣 Know someone searching the 2002 voter list? Share this tool:', kn: '📣 2002 ಮತದಾರರ ಪಟ್ಟಿ ಹುಡುಕುತ್ತಿರುವವರನ್ನು ತಿಳಿದಿದ್ದೀರಾ? ಈ ಸಾಧನ ಹಂಚಿಕೊಳ್ಳಿ:' },
    'share-whatsapp': { en: 'Share on WhatsApp', kn: 'WhatsApp ನಲ್ಲಿ ಹಂಚಿಕೊಳ್ಳಿ' },
    'share-copy': { en: '🔗 Copy Link', kn: '🔗 ಲಿಂಕ್ ನಕಲಿಸಿ' },
    'vote-title': { en: '🗳️ Help us expand — vote for the next district!', kn: '🗳️ ವಿಸ್ತರಿಸಲು ಸಹಾಯ ಮಾಡಿ — ಮುಂದಿನ ಜಿಲ್ಲೆಗೆ ಮತ ನೀಡಿ!' },
    'vote-sub': { en: 'Currently searchable: Bagalkot · BBMP / Bangalore Urban · Mysore. Vote below and the district with the most votes gets processed next.', kn: 'ಪ್ರಸ್ತುತ ಹುಡುಕಬಹುದಾದ: ಬಾಗಲಕೋಟೆ · BBMP / ಬೆಂಗಳೂರು ನಗರ · ಮೈಸೂರು. ಕೆಳಗೆ ಮತ ನೀಡಿ.' },
    'vote-select': { en: 'Select a district to vote for…', kn: 'ಮತ ನೀಡಲು ಜಿಲ್ಲೆ ಆಯ್ಕೆ ಮಾಡಿ…' },
    'vote-btn': { en: '🗳️ Cast My Vote', kn: '🗳️ ನನ್ನ ಮತ ನೀಡಿ' },

    // Footer
    'footer-text': { en: 'This tool is for community service. Data sourced from official CEO Karnataka electoral rolls.', kn: 'ಈ ಸಾಧನ ಸಮುದಾಯ ಸೇವೆಗಾಗಿ. CEO ಕರ್ನಾಟಕ ಅಧಿಕೃತ ಮತದಾರರ ಪಟ್ಟಿಯಿಂದ ಡೇಟಾ.' },
    'footer-local': { en: 'All data stored locally in your browser', kn: 'ಎಲ್ಲಾ ಡೇಟಾ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಸ್ಥಳೀಯವಾಗಿ ಸಂಗ್ರಹಿಸಲಾಗಿದೆ' },

    // Feedback
    'feedback-btn': { en: '💬 Feedback', kn: '💬 ಪ್ರತಿಕ್ರಿಯೆ' },
    'feedback-title': { en: '💬 Send Feedback', kn: '💬 ಪ್ರತಿಕ್ರಿಯೆ ಕಳುಹಿಸಿ' },
    'feedback-desc': { en: 'Found a bug or have a suggestion? Describe it below.', kn: 'ದೋಷ ಕಂಡುಕೊಂಡಿದ್ದೀರಾ ಅಥವಾ ಸಲಹೆ ಇದೆಯೇ? ಕೆಳಗೆ ವಿವರಿಸಿ.' },
    'feedback-ss-label': { en: '📸 Screenshot (optional)', kn: '📸 ಸ್ಕ್ರೀನ್‌ಶಾಟ್ (ಐಚ್ಛಿಕ)' },
    'feedback-ss-text': { en: 'Click to attach a screenshot', kn: 'ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಲಗತ್ತಿಸಲು ಕ್ಲಿಕ್ ಮಾಡಿ' },
    'feedback-desc-label': { en: '📝 Describe the issue or suggestion *', kn: '📝 ಸಮಸ್ಯೆ ಅಥವಾ ಸಲಹೆ ವಿವರಿಸಿ *' },
    'feedback-submit': { en: '📨 Send Feedback', kn: '📨 ಪ್ರತಿಕ್ರಿಯೆ ಕಳುಹಿಸಿ' },
    'feedback-cancel': { en: 'Cancel', kn: 'ರದ್ದುಮಾಡಿ' },

    // Modal
    'modal-title': { en: 'Voter Found!', kn: 'ಮತದಾರರು ಪತ್ತೆಯಾಗಿದ್ದಾರೆ!' },
    'modal-desc': { en: 'Your voter details have been located in the electoral roll.', kn: 'ನಿಮ್ಮ ಮತದಾರ ವಿವರಗಳು ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಪತ್ತೆಯಾಗಿವೆ.' },
    'modal-note': { en: '⭐ Note down your AC Number & Part Number — you will need these when verifying your vote at the polling booth.', kn: '⭐ ನಿಮ್ಮ AC ಸಂಖ್ಯೆ & ಭಾಗ ಸಂಖ್ಯೆ ಬರೆದಿಟ್ಟುಕೊಳ್ಳಿ — ಮತಗಟ್ಟೆಯಲ್ಲಿ ಪರಿಶೀಲಿಸುವಾಗ ಇವು ಬೇಕಾಗುತ್ತವೆ.' },
    'modal-done': { en: 'Done', kn: 'ಮುಗಿಯಿತು' },
  };

  let currentLang = 'en';

  function getLang() {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) { return 'en'; }
  }

  function setLang(lang) {
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    applyTranslations();
    updateToggleUI();
    document.documentElement.lang = lang === 'kn' ? 'kn' : 'en';
  }

  function t(key) {
    const entry = translations[key];
    if (!entry) return '';
    return entry[currentLang] || entry.en || '';
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var text = t(key);
      if (text) el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var text = t(key);
      if (text) el.innerHTML = text;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var text = t(key);
      if (text) el.placeholder = text;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      var text = t(key);
      if (text) el.title = text;
    });
    // Show/hide bilingual helper text
    var kanSpans = document.querySelectorAll('.label-kan, .h2-kan');
    kanSpans.forEach(function (span) {
      span.style.display = currentLang === 'kn' ? 'none' : '';
    });
  }

  function updateToggleUI() {
    var btn = document.getElementById('btn-lang-toggle');
    if (!btn) return;
    if (currentLang === 'kn') {
      btn.textContent = 'English';
      btn.setAttribute('aria-label', 'Switch to English');
    } else {
      btn.textContent = 'ಕನ್ನಡ';
      btn.setAttribute('aria-label', 'ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಿ');
    }
  }

  function init() {
    currentLang = getLang();
    applyTranslations();
    updateToggleUI();
    document.documentElement.lang = currentLang === 'kn' ? 'kn' : 'en';

    var btn = document.getElementById('btn-lang-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        setLang(currentLang === 'en' ? 'kn' : 'en');
      });
    }
  }

  // Expose for external use
  window.i18n = { t: t, setLang: setLang, getLang: function () { return currentLang; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
