"""
Repair Passes — Multi-pass targeted re-OCR and sequential repair logic.
Includes Sauvola binarization, 5x aggressive re-OCR, and name dictionary repair.
"""

import re
import cv2
import numpy as np

from .ocr_engine import ocr_cell_multipass, ocr_cell_targeted, sauvola_threshold
from .field_cleaners import clean_name

# Column pixel boundaries at 300 DPI (imported from centralized config if available)
try:
    from config.settings import ocr_settings
    _zones = {name: (x1, x2) for name, x1, x2 in ocr_settings.COLUMN_ZONES}
except ImportError:
    _zones = {
        "serial_no": (0, 250),
        "voter_name": (510, 970),
        "age": (1840, 2040),
        "voter_id": (2000, 2500),
    }

_AGE_X1 = _zones.get("age", (1840, 2040))[0]
_AGE_X2 = _zones.get("age", (1840, 2040))[1]
_SERIAL_X1 = _zones.get("serial_no", (0, 260))[0]
_SERIAL_X2 = max(_zones.get("serial_no", (0, 260))[1], 260)
_NAME_X1 = _zones.get("voter_name", (510, 970))[0]
_NAME_X2 = _zones.get("voter_name", (510, 970))[1]
_VID_X1 = _zones.get("voter_id", (2000, 2500))[0]
_VID_X2 = _zones.get("voter_id", (2000, 2500))[1]


def reocr_age(img_page, row_y1, row_y2):
    """Re-OCR the age column for a specific row."""
    cell = img_page[row_y1:row_y2, _AGE_X1:_AGE_X2]
    if cell.size == 0:
        return "", 0
    text, conf = ocr_cell_multipass(cell, mode="digits")
    digits = re.sub(r'[^\d]', '', text)
    return digits, conf


def reocr_serial(img_page, row_y1, row_y2):
    """Re-OCR the serial number column."""
    cell = img_page[row_y1:row_y2, _SERIAL_X1:_SERIAL_X2]
    if cell.size == 0:
        return "", 0
    text, conf = ocr_cell_multipass(cell, mode="digits")
    digits = re.sub(r'[^\d]', '', text)
    return digits, conf


def reocr_name(img_page, row_y1, row_y2):
    """Re-OCR the voter name column."""
    cell = img_page[row_y1:row_y2, _NAME_X1:_NAME_X2]
    if cell.size == 0:
        return "", 0
    text, conf = ocr_cell_targeted(cell, mode="text")
    return text, conf


def reocr_voter_id(img_page, row_y1, row_y2):
    """Re-OCR voter ID column using dual-strategy approach.
    
    Attempts to extract full EPIC format (e.g., WPR1234567) first,
    falls back to digit-only extraction.
    """
    import pytesseract
    from PIL import Image
    from .field_cleaners import clean_voter_id

    cell = img_page[row_y1:row_y2, _VID_X1:_VID_X2]
    if cell.size == 0:
        return "", 0

    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell.copy()
    h, w = gray.shape

    # Blank cell detection: skip expensive OCR if cell is nearly empty
    _, bin_check = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
    dark_ratio = np.count_nonzero(bin_check) / (h * w) if (h * w) > 0 else 0
    if dark_ratio < 0.02:
        return "", 0

    # Strategy 1: Full-text OCR (eng PSM 7) to capture EPIC prefix + digits
    scaled = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    _, binary = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    border = 15
    binary = cv2.copyMakeBorder(binary, border, border, border, border,
                                cv2.BORDER_CONSTANT, value=255)
    pil_img = Image.fromarray(binary)

    try:
        data = pytesseract.image_to_data(pil_img, lang="eng", config='--psm 7 --oem 1',
                                         output_type=pytesseract.Output.DICT)
        all_text = ""
        confs = []
        for i in range(len(data["text"])):
            t = data["text"][i].strip()
            if t and data["conf"][i] > 0:
                all_text += t
                confs.append(int(data["conf"][i]))
        conf = float(np.mean(confs)) if confs else 0.0
        epic = clean_voter_id(all_text)
        if epic and len(epic) >= 5:
            return epic, conf
    except Exception:
        pass

    # Strategy 2: Digit-only multipass (fallback)
    text, conf = ocr_cell_multipass(cell, mode="digits")
    digits = re.sub(r'[^\d]', '', text)
    if len(digits) >= 5:
        return digits[:7] if len(digits) >= 7 else digits[:6], conf

    return "", 0


