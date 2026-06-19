"""
OCR Engine — Tesseract OCR execution with multi-pass strategies.
"""

import cv2
import numpy as np
from PIL import Image
import pytesseract
import re

# Load language setting from config
try:
    from config.settings import ocr_settings
    _DEFAULT_LANG = ocr_settings.LANG
except (ImportError, Exception):
    _DEFAULT_LANG = "kan+eng"

# Translation table: Kannada numerals (೦-೯) → ASCII digits (0-9)
_KANNADA_DIGITS = str.maketrans('೦೧೨೩೪೫೬೭೮೯', '0123456789')


def normalize_ocr_digits(text):
    """Normalize OCR text for digit extraction.

    Converts Kannada numerals and common OCR misreads to ASCII digits.
    """
    text = text.translate(_KANNADA_DIGITS)
    return text


def sauvola_threshold(gray, window_size=25, k=0.2):
    """Apply Sauvola local binarization for uneven lighting/faded text.

    Sauvola's method adapts the threshold per-pixel using local mean and
    standard deviation, which handles degraded scans better than OTSU.
    """
    h, w = gray.shape
    if h < window_size or w < window_size:
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return binary

    # Compute local mean and std using integral images
    gray_f = gray.astype(np.float64)
    mean = cv2.blur(gray_f, (window_size, window_size))
    mean_sq = cv2.blur(gray_f * gray_f, (window_size, window_size))
    std = np.sqrt(np.maximum(mean_sq - mean * mean, 0))

    # Sauvola threshold: T(x,y) = mean * (1 + k * (std/128 - 1))
    threshold = mean * (1.0 + k * (std / 128.0 - 1.0))
    binary = np.where(gray_f > threshold, 255, 0).astype(np.uint8)
    return binary


