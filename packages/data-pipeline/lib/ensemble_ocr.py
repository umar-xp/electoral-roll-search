"""
ensemble_ocr.py — Multi-Engine OCR with Confidence-Weighted Voting
====================================================================
Author: Mohammed Shoaib U

Uses Tesseract + EasyOCR for ensemble voting per field.

Strategy:
  - Numeric fields (serial, age, voter_id): digit-whitelist with both engines
  - Kannada names: both engines with character-level voting
  - Gender/Relation: Tesseract primary (better at single Kannada words)
  
Accuracy target: 97-100% character-level for all fields.
"""

import cv2
import numpy as np
import pytesseract
import easyocr
import re
from difflib import SequenceMatcher
from typing import Tuple, List, Dict

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import ocr_settings

pytesseract.pytesseract.tesseract_cmd = ocr_settings.TESSERACT_CMD
TESSDATA = ocr_settings.TESSDATA_DIR

# Initialize EasyOCR reader (cached globally for performance)
_easyocr_reader = None

def get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        _easyocr_reader = easyocr.Reader(['kn', 'en'], gpu=False, verbose=False)
    return _easyocr_reader


def tesseract_ocr(img_gray, lang='kan+eng', psm=7, whitelist=''):
    """Run Tesseract OCR on a grayscale image."""
    config = f'--psm {psm}'
    if whitelist:
        config += f' -c tessedit_char_whitelist={whitelist}'
    
    # Get text with confidence
    data = pytesseract.image_to_data(img_gray, lang=lang, config=config, output_type=pytesseract.Output.DICT)
    
    words = []
    confs = []
    for i, text in enumerate(data['text']):
        text = text.strip()
        if text and int(data['conf'][i]) > 0:
            words.append(text)
            confs.append(int(data['conf'][i]))
    
    result_text = ' '.join(words)
    avg_conf = sum(confs) / len(confs) if confs else 0
    
    return result_text, avg_conf


def easyocr_ocr(img_bgr):
    """Run EasyOCR on a BGR image."""
    reader = get_easyocr_reader()
    results = reader.readtext(img_bgr, detail=1, paragraph=False)
    
    words = []
    confs = []
    for (bbox, text, conf) in results:
        text = text.strip()
        if text:
            words.append(text)
            confs.append(conf * 100)  # Normalize to 0-100 scale
    
    result_text = ' '.join(words)
    avg_conf = sum(confs) / len(confs) if confs else 0
    
    return result_text, avg_conf


def easyocr_digit_ocr(img_bgr):
    """Run EasyOCR with digit-only allowlist."""
    reader = get_easyocr_reader()
    results = reader.readtext(img_bgr, detail=1, paragraph=False,
                              allowlist='0123456789')
    
    words = []
    confs = []
    for (bbox, text, conf) in results:
        text = text.strip()
        digits = ''.join(c for c in text if c.isdigit())
        if digits:
            words.append(digits)
            confs.append(conf * 100)
    
    result_text = ''.join(words)
    avg_conf = sum(confs) / len(confs) if confs else 0
    
    return result_text, avg_conf


def ensemble_vote_text(results: List[Tuple[str, float]]) -> Tuple[str, float]:
    """Pick the best result from multiple OCR engines using confidence.
    
    Args:
        results: list of (text, confidence) tuples
    
    Returns:
        (best_text, confidence)
    """
    # Filter empty results
    valid = [(text, conf) for text, conf in results if text.strip()]
    
    if not valid:
        return '', 0
    
    if len(valid) == 1:
        return valid[0]
    
    # If both agree exactly, use it with boosted confidence
    if len(valid) == 2 and valid[0][0] == valid[1][0]:
        return valid[0][0], min(99, max(valid[0][1], valid[1][1]) + 5)
    
    # Pick higher confidence result
    valid.sort(key=lambda x: x[1], reverse=True)
    return valid[0]