def repair_serials(voters):
    """Repair serial numbers using sequential monotonic constraint."""
    if not voters:
        return voters

    valid_serials = []
    for i, v in enumerate(voters):
        sn = v.get("serial_no", "")
        if sn and sn.isdigit():
            val = int(sn)
            if 1 <= val <= 99999:
                valid_serials.append((i, val))

    if not valid_serials:
        return voters

    first_valid_idx, first_valid_sn = valid_serials[0]

    if len(valid_serials) >= 2:
        strides = []
        for j in range(min(len(valid_serials) - 1, 5)):
            idx1, sn1 = valid_serials[j]
            idx2, sn2 = valid_serials[j + 1]
            gap_voters = idx2 - idx1
            gap_serial = sn2 - sn1
            if gap_voters > 0 and gap_serial > 0:
                stride = gap_serial / gap_voters
                if 0.8 <= stride <= 1.2:
                    strides.append((idx1, sn1))

        if strides:
            first_valid_idx, first_valid_sn = strides[0]

    expected_start = first_valid_sn - first_valid_idx

    for i, v in enumerate(voters):
        expected = expected_start + i
        current_sn = v.get("serial_no", "")

        if not current_sn or not current_sn.isdigit():
            v["serial_no"] = str(expected)
            v["serial_repaired"] = True
        else:
            current_val = int(current_sn)
            if abs(current_val - expected) > 2:
                expected_str = str(expected)
                if len(current_sn) > len(expected_str):
                    v["serial_no"] = str(expected)
                    v["serial_repaired"] = True
                elif current_val > expected + 5:
                    v["serial_no"] = str(expected)
                    v["serial_repaired"] = True
                elif current_val < expected - 5:
                    v["serial_no"] = str(expected)
                    v["serial_repaired"] = True

    return voters


