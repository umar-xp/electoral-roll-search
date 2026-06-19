"""
Multi-Strategy OCR for Maximum Accuracy
==========================================
Author: Mohammed Shoaib U

Instead of multiple OCR engines (EasyOCR is worse), use:
1. Multiple PREPROCESSING strategies with same Tesseract
2. 600 DPI for numeric fields (voter ID, serial, age)
3. Confidence-based selection between strategies
4. Post-correction using field constraints

This gives better results because Tesseract full-row PSM 6 is already
the best engine for these scanned Kannada documents.
"""
import cv2
import numpy as np
import pytesseract
import re
from typing import Tuple, List

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import ocr_settings

pytesseract.pytesseract.tesseract_cmd = ocr_settings.TESSERACT_CMD
TESSDATA = ocr_settings.TESSDATA_DIR


# ===== PREPROCESSING STRATEGIES =====

def preprocess_otsu(gray):
    """Standard OTSU thresholding."""
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary

def preprocess_adaptive(gray):
    """Adaptive Gaussian thresholding (better for uneven illumination)."""
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY, 31, 10)
    return binary

def preprocess_sauvola(gray, window_size=25, k=0.2):
    """Sauvola thresholding (best for document images)."""
    # Calculate local mean and std
    mean = cv2.blur(gray.astype(np.float64), (window_size, window_size))
    sq_mean = cv2.blur((gray.astype(np.float64))**2, (window_size, window_size))
    std = np.sqrt(np.maximum(sq_mean - mean**2, 0))
    
    threshold = mean * (1.0 + k * (std / 128.0 - 1.0))
    binary = np.where(gray > threshold, 255, 0).astype(np.uint8)
    return binary

def preprocess_contrast(gray):
    """CLAHE contrast enhancement + OTSU."""
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


# ===== MULTI-STRATEGY OCR =====

def ocr_multi_strategy(gray, lang='kan+eng', psm=6, whitelist=''):
    """Run Tesseract with multiple preprocessing strategies, pick best result."""
    strategies = [
        ('raw', gray),  # No preprocessing - let Tesseract handle it
        ('otsu', preprocess_otsu(gray)),
        ('adaptive', preprocess_adaptive(gray)),
        ('contrast', preprocess_contrast(gray)),
    ]
    
    config_base = f'--psm {psm}'
    if whitelist:
        config_base += f' -c tessedit_char_whitelist={whitelist}'
    
    best_text = ''
    best_conf = 0
    best_strategy = ''
    
    for name, img in strategies:
        try:
            data = pytesseract.image_to_data(img, lang=lang, config=config_base,
                                              output_type=pytesseract.Output.DICT)
            words = []
            confs = []
            for i, text in enumerate(data['text']):
                text = text.strip()
                conf = int(data['conf'][i])
                if text and conf > 0:
                    words.append(text)
                    confs.append(conf)
            
            if words:
                result_text = ' '.join(words)
                avg_conf = sum(confs) / len(confs)
                
                if avg_conf > best_conf:
                    best_text = result_text
                    best_conf = avg_conf
                    best_strategy = name
        except Exception:
            continue
    
    return best_text, best_conf, best_strategy


def ocr_digits_high_res(img_bgr, scale_factor=2.0):
    """OCR digits at higher effective resolution.
    
    Upscale the image and use digit-only whitelist.
    """
    if img_bgr.size == 0:
        return '', 0
    
    # Upscale
    h, w = img_bgr.shape[:2]
    new_w = int(w * scale_factor)
    new_h = int(h * scale_factor)
    upscaled = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
    
    # Multiple strategies for digits
    results = []
    
    for preprocess in [preprocess_otsu, preprocess_adaptive, preprocess_contrast]:
        binary = preprocess(gray)
        config = f'--psm 7 -c tessedit_char_whitelist=0123456789'
        try:
            data = pytesseract.image_to_data(binary, lang='eng', config=config,
                                              output_type=pytesseract.Output.DICT)
            words = []
            confs = []
            for i, text in enumerate(data['text']):
                digits = ''.join(c for c in text.strip() if c.isdigit())
                conf = int(data['conf'][i])
                if digits and conf > 0:
                    words.append(digits)
                    confs.append(conf)
            
            if words:
                result = ''.join(words)
                avg_conf = sum(confs) / len(confs)
                results.append((result, avg_conf))
        except Exception:
            continue
    
    if not results:
        return '', 0
    
    # Majority vote if multiple results
    if len(results) >= 2:
        # If majority agree, use that
        from collections import Counter
        texts = [r[0] for r in results]
        counts = Counter(texts)
        most_common, count = counts.most_common(1)[0]
        if count >= 2:
            conf = max(c for t, c in results if t == most_common)
            return most_common, min(99, conf + 5)
    
    # Fall back to highest confidence
    results.sort(key=lambda x: x[1], reverse=True)
    return results[0]


# ===== FIELD-SPECIFIC POST-CORRECTION =====

def correct_serial(text, expected_range=None):
    """Post-correct serial number."""
    digits = ''.join(c for c in text if c.isdigit())
    if not digits:
        return ''
    val = int(digits)
    if expected_range and not (expected_range[0] <= val <= expected_range[1]):
        return ''  # Out of range, likely garbled
    return digits


