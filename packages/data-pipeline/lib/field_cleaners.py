"""
Field Cleaners — Post-OCR field normalization and validation.
"""

import re


def clean_serial(text):
    """Clean and validate serial number field.

    Handles OCR misreads: 'a'->9, 'l'->1, 'O'->0, etc.
    Valid range: 1-9999.
    """
    text = text.strip().rstrip('.')
    digits = re.sub(r'[^\d]', '', text)
    if digits:
        val = int(digits)
        if 1 <= val <= 9999:
            return str(val)
    text2 = text.replace('a', '9').replace('l', '1').replace('O', '0').replace('o', '0')
    text2 = text2.replace('w', '1').replace('i', '1').replace('I', '1')
    digits = re.sub(r'[^\d]', '', text2)
    if digits:
        val = int(digits)
        if 1 <= val <= 9999:
            return str(val)
    return text


def clean_age(text):
    """Clean and validate age field (18-120).
    
    Enhanced with better OCR misread correction for age-specific patterns:
    - Common OCR errors: 'l8' -> 18, 'Z5' -> 25, 'B0' -> 80
    - Two-digit extraction from longer garbage strings
    """
    if not text or not text.strip():
        return ""
    text = text.strip()
    
    # Apply digit-specific OCR corrections before extracting
    corrected = text.translate(str.maketrans('lIoOsSbBGgZz', '110055886622'))
    digits = re.sub(r'[^\d]', '', corrected)
    
    if not digits:
        return ""
    val = int(digits)
    if 18 <= val <= 120:
        return str(val)
    if val > 120:
        # Try last 2 digits (common: "118" from "18" with leading noise)
        last2 = val % 100
        if 18 <= last2 <= 120:
            return str(last2)
        # Try first 2 digits
        first2 = int(str(val)[:2])
        if 18 <= first2 <= 120:
            return str(first2)
    # Single digit — could be a tens digit with missing ones (e.g., "2" from "2x")
    if 1 <= val <= 9:
        return ""
    # Two digits but out of range (e.g., 12, 15) — likely OCR error, discard
    if 10 <= val <= 17:
        return ""
    return str(val) if 18 <= val <= 120 else ""


# Translation table for common OCR digit misreads
_DIGIT_MISREADS = str.maketrans('lIoOsSbBGgZz', '110055886622')

# Translation table for Kannada numerals (೦-೯) to ASCII digits
_KANNADA_DIGITS = str.maketrans('೦೧೨೩೪೫೬೭೮೯', '0123456789')


# EPIC number pattern: 2-3 uppercase letters followed by 7 digits (e.g., WPR1234567)
_EPIC_PATTERN = re.compile(r'[A-Z]{2,3}\d{7}')
# Loose EPIC: allow OCR misreads in prefix (digits mixed with letters)
_EPIC_LOOSE = re.compile(r'[A-Z0-9]{2,3}(\d{7})')


def clean_voter_id(text):
    """Clean and validate voter EPIC number.

    Supports two formats:
      1. Full EPIC: 2-3 letter prefix + 7 digits (e.g., WPR1234567)
      2. Numeric-only: 5-6 digit ID (legacy/partial extraction)

    Handles:
      - Common OCR misreads (l→1, O→0, S→5, B→8, G→6, Z→2)
      - Kannada numeral conversion (೦-೯ → 0-9)
      - Full EPIC pattern detection with alpha prefix preserved
    """
    # Step 1: Normalize Kannada numerals
    text = text.translate(_KANNADA_DIGITS)
    
    # Step 2: Try to extract full EPIC number (e.g., WPR1234567)
    # First clean up common OCR letter→digit confusion in the alpha prefix
    cleaned_upper = text.upper().strip()
    # Fix common OCR misreads that turn letters into digits
    epic_text = cleaned_upper.replace('0', 'O').replace('1', 'I')  # for prefix only
    
    # Try exact EPIC pattern on original uppercase text
    m = _EPIC_PATTERN.search(cleaned_upper)
    if m:
        return m.group(0)
    
    # Try with OCR digit→letter fixes applied to first 3 chars only
    if len(cleaned_upper) >= 10:
        prefix_fixed = cleaned_upper[:3]
        prefix_fixed = re.sub(r'[0O]', 'O', prefix_fixed)
        prefix_fixed = re.sub(r'[1IL]', 'I', prefix_fixed)
        candidate = prefix_fixed + cleaned_upper[3:]
        m2 = _EPIC_PATTERN.search(candidate)
        if m2:
            return m2.group(0)
    
    # Step 3: Fall back to digit-only extraction (legacy behavior)
    text_for_digits = text.translate(_DIGIT_MISREADS)
    digits = re.sub(r'[^\d]', '', text_for_digits)
    if len(digits) == 7:
        # Could be EPIC without prefix — check if original had letter prefix
        alpha_prefix = re.match(r'[A-Za-z]{2,3}', text.strip())
        if alpha_prefix:
            return alpha_prefix.group(0).upper() + digits
        return digits
    if len(digits) == 6:
        return digits
    if len(digits) >= 8:
        # Try extracting 7-digit sequence (EPIC numeric part)
        m3 = re.search(r'\d{7}', digits)
        if m3:
            return m3.group(0)[:7]
        return digits[:6]
    if len(digits) == 5:
        return digits
    return ""