def repair_ages(voters, img_page, boundaries, row_indices):
    """Repair suspicious ages using targeted re-OCR and neighbor estimation.
    
    Enhanced with:
    - Detection of age<->gender column drift (swap check)
    - Better neighbor interpolation
    - Invalid age cleanup (returns empty instead of bad values)
    """
    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        age = v.get("age", "")
        age_conf = v.get("conf", {}).get("age", 100)

        needs_reocr = False
        if age and age.isdigit() and int(age) < 18:
            needs_reocr = True
        elif age and age.isdigit() and int(age) > 120:
            needs_reocr = True
        elif age_conf < 60 and age:
            needs_reocr = True
        elif not age:
            needs_reocr = True

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_age, new_conf = reocr_age(img_page, y1, y2)

            check_val = new_age if new_age else age
            if not check_val or not check_val.isdigit():
                v["age"] = ""
                v["age_repaired"] = True
                continue

            int_val = int(check_val)

            if 18 <= int_val <= 120:
                v["age"] = str(int_val)
                if new_age:
                    v["conf"]["age"] = round(new_conf, 1)
                v["age_repaired"] = True
            elif int_val < 18:
                # Try neighbor-based estimation
                neighbor_ages = []
                for nv in voters[max(0, voter_idx - 3):voter_idx + 4]:
                    if nv is v:
                        continue
                    na = nv.get("age", "")
                    if na and na.isdigit() and 18 <= int(na) <= 120:
                        neighbor_ages.append(int(na))
                if neighbor_ages:
                    avg_neighbor = int(np.mean(neighbor_ages))
                    ones_digit = int_val % 10
                    estimated = (avg_neighbor // 10) * 10 + ones_digit
                    if estimated < 18:
                        estimated += 10
                    if 18 <= estimated <= 120:
                        v["age"] = str(estimated)
                        v["age_repaired"] = True
                        v["age_estimated"] = True
                    else:
                        v["age"] = ""
                        v["age_repaired"] = True
                else:
                    v["age"] = ""
                    v["age_repaired"] = True
            else:
                v["age"] = ""
                v["age_repaired"] = True

    return voters


def repair_names(voters, img_page, boundaries, row_indices):
    """Re-OCR voter names that are empty or have very low confidence."""
    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        name = v.get("voter_name", "")
        name_conf = v.get("conf", {}).get("voter_name", 100)

        needs_reocr = (not name) or (name_conf < 50)

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_name, new_conf = reocr_name(img_page, y1, y2)
            new_name = clean_name(new_name)

            if new_name and (not name or new_conf > name_conf):
                v["voter_name"] = new_name
                v["conf"]["voter_name"] = round(new_conf, 1)
                v["name_repaired"] = True

    return voters


def repair_voter_ids(voters, img_page, boundaries, row_indices):
    """Re-OCR voter IDs that are empty, wrong length, or low confidence."""
    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        vid = v.get("voter_id", "")
        vid_conf = v.get("conf", {}).get("voter_id", 100)

        needs_reocr = (not vid) or (vid and len(vid) < 5) or (vid_conf < 40)

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_vid, new_conf = reocr_voter_id(img_page, y1, y2)

            if new_vid and len(new_vid) >= 5:
                if not vid or new_conf > vid_conf:
                    v["voter_id"] = new_vid
                    v["conf"]["voter_id"] = round(new_conf, 1)
                    v["vid_repaired"] = True

    return voters


def repair_serial_reocr(voters, img_page, boundaries, row_indices):
    """Re-OCR serial numbers that are empty, non-numeric, or low confidence."""
    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        sn = v.get("serial_no", "")
        sn_conf = v.get("conf", {}).get("serial_no", 100)

        needs_reocr = (not sn) or (not sn.isdigit()) or (sn_conf < 40)

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_sn, new_conf = reocr_serial(img_page, y1, y2)

            if new_sn:
                new_val = int(new_sn) if new_sn.isdigit() else 0
                if 1 <= new_val <= 9999:
                    v["serial_no"] = str(new_val)
                    v["conf"]["serial_no"] = round(new_conf, 1)
                    v["serial_reocr"] = True

    return voters


# ============================================================
# ENHANCED PASS: Sauvola-based aggressive re-OCR for names
# ============================================================

def reocr_name_aggressive(img_page, row_y1, row_y2):
    """Re-OCR voter name with Sauvola binarization and 5x upscale.

    This is the nuclear option for names that failed standard re-OCR.
    Uses Sauvola local thresholding which handles degraded/faded text
    much better than global OTSU.
    """
    from PIL import Image
    import pytesseract

    cell = img_page[row_y1:row_y2, _NAME_X1:_NAME_X2]
    if cell.size == 0:
        return "", 0

    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell.copy()
    h, w = gray.shape

    # 5x upscale with cubic interpolation
    gray5x = cv2.resize(gray, (w * 5, h * 5), interpolation=cv2.INTER_CUBIC)

    # Sauvola binarization (much better for faded/uneven text)
    binary = sauvola_threshold(gray5x, window_size=35, k=0.2)

    # Add generous border
    binary = cv2.copyMakeBorder(binary, 20, 20, 20, 20,
                                cv2.BORDER_CONSTANT, value=255)

    pil_img = Image.fromarray(binary)

    best_text = ""
    best_conf = 0.0

    # Try PSM 7 (single line) and PSM 6 (block) with LSTM
    for psm in [7, 6]:
        try:
            config = f'--psm {psm} --oem 1'
            data = pytesseract.image_to_data(pil_img, lang="kan+eng", config=config,
                                             output_type=pytesseract.Output.DICT)
            texts = []
            confs = []
            for i in range(len(data["text"])):
                t = data["text"][i].strip()
                if t and data["conf"][i] > 0:
                    texts.append(t)
                    confs.append(int(data["conf"][i]))
            text = " ".join(texts)
            conf = float(np.mean(confs)) if confs else 0.0
            if text and conf > best_conf:
                best_text = text
                best_conf = conf
        except Exception:
            pass

    return best_text, best_conf


def reocr_relative_name_aggressive(img_page, row_y1, row_y2):
    """Re-OCR relative name with Sauvola binarization and 5x upscale."""
    from PIL import Image
    import pytesseract

    # Relative name column boundaries
    rel_x1 = _zones.get("relative_name", (1160, 1700))[0]
    rel_x2 = _zones.get("relative_name", (1160, 1700))[1]

    cell = img_page[row_y1:row_y2, rel_x1:rel_x2]
    if cell.size == 0:
        return "", 0

    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell.copy()
    h, w = gray.shape

    gray5x = cv2.resize(gray, (w * 5, h * 5), interpolation=cv2.INTER_CUBIC)
    binary = sauvola_threshold(gray5x, window_size=35, k=0.2)
    binary = cv2.copyMakeBorder(binary, 20, 20, 20, 20,
                                cv2.BORDER_CONSTANT, value=255)

    pil_img = Image.fromarray(binary)

    best_text = ""
    best_conf = 0.0

    for psm in [7, 6]:
        try:
            config = f'--psm {psm} --oem 1'
            data = pytesseract.image_to_data(pil_img, lang="kan+eng", config=config,
                                             output_type=pytesseract.Output.DICT)
            texts = []
            confs = []
            for i in range(len(data["text"])):
                t = data["text"][i].strip()
                if t and data["conf"][i] > 0:
                    texts.append(t)
                    confs.append(int(data["conf"][i]))
            text = " ".join(texts)
            conf = float(np.mean(confs)) if confs else 0.0
            if text and conf > best_conf:
                best_text = text
                best_conf = conf
        except Exception:
            pass

    return best_text, best_conf


def repair_names_aggressive(voters, img_page, boundaries, row_indices):
    """Enhanced name repair: re-OCR with 5x Sauvola for low-confidence names."""
    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        name = v.get("voter_name", "")
        name_conf = v.get("conf", {}).get("voter_name", 100)

        # More aggressive threshold: re-OCR if confidence < 70 (was 50)
        needs_reocr = (not name) or (name_conf < 70) or (len(name.strip()) < 3)

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_name, new_conf = reocr_name_aggressive(img_page, y1, y2)
            new_name = clean_name(new_name)

            if new_name and len(new_name.strip()) >= 2:
                if (not name) or (new_conf > name_conf):
                    v["voter_name"] = new_name
                    v["conf"]["voter_name"] = round(new_conf, 1)
                    v["name_repaired"] = True

        # Also fix relative names with low confidence
        rel_name = v.get("relative_name", "")
        rel_conf = v.get("conf", {}).get("relative_name", 100)

        rel_needs_reocr = (not rel_name) or (rel_conf < 70) or (len(rel_name.strip()) < 2)

        if rel_needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            new_rel, new_rel_conf = reocr_relative_name_aggressive(img_page, y1, y2)
            new_rel = clean_name(new_rel)

            if new_rel and len(new_rel.strip()) >= 2:
                if (not rel_name) or (new_rel_conf > rel_conf):
                    v["relative_name"] = new_rel
                    v["conf"]["relative_name"] = round(new_rel_conf, 1)

    return voters


# ============================================================
# ENHANCED PASS: Voter ID pattern-based repair
# ============================================================

_VOTER_ID_PATTERN = re.compile(r'^\d{5,6}$')

# Karnataka voter ID format: typically 6 digits, sometimes with leading zeros stripped to 5
_KA_VOTER_ID_LOOSE = re.compile(r'\d{5,7}')


def repair_voter_ids_enhanced(voters, img_page, boundaries, row_indices):
    """Enhanced voter ID repair with full EPIC pattern support.

    Karnataka voter IDs follow EPIC format: 2-3 uppercase letters + 7 digits
    (e.g., WPR1234567). Uses multiple strategies:
      1. Full-text OCR (kan+eng) to capture alpha prefix + digits
      2. Morphological closing to connect broken/faint strokes
      3. Sauvola + digit whitelist for numeric part
      4. CLAHE contrast enhancement for very faint text
    """
    from PIL import Image
    import pytesseract
    from .field_cleaners import clean_voter_id

    _EPIC_RE = re.compile(r'[A-Z]{2,3}\d{7}')

    for voter_idx, (v, row_idx) in enumerate(zip(voters, row_indices)):
        vid = v.get("voter_id", "")
        vid_conf = v.get("conf", {}).get("voter_id", 100)

        # Re-OCR if: empty, too short, or low confidence
        needs_reocr = (not vid) or (len(vid) < 5) or (vid_conf < 50)

        if needs_reocr and row_idx < len(boundaries) - 1:
            y1 = boundaries[row_idx]
            y2 = boundaries[row_idx + 1]

            cell = img_page[y1:y2, _VID_X1:_VID_X2]
            if cell.size == 0:
                continue

            gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if len(cell.shape) == 3 else cell.copy()
            h, w = gray.shape

            # Blank cell detection: skip expensive OCR if cell is nearly empty
            # Threshold to binary, count dark pixels
            _, bin_check = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
            dark_ratio = np.count_nonzero(bin_check) / (h * w) if (h * w) > 0 else 0
            if dark_ratio < 0.02:
                # Less than 2% dark pixels = effectively blank cell, skip OCR
                continue

            best_vid = ""
            best_conf = 0.0

            # Strategy 1: Full-text OCR to capture EPIC prefix (e.g., "WPR1234567")
            # Use morphological closing to connect faint/broken strokes
            gray4x = cv2.resize(gray, (w * 4, h * 4), interpolation=cv2.INTER_CUBIC)
            _, binary_full = cv2.threshold(gray4x, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            # Morphological closing: connect broken strokes in faint text
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
            binary_full = cv2.morphologyEx(binary_full, cv2.MORPH_CLOSE, kernel)
            binary_full = cv2.copyMakeBorder(binary_full, 15, 15, 15, 15,
                                             cv2.BORDER_CONSTANT, value=255)
            pil_full = Image.fromarray(binary_full)

            try:
                config_full = '--psm 7 --oem 1'
                data_f = pytesseract.image_to_data(pil_full, lang="eng",
                                                   config=config_full,
                                                   output_type=pytesseract.Output.DICT)
                all_text = ""
                confs_f = []
                for i in range(len(data_f["text"])):
                    t = data_f["text"][i].strip()
                    if t and data_f["conf"][i] > 0:
                        all_text += t
                        confs_f.append(int(data_f["conf"][i]))
                conf_f = float(np.mean(confs_f)) if confs_f else 0.0

                # Try EPIC extraction from full text
                epic_cleaned = clean_voter_id(all_text)
                if epic_cleaned and len(epic_cleaned) >= 5:
                    best_vid = epic_cleaned
                    best_conf = conf_f
            except Exception:
                pass

            # Strategy 2: Sauvola 5x with digit whitelist (numeric fallback)
            if not best_vid or len(best_vid) < 7:
                gray5x = cv2.resize(gray, (w * 5, h * 5), interpolation=cv2.INTER_CUBIC)
                binary_s = sauvola_threshold(gray5x, window_size=35, k=0.2)
                # Morphological closing on Sauvola output
                binary_s = cv2.morphologyEx(binary_s, cv2.MORPH_CLOSE, kernel)
                binary_s = cv2.copyMakeBorder(binary_s, 20, 20, 20, 20,
                                              cv2.BORDER_CONSTANT, value=255)
                pil_s = Image.fromarray(binary_s)
                config_d = '--psm 7 --oem 1 -c tessedit_char_whitelist=0123456789 -c load_system_dawg=false -c load_freq_dawg=false'

                try:
                    data_s = pytesseract.image_to_data(pil_s, lang="eng", config=config_d,
                                                      output_type=pytesseract.Output.DICT)
                    all_digits = ""
                    confs_s = []
                    for i in range(len(data_s["text"])):
                        t = data_s["text"][i].strip()
                        if t and data_s["conf"][i] > 0:
                            all_digits += re.sub(r'[^\d]', '', t)
                            confs_s.append(int(data_s["conf"][i]))
                    conf_s = float(np.mean(confs_s)) if confs_s else 0.0
                    if len(all_digits) >= 5 and conf_s > best_conf:
                        best_vid = all_digits[:7] if len(all_digits) >= 7 else all_digits[:6]
                        best_conf = conf_s
                except Exception:
                    pass

            # Strategy 3: CLAHE + OTSU for very faint IDs (skip only truly blank cells)
            if not best_vid and dark_ratio >= 0.02:
                try:
                    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
                    enhanced = clahe.apply(gray)
                    scaled = cv2.resize(enhanced, (w * 4, h * 4), interpolation=cv2.INTER_CUBIC)
                    _, binary2 = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                    # Dilation to thicken faint strokes
                    kern2 = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 1))
                    binary2 = cv2.dilate(binary2, kern2, iterations=1)
                    binary2 = cv2.copyMakeBorder(binary2, 15, 15, 15, 15,
                                                 cv2.BORDER_CONSTANT, value=255)
                    pil_img2 = Image.fromarray(binary2)
                    # Try full text first for EPIC
                    data2 = pytesseract.image_to_data(pil_img2, lang="eng",
                                                     config='--psm 7 --oem 1',
                                                     output_type=pytesseract.Output.DICT)
                    all_text2 = ""
                    confs2 = []
                    for i in range(len(data2["text"])):
                        t = data2["text"][i].strip()
                        if t and data2["conf"][i] > 0:
                            all_text2 += t
                            confs2.append(int(data2["conf"][i]))
                    conf2 = float(np.mean(confs2)) if confs2 else 0.0
                    epic2 = clean_voter_id(all_text2)
                    if epic2 and len(epic2) >= 5 and conf2 > best_conf:
                        best_vid = epic2
                        best_conf = conf2
                except Exception:
                    pass

            if best_vid and len(best_vid) >= 5:
                if (not vid) or (best_conf > vid_conf) or (len(best_vid) > len(vid)):
                    v["voter_id"] = best_vid
                    v["conf"]["voter_id"] = round(best_conf, 1)
                    v["vid_repaired"] = True

    return voters