def correct_age(text):
    """Post-correct age field."""
    digits = ''.join(c for c in text if c.isdigit())
    if not digits:
        return ''
    val = int(digits)
    if 18 <= val <= 99:
        return str(val)
    # Try last 2 digits if we got extra
    if len(digits) > 2:
        val2 = int(digits[-2:])
        if 18 <= val2 <= 99:
            return str(val2)
    # Try first 2 digits
    if len(digits) >= 2:
        val2 = int(digits[:2])
        if 18 <= val2 <= 99:
            return str(val2)
    return ''


def correct_voter_id(text):
    """Post-correct voter ID (should be exactly 6 digits)."""
    digits = ''.join(c for c in text if c.isdigit())
    if len(digits) == 6:
        return digits
    if len(digits) == 7:
        # Common OCR error: extra digit. Try removing first or last
        # If first digit is 1 (common leading noise), remove it
        if digits[0] == '1':
            return digits[1:]
        return digits[:6]
    if len(digits) == 5:
        # Missing one digit - can't reliably fix
        return digits
    return ''


def correct_kannada_name(text):
    """Post-correct Kannada name: remove English garbage, fix ZWNJs."""
    if not text:
        return ''
    
    # Remove common OCR garbage patterns
    text = re.sub(r'\b(Oe|mend|ow|ee|aa|oo)\b', '', text)
    # Remove isolated English characters (single a-z not part of abbreviation)
    text = re.sub(r'(?<!\w)[a-z](?!\w)', '', text)
    # Clean excessive whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    # Remove trailing punctuation that's not Kannada
    text = re.sub(r'[.\-,;:]+$', '', text).strip()
    
    return text


# ===== INTEGRATED ENHANCED OCR =====

def enhanced_ocr_row(row_img, column_zones, dpi=300):
    """Enhanced OCR for a row using multi-strategy + field correction.
    
    This replaces the single-pass Tesseract in the main pipeline.
    """
    gray = cv2.cvtColor(row_img, cv2.COLOR_BGR2GRAY)
    
    # Full-row OCR with best strategy (for context)
    full_text, full_conf, strategy = ocr_multi_strategy(gray, lang='kan+eng', psm=6)
    
    # Also get word-level data with the best strategy
    if strategy == 'raw':
        proc_img = gray
    elif strategy == 'otsu':
        proc_img = preprocess_otsu(gray)
    elif strategy == 'adaptive':
        proc_img = preprocess_adaptive(gray)
    elif strategy == 'contrast':
        proc_img = preprocess_contrast(gray)
    else:
        proc_img = gray
    
    config = f'--psm 6'
    data = pytesseract.image_to_data(proc_img, lang='kan+eng', config=config,
                                      output_type=pytesseract.Output.DICT)
    
    # Assign words to columns
    col_results = {name: [] for name, _, _ in column_zones}
    for i, text in enumerate(data['text']):
        text = text.strip()
        conf = int(data['conf'][i])
        if not text or conf <= 0:
            continue
        
        word_x = data['left'][i]
        word_w = data['width'][i]
        word_center = word_x + word_w // 2
        
        for col_name, x1, x2 in column_zones:
            if x1 <= word_center < x2:
                col_results[col_name].append((text, conf))
                break
    
    # Build initial results
    results = {}
    for col_name, x1, x2 in column_zones:
        words = col_results[col_name]
        if words:
            text = ' '.join(w for w, c in words)
            avg_conf = sum(c for _, c in words) / len(words)
        else:
            text = ''
            avg_conf = 0
        results[col_name] = (text, avg_conf)
    
    # ENHANCE numeric fields with high-res digit OCR
    for field in ['serial_no', 'age', 'voter_id']:
        curr_text, curr_conf = results[field]
        
        # Find column bounds
        for col_name, x1, x2 in column_zones:
            if col_name == field:
                cell_img = row_img[:, x1:x2]
                break
        
        # High-res digit OCR
        if cell_img.size > 0:
            hires_text, hires_conf = ocr_digits_high_res(cell_img)
            
            # Pick the best digit result
            curr_digits = ''.join(c for c in curr_text if c.isdigit())
            
            if hires_text and hires_conf > curr_conf:
                results[field] = (hires_text, hires_conf)
            elif curr_digits:
                results[field] = (curr_digits, curr_conf)
    
    # Apply field-specific corrections
    sn_text, sn_conf = results.get('serial_no', ('', 0))
    results['serial_no'] = (correct_serial(sn_text), sn_conf)
    
    age_text, age_conf = results.get('age', ('', 0))
    results['age'] = (correct_age(age_text), age_conf)
    
    vid_text, vid_conf = results.get('voter_id', ('', 0))
    results['voter_id'] = (correct_voter_id(vid_text), vid_conf)
    
    # Correct Kannada names
    for field in ['voter_name', 'relative_name']:
        text, conf = results.get(field, ('', 0))
        results[field] = (correct_kannada_name(text), conf)
    
    return results