def ensemble_vote_digits(results: List[Tuple[str, float]], expected_len=0) -> Tuple[str, float]:
    """Vote on digit strings using multiple engines.
    
    For serial numbers (1-4 digits), ages (2 digits), voter IDs (6 digits).
    """
    # Extract only digits from each result
    cleaned = []
    for text, conf in results:
        digits = ''.join(c for c in text if c.isdigit())
        if digits:
            cleaned.append((digits, conf))
    
    if not cleaned:
        return '', 0
    
    if len(cleaned) == 1:
        return cleaned[0]
    
    # If all agree, great
    texts = [t for t, c in cleaned]
    if len(set(texts)) == 1:
        return texts[0], min(99, max(c for _, c in cleaned) + 5)
    
    # If expected length is known, prefer the one with correct length
    if expected_len > 0:
        correct_len = [(t, c) for t, c in cleaned if len(t) == expected_len]
        if len(correct_len) == 1:
            return correct_len[0]
        if len(correct_len) > 1:
            # Multiple correct-length results — pick highest confidence
            correct_len.sort(key=lambda x: x[1], reverse=True)
            return correct_len[0]
    
    # Fall back to highest confidence
    cleaned.sort(key=lambda x: x[1], reverse=True)
    return cleaned[0]


def ensemble_kannada_name(results: List[Tuple[str, float]]) -> Tuple[str, float]:
    """Vote on Kannada name strings.
    
    Prefers results that:
    1. Contain more Kannada characters
    2. Have higher confidence  
    3. Have fewer obvious garbage characters
    """
    valid = [(text.strip(), conf) for text, conf in results if text.strip()]
    
    if not valid:
        return '', 0
    
    if len(valid) == 1:
        return valid[0]
    
    # If they match exactly, great
    if valid[0][0] == valid[1][0]:
        return valid[0][0], min(99, max(valid[0][1], valid[1][1]) + 5)
    
    # Score each result
    def score_name(text, conf):
        kannada_count = sum(1 for c in text if '\u0C80' <= c <= '\u0CFF')
        total_chars = len(text.replace(' ', ''))
        if total_chars == 0:
            return 0
        
        kannada_ratio = kannada_count / total_chars
        garbage_count = sum(1 for c in text if c in '=!@#$%^&[]{}|<>0123456789')
        garbage_penalty = garbage_count * 10
        
        # Score: confidence + Kannada bonus - garbage penalty
        return conf * 0.6 + kannada_ratio * 40 - garbage_penalty
    
    scored = [(text, conf, score_name(text, conf)) for text, conf in valid]
    scored.sort(key=lambda x: x[2], reverse=True)
    
    return scored[0][0], scored[0][1]


def ocr_cell_ensemble(img_bgr, field_type='text'):
    """OCR a single cell using ensemble of Tesseract + EasyOCR.
    
    Args:
        img_bgr: BGR image of the cell
        field_type: 'serial', 'age', 'voter_id', 'name_kn', 'gender', 'house'
    
    Returns:
        (text, confidence)
    """
    if img_bgr.size == 0:
        return '', 0
    
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    
    if field_type == 'serial':
        # Digit-only OCR for serial numbers
        tess_result = tesseract_ocr(gray, lang='eng', psm=7, whitelist='0123456789')
        easy_result = easyocr_digit_ocr(img_bgr)
        return ensemble_vote_digits([tess_result, easy_result], expected_len=0)
    
    elif field_type == 'age':
        # 2-digit number
        tess_result = tesseract_ocr(gray, lang='eng', psm=7, whitelist='0123456789')
        easy_result = easyocr_digit_ocr(img_bgr)
        return ensemble_vote_digits([tess_result, easy_result], expected_len=2)
    
    elif field_type == 'voter_id':
        # 6-digit number
        tess_result = tesseract_ocr(gray, lang='eng', psm=7, whitelist='0123456789')
        easy_result = easyocr_digit_ocr(img_bgr)
        return ensemble_vote_digits([tess_result, easy_result], expected_len=6)
    
    elif field_type == 'name_kn':
        # Kannada name - use both engines with Kannada
        tess_result = tesseract_ocr(gray, lang='kan+eng', psm=7)
        easy_result = easyocr_ocr(img_bgr)
        return ensemble_kannada_name([tess_result, easy_result])
    
    elif field_type == 'gender':
        # Single Kannada word - Tesseract is better here
        tess_result = tesseract_ocr(gray, lang='kan', psm=7)
        return tess_result
    
    elif field_type == 'house':
        # Alphanumeric house number
        tess_result = tesseract_ocr(gray, lang='kan+eng', psm=7)
        easy_result = easyocr_ocr(img_bgr)
        return ensemble_vote_text([tess_result, easy_result])
    
    else:
        # Default: use both
        tess_result = tesseract_ocr(gray, lang='kan+eng', psm=7)
        easy_result = easyocr_ocr(img_bgr)
        return ensemble_vote_text([tess_result, easy_result])