# ============================================================
# ENHANCED PASS: Name dictionary fuzzy repair
# ============================================================

def build_name_dictionary(voters):
    """Build a frequency dictionary from already-extracted names.

    Used for fuzzy repair: if a low-confidence name is close to a
    known high-confidence name, replace it.
    """
    name_freq = {}
    for v in voters:
        name = v.get("voter_name", "")
        conf = v.get("conf", {}).get("voter_name", 0)
        if name and conf >= 80 and len(name) >= 3:
            name_freq[name] = name_freq.get(name, 0) + 1

        rel = v.get("relative_name", "")
        rel_conf = v.get("conf", {}).get("relative_name", 0)
        if rel and rel_conf >= 80 and len(rel) >= 3:
            name_freq[rel] = name_freq.get(rel, 0) + 1

    return name_freq


def _levenshtein(s1, s2):
    """Simple Levenshtein distance for short strings."""
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)

    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            cost = 0 if c1 == c2 else 1
            curr_row.append(min(
                curr_row[j] + 1,
                prev_row[j + 1] + 1,
                prev_row[j] + cost
            ))
        prev_row = curr_row

    return prev_row[-1]


def repair_names_dictionary(voters, name_dict=None):
    """Fuzzy-match low-confidence names against known good names.

    If a name with confidence < 70 is within edit distance 2 of a
    high-confidence name seen multiple times, replace it.
    """
    if name_dict is None:
        name_dict = build_name_dictionary(voters)

    if not name_dict:
        return voters

    # Only consider names that appear at least twice (likely correct)
    common_names = {name for name, count in name_dict.items() if count >= 2}

    if not common_names:
        return voters

    for v in voters:
        name = v.get("voter_name", "")
        name_conf = v.get("conf", {}).get("voter_name", 100)

        # Only repair low-confidence names
        if name and name_conf < 70 and len(name) >= 3:
            best_match = None
            best_dist = float('inf')

            for known_name in common_names:
                # Quick length check to avoid expensive computation
                if abs(len(known_name) - len(name)) > 3:
                    continue
                dist = _levenshtein(name, known_name)
                # Allow up to 2 edits for names >= 5 chars, 1 edit for shorter
                max_dist = 2 if len(name) >= 5 else 1
                if dist <= max_dist and dist < best_dist:
                    best_dist = dist
                    best_match = known_name

            if best_match and best_match != name:
                v["voter_name"] = best_match
                v["name_dict_repaired"] = True

    return voters