def preprocess_for_ocr(img_cell, target="text", scale=2):
    """Apply preprocessing to a cell image before OCR.

    Performs grayscale conversion, upscaling, OTSU binarization,
    and adds white border padding.
    
    Args:
        img_cell: Input cell image
        target: "text" or "digits"
        scale: Upscale factor (default 2, use 5 for aggressive re-OCR)
    """
    if len(img_cell.shape) == 3:
        gray = cv2.cvtColor(img_cell, cv2.COLOR_BGR2GRAY)
    else:
        gray = img_cell.copy()

    h, w = gray.shape
    gray = cv2.resize(gray, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    border_size = 10 + (scale * 2)
    binary = cv2.copyMakeBorder(binary, border_size, border_size, border_size, border_size,
                                cv2.BORDER_CONSTANT, value=255)
    return binary


def ocr_row(img_row, lang=None):
    """Run Tesseract OCR on a full table row image (PSM 6).

    Returns:
        list: Word dicts with keys: text, conf, x, w, x_center
    """
    if lang is None:
        lang = _DEFAULT_LANG
    if img_row.size == 0 or img_row.shape[0] < 10:
        return []

    rgb = cv2.cvtColor(img_row, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)
    config = '--psm 6 --oem 1'

    try:
        data = pytesseract.image_to_data(pil_img, lang=lang, config=config,
                                         output_type=pytesseract.Output.DICT)
        words = []
        for i in range(len(data["text"])):
            text = data["text"][i].strip()
            if text and data["conf"][i] > 0:
                # Normalize Kannada numerals in all text
                text = normalize_ocr_digits(text)
                words.append({
                    "text": text,
                    "conf": int(data["conf"][i]),
                    "x": data["left"][i],
                    "w": data["width"][i],
                    "x_center": data["left"][i] + data["width"][i] // 2,
                })
        return words
    except Exception:
        return []


def ocr_cell_targeted(img_cell, mode="digits"):
    """Run targeted OCR on a single cell with preprocessing.

    Args:
        img_cell: BGR image of the cell
        mode: "digits" (digit whitelist) or "text" (kan+eng)

    Returns:
        tuple: (extracted_text, average_confidence)
    """
    if img_cell.size == 0 or img_cell.shape[0] < 5 or img_cell.shape[1] < 5:
        return "", 0

    preprocessed = preprocess_for_ocr(img_cell, target=mode)
    pil_img = Image.fromarray(preprocessed)

    if mode == "digits":
        config = '--psm 7 --oem 1 -c tessedit_char_whitelist=0123456789 -c load_system_dawg=false -c load_freq_dawg=false'
        lang = "eng"
    else:
        config = '--psm 7 --oem 1'
        lang = _DEFAULT_LANG

    try:
        data = pytesseract.image_to_data(pil_img, lang=lang, config=config,
                                         output_type=pytesseract.Output.DICT)
        texts = []
        confs = []
        for i in range(len(data["text"])):
            text = data["text"][i].strip()
            if text and data["conf"][i] > 0:
                texts.append(text)
                confs.append(int(data["conf"][i]))

        result_text = " ".join(texts)
        # Normalize Kannada numerals in digit mode
        if mode == "digits":
            result_text = normalize_ocr_digits(result_text)
        avg_confidence = float(np.mean(confs)) if confs else 0.0
        return result_text, avg_confidence
    except Exception:
        return "", 0


def ocr_cell_multipass(img_cell, mode="digits"):
    """Try multiple OCR strategies and return the highest confidence result.

    Strategy 1: Standard preprocessing (OTSU, 2x upscale)
    Strategy 2: Adaptive Gaussian threshold (3x upscale)
    Strategy 3: Inverted image (digits only, for dark backgrounds)
    Strategy 4: Sauvola binarization (5x upscale) — best for faded/degraded text
    Strategy 5: LSTM-only mode (--oem 1) with 5x Sauvola — fallback for ligatures
    """
    results = []

    if img_cell.size == 0 or img_cell.shape[0] < 5 or img_cell.shape[1] < 5:
        return "", 0

    # Strategy 1: Direct OCR with preprocessing
    text1, conf1 = ocr_cell_targeted(img_cell, mode)
    if text1:
        results.append((text1, conf1))

    # Strategy 2: Adaptive threshold
    if len(img_cell.shape) == 3:
        gray = cv2.cvtColor(img_cell, cv2.COLOR_BGR2GRAY)
    else:
        gray = img_cell.copy()

    h, w = gray.shape
    gray2 = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    binary2 = cv2.adaptiveThreshold(gray2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY, 31, 10)
    border = 15
    binary2 = cv2.copyMakeBorder(binary2, border, border, border, border,
                                 cv2.BORDER_CONSTANT, value=255)

    pil_img2 = Image.fromarray(binary2)
    if mode == "digits":
        config2 = '--psm 7 --oem 1 -c tessedit_char_whitelist=0123456789 -c load_system_dawg=false -c load_freq_dawg=false'
        lang2 = "eng"
    else:
        config2 = '--psm 7 --oem 1'
        lang2 = _DEFAULT_LANG

    try:
        data2 = pytesseract.image_to_data(pil_img2, lang=lang2, config=config2,
                                          output_type=pytesseract.Output.DICT)
        texts2 = []
        confs2 = []
        for i in range(len(data2["text"])):
            text = data2["text"][i].strip()
            if text and data2["conf"][i] > 0:
                texts2.append(text)
                confs2.append(int(data2["conf"][i]))

        text2 = " ".join(texts2)
        conf2 = float(np.mean(confs2)) if confs2 else 0.0
        if text2:
            results.append((text2, conf2))
    except Exception:
        pass

    # Strategy 3: Inverted (dark background)
    if mode == "digits" and not results:
        inv = cv2.bitwise_not(gray)
        inv = cv2.resize(inv, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
        _, binary3 = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        binary3 = cv2.copyMakeBorder(binary3, border, border, border, border,
                                     cv2.BORDER_CONSTANT, value=255)
        pil_img3 = Image.fromarray(binary3)
        try:
            data3 = pytesseract.image_to_data(pil_img3, lang="eng", config=config2,
                                              output_type=pytesseract.Output.DICT)
            texts3 = [data3["text"][i].strip() for i in range(len(data3["text"]))
                      if data3["text"][i].strip() and data3["conf"][i] > 0]
            confs3 = [int(data3["conf"][i]) for i in range(len(data3["text"]))
                      if data3["text"][i].strip() and data3["conf"][i] > 0]
            text3 = " ".join(texts3)
            conf3 = float(np.mean(confs3)) if confs3 else 0.0
            if text3:
                results.append((text3, conf3))
        except Exception:
            pass

    # Strategy 4: Sauvola binarization with 5x upscale (best for faded/degraded text)
    gray5x = cv2.resize(gray, (w * 5, h * 5), interpolation=cv2.INTER_CUBIC)
    sauvola_bin = sauvola_threshold(gray5x, window_size=35, k=0.2)
    sauvola_bin = cv2.copyMakeBorder(sauvola_bin, 20, 20, 20, 20,
                                     cv2.BORDER_CONSTANT, value=255)
    pil_sauvola = Image.fromarray(sauvola_bin)

    if mode == "digits":
        config4 = '--psm 7 --oem 1 -c tessedit_char_whitelist=0123456789 -c load_system_dawg=false -c load_freq_dawg=false'
        lang4 = "eng"
    else:
        config4 = '--psm 7 --oem 1'
        lang4 = "kan+eng"

    try:
        data4 = pytesseract.image_to_data(pil_sauvola, lang=lang4, config=config4,
                                          output_type=pytesseract.Output.DICT)
        texts4 = []
        confs4 = []
        for i in range(len(data4["text"])):
            text = data4["text"][i].strip()
            if text and data4["conf"][i] > 0:
                texts4.append(text)
                confs4.append(int(data4["conf"][i]))
        text4 = " ".join(texts4)
        conf4 = float(np.mean(confs4)) if confs4 else 0.0
        if text4:
            results.append((text4, conf4))
    except Exception:
        pass

    # Strategy 5: PSM 6 (full block) with Sauvola for text mode — catches multi-word names
    if mode == "text" and (not results or max(r[1] for r in results) < 70):
        try:
            config5 = '--psm 6 --oem 1'
            data5 = pytesseract.image_to_data(pil_sauvola, lang="kan+eng", config=config5,
                                              output_type=pytesseract.Output.DICT)
            texts5 = []
            confs5 = []
            for i in range(len(data5["text"])):
                text = data5["text"][i].strip()
                if text and data5["conf"][i] > 0:
                    texts5.append(text)
                    confs5.append(int(data5["conf"][i]))
            text5 = " ".join(texts5)
            conf5 = float(np.mean(confs5)) if confs5 else 0.0
            if text5:
                results.append((text5, conf5))
        except Exception:
            pass

    if not results:
        return "", 0

    results.sort(key=lambda x: x[1], reverse=True)
    return results[0]