def ocr_row_ensemble(row_img, column_zones):
    """OCR an entire row using per-field ensemble.
    
    Args:
        row_img: BGR image of one table row
        column_zones: list of (name, x_start, x_end) tuples
    
    Returns:
        dict with field names as keys, (text, confidence) as values
    """
    results = {}
    
    field_types = {
        'serial_no': 'serial',
        'house_no': 'house',
        'voter_name': 'name_kn',
        'relation': 'name_kn',
        'relative_name': 'name_kn',
        'gender': 'gender',
        'age': 'age',
        'voter_id': 'voter_id',
    }
    
    for col_name, x1, x2 in column_zones:
        cell_img = row_img[:, x1:x2]
        if cell_img.size == 0:
            results[col_name] = ('', 0)
            continue
        
        field_type = field_types.get(col_name, 'text')
        text, conf = ocr_cell_ensemble(cell_img, field_type)
        results[col_name] = (text, conf)
    
    return results


# ===== FULL ROW ENSEMBLE: Tesseract full-row + EasyOCR per-cell =====

def ocr_row_hybrid(row_img, column_zones):
    """Hybrid approach: Tesseract full-row (for context) + EasyOCR per-cell.
    
    Tesseract works best with full-row context (PSM 6).
    EasyOCR works best per-cell.
    Combine their strengths.
    """
    gray = cv2.cvtColor(row_img, cv2.COLOR_BGR2GRAY)
    
    # Pass 1: Tesseract full-row OCR with word positions
    tess_data = pytesseract.image_to_data(gray, lang='kan+eng',
        config=f'--psm 6',
        output_type=pytesseract.Output.DICT)
    
    # Build Tesseract result per column zone
    tess_by_col = {name: [] for name, _, _ in column_zones}
    for i, text in enumerate(tess_data['text']):
        text = text.strip()
        if not text or int(tess_data['conf'][i]) <= 0:
            continue
        word_x = tess_data['left'][i]
        word_w = tess_data['width'][i]
        word_center = word_x + word_w // 2
        word_conf = int(tess_data['conf'][i])
        
        # Assign to column
        for col_name, x1, x2 in column_zones:
            if x1 <= word_center < x2:
                tess_by_col[col_name].append((text, word_conf))
                break
    
    # Build Tesseract results per column
    tess_results = {}
    for col_name, _, _ in column_zones:
        words = tess_by_col[col_name]
        if words:
            text = ' '.join(w for w, c in words)
            avg_conf = sum(c for _, c in words) / len(words)
            tess_results[col_name] = (text, avg_conf)
        else:
            tess_results[col_name] = ('', 0)
    
    # Pass 2: EasyOCR per-cell for key fields
    field_types = {
        'serial_no': 'serial',
        'voter_name': 'name_kn',
        'relative_name': 'name_kn',
        'age': 'age',
        'voter_id': 'voter_id',
    }
    
    final_results = {}
    
    for col_name, x1, x2 in column_zones:
        tess_text, tess_conf = tess_results[col_name]
        
        if col_name in field_types:
            # Use ensemble for important fields
            cell_img = row_img[:, x1:x2]
            if cell_img.size > 0:
                ft = field_types[col_name]
                if ft == 'serial':
                    easy_result = easyocr_digit_ocr(cell_img)
                    tess_digits = ''.join(c for c in tess_text if c.isdigit())
                    final = ensemble_vote_digits([(tess_digits, tess_conf), easy_result])
                elif ft == 'age':
                    easy_result = easyocr_digit_ocr(cell_img)
                    tess_digits = ''.join(c for c in tess_text if c.isdigit())
                    final = ensemble_vote_digits([(tess_digits, tess_conf), easy_result], expected_len=2)
                elif ft == 'voter_id':
                    easy_result = easyocr_digit_ocr(cell_img)
                    tess_digits = ''.join(c for c in tess_text if c.isdigit())
                    final = ensemble_vote_digits([(tess_digits, tess_conf), easy_result], expected_len=6)
                elif ft == 'name_kn':
                    easy_result = easyocr_ocr(cell_img)
                    final = ensemble_kannada_name([(tess_text, tess_conf), easy_result])
                else:
                    final = (tess_text, tess_conf)
            else:
                final = (tess_text, tess_conf)
        else:
            # Use Tesseract only for gender, relation, house_no (context helps)
            final = (tess_text, tess_conf)
        
        final_results[col_name] = final
    
    return final_results
