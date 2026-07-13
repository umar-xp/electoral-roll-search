"""
Validators — Page classification, row filtering, and record validation.
"""

import re
import cv2
import pytesseract


def classify_page(img, tessdata_dir):
    """Classify a page type by OCR-ing the header region.

    Returns:
        tuple: (page_type, confidence) — page_type is one of:
            'voter', 'summary', 'addendum', 'revision'
    """
    h, w = img.shape[:2]
    header_img = img[0:int(h * 0.15), :]
    gray = cv2.cvtColor(header_img, cv2.COLOR_BGR2GRAY)

    text = pytesseract.image_to_string(gray, lang='kan+eng',
                                       config=f'--psm 6')

    if 'ವಿಶೇಷ' in text and ('ಪರಿಷ' in text or 'ಪರಿಶ' in text):
        return 'revision', 0.95

    has_voter_header = 'ಮತದಾರರ ಹೆಸರು' in text or 'ಹೆಸರು' in text
    has_column_numbers = '(1)' in text or '(2)' in text or '(3)' in text
    has_reservation = 'ಮೀಸಲಾತಿ' in text

    if has_reservation and not has_column_numbers:
        return 'summary', 0.9

    if 'ಮ.ಗು.ಚೀ' in text or 'ಮ.ಗು' in text:
        return 'addendum', 0.9

    if has_voter_header or has_column_numbers:
        return 'voter', 1.0

    return 'voter', 0.7


def is_header_row(raw_cols):
    """Detect section headers / division name rows that aren't voter data."""
    sn = raw_cols.get("serial_no", "")
    name = raw_cols.get("voter_name", "")
    combined = sn + " " + name
    if 'ವಿಭಾಗ' in combined:
        return True
    rel = raw_cols.get("relation", "")
    gender = raw_cols.get("gender", "")
    if not rel and not gender and name:
        return True
    return False


def is_garbled_row(voter):
    """Detect rows where OCR produced garbage instead of real voter data.
    
    More conservative than before — only rejects truly unrecoverable rows.
    """
    name = voter.get("voter_name", "")
    gender = voter.get("gender", "")
    relation = voter.get("relation", "")
    relative = voter.get("relative_name", "")
    all_text = name + gender + relation + relative

    HEADER_KEYWORDS = (
        'ವಿವರಗಳು', 'ಕ್ರಮ ಸಂಖ್ಯೆ', 'ಮತದಾರರ', 'ಸಂಬಂಧ', 'ವಯಸು',
        'ಮನೆ', 'ಫ್ಲಾಟ', 'ಪಟ್ಟಿಯ', 'ಮೂಲಪಟ್ಟಿ', 'ಪೂರಕ', 'ಭಾಗದ',
    )
    if name and any(kw in name for kw in HEADER_KEYWORDS):
        return True

    has_kannada = any('\u0C80' <= c <= '\u0CFF' for c in all_text)

    if not has_kannada and name:
        english_ratio = sum(1 for c in name if c.isascii() and c.isalpha()) / max(len(name), 1)
        # Only reject if ALL text is English garbage (not just the name)
        if english_ratio > 0.8 and not any('\u0C80' <= c <= '\u0CFF' for c in relative):
            return True

    if name:
        special_ratio = sum(1 for c in name if c in '=!@#$%^&[]{}|<>') / max(len(name), 1)
        if special_ratio > 0.15:
            return True

    # Only reject extremely low confidence rows (< 35, was 45)
    conf = voter.get("conf", {})
    conf_vals = [v for v in conf.values() if v > 0]
    if conf_vals and (sum(conf_vals) / len(conf_vals)) < 35:
        return True

    return False


def validate_voter(v, page_type='voter'):
    """Run final validation checks on an extracted voter record.

    Sets v["valid"] = True/False and v["issues"] = list of failure reasons.
    """
    issues = []

    sn = v.get("serial_no", "")
    if page_type == 'voter':
        if not sn or not re.match(r'^\d{1,5}$', sn):
            issues.append(f"serial_no '{sn}'")

    has_name = bool(v.get("voter_name") and len(v.get("voter_name", "").strip()) >= 2)
    has_relative = bool(v.get("relative_name") and len(v.get("relative_name", "").strip()) >= 2)
    has_id = bool(v.get("voter_id"))
    if not has_name and not has_relative and not has_id:
        issues.append("no identifying info")

    g = v.get("gender", "")
    # Accept common Kannada gender abbreviations and empty (may be missing in scan)
    valid_genders = ('ಗಂ', 'ಹೆಂ', 'ಗಂಡ', 'ಹೆಂಡ', '')
    if g and g not in valid_genders:
        # Check if it starts with a valid gender prefix
        if not (g.startswith('ಗಂ') or g.startswith('ಹೆಂ') or g.startswith('ಗ') or g.startswith('ಹ')):
            # Gender is garbled — clear it rather than failing validation
            # (some rows have column bleed from adjacent cells)
            v["gender"] = ""
            v["gender_cleared"] = True

    age = v.get("age", "")
    if age:
        try:
            a = int(age)
            if a < 18 or a > 120:
                if not v.get("age_estimated") and not v.get("age_repaired"):
                    issues.append(f"age {a}")
        except ValueError:
            issues.append(f"age '{age}'")

    vid = v.get("voter_id", "")
    if vid and not re.match(r'^\d{4,7}$', vid):
        issues.append(f"vid '{vid}'")

    v["valid"] = len(issues) == 0
    v["issues"] = issues
    return v