def clean_gender(text):
    """Normalize gender field to Kannada abbreviations.
    
    Enhanced to handle more OCR variations and English outputs.
    """
    text = text.strip()
    if not text:
        return ""
    # Standard Kannada male patterns
    if 'ಗಂ' in text or text in ('ಗಂ', 'ಗೆಂ', 'ಗರಂ', 'ಗ'):
        return 'ಗಂ'
    # Standard Kannada female patterns
    if 'ಹೆಂ' in text or text in ('ಹೆಂ', 'ಹೆ', 'ಹೆರಿ', 'ಹೇ', 'ಹೆರ', 'ಹೆಂಗ'):
        return 'ಹೆಂ'
    # Starts with male/female Kannada chars
    if text.startswith('ಗ'):
        return 'ಗಂ'
    if text.startswith('ಹ'):
        return 'ಹೆಂ'
    # English OCR outputs (Male/Female)
    text_lower = text.lower()
    if text_lower in ('m', 'male', 'ma', 'mal'):
        return 'ಗಂ'
    if text_lower in ('f', 'female', 'fe', 'fem'):
        return 'ಹೆಂ'
    # Check for any Kannada character — if none, likely garbled
    if text and not any('\u0C80' <= c <= '\u0CFF' for c in text):
        return ''
    return text


def clean_relation(text):
    """Normalize relation type to standard Kannada terms."""
    text = text.strip().rstrip('.').rstrip(',')
    if text in ('ಇತರೆ', 'ಇತೆರೆ', 'ಇತರೆ...'):
        return 'ಇತರೆ'
    if text in ('ತಂದೆ', 'ತಂಡೆ'):
        return 'ತಂದೆ'
    if text in ('ಗಂಡ', 'ಗಂಡ.'):
        return 'ಗಂಡ'
    if text in ('ತಾಯಿ',):
        return 'ತಾಯಿ'
    return text


def clean_name(text):
    """Clean voter/relative name by removing English OCR artifacts.
    
    If a name is predominantly English/ASCII characters, it's likely
    garbled OCR output from column drift. Returns empty string in that case.
    """
    artifacts = ['TER:', 'BABO', 'AlAs,', '|', '~', '—', '*', '&', 'Oe', 'mend',
                 'ow', 'ee', 'aa', 'oo', 'nce', 'oD', 'pH', '॥']
    cleaned = text
    for art in artifacts:
        if art in cleaned:
            cleaned = cleaned.replace(art, '').strip()
    # Remove isolated single ASCII characters
    cleaned = re.sub(r'(?<!\w)[A-Za-z](?!\w)', '', cleaned)
    # Remove trailing short English fragments
    cleaned = re.sub(r'\s+[A-Za-z]{1,3}$', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = cleaned.strip('.-,;: "\'')
    
    # Detect predominantly English/garbled text — likely column drift
    # Count Kannada vs ASCII characters (ignoring whitespace/punctuation)
    kannada_chars = sum(1 for c in cleaned if '\u0C80' <= c <= '\u0CFF')
    ascii_alpha = sum(1 for c in cleaned if c.isascii() and c.isalpha())
    total_alpha = kannada_chars + ascii_alpha
    
    if total_alpha > 0 and ascii_alpha / total_alpha > 0.6:
        # More than 60% ASCII — this is garbled OCR, clear it
        # But keep if it looks like a valid English initial (e.g., "M." or "K.V.")
        if len(cleaned) > 5:
            return ""
    
    return cleaned
