"""
Column Assignment — Maps OCR words to table columns by x-position.
Includes dynamic column detection for shifted/rotated scans.
"""

import cv2
import numpy as np


def detect_column_boundaries(img):
    """Dynamically detect vertical column boundaries from the page image.

    Uses vertical projection profiles and line detection to find the actual
    column grid for this specific page (handles shifted/rotated scans).

    Args:
        img: BGR page image

    Returns:
        list: Column zones as (name, x_start, x_end) tuples, or None if detection fails
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img.copy()
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)

    # Detect vertical lines using morphology
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, h // 3))
    vert_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kernel)

    # Vertical projection profile
    v_proj = np.sum(vert_mask, axis=0)
    line_thresh = h * 30  # Significant vertical lines

    # Find peaks in vertical projection (column separators)
    in_line = False
    separators = []
    for x in range(w):
        if v_proj[x] > line_thresh and not in_line:
            in_line = True
            line_start = x
        elif v_proj[x] <= line_thresh and in_line:
            in_line = False
            separators.append((line_start + x) // 2)

    # We expect 7-9 separators for 8 columns in Karnataka electoral rolls
    if len(separators) < 6:
        # Fallback: try with lower threshold for faded rural PDFs
        line_thresh_low = h * 15
        in_line = False
        separators = []
        for x in range(w):
            if v_proj[x] > line_thresh_low and not in_line:
                in_line = True
                line_start = x
            elif v_proj[x] <= line_thresh_low and in_line:
                in_line = False
                separators.append((line_start + x) // 2)

        if len(separators) < 6:
            return None  # Detection truly failed

    # Map separators to column names based on expected proportions
    # Karnataka layout: serial(narrow) | house(medium) | name(wide) | relation(narrow) |
    #                   relative(wide) | gender(narrow) | age(narrow) | voter_id(medium)
    col_names = ["serial_no", "house_no", "voter_name", "relation",
                 "relative_name", "gender", "age", "voter_id"]

    # Use the first N+1 separators for N columns
    zones = []
    seps = [0] + separators + [w]

    if len(seps) - 1 >= len(col_names):
        for i, name in enumerate(col_names):
            x_start = seps[i]
            x_end = seps[i + 1]
            zones.append((name, x_start, x_end))

        # Validate: check proportions match expected layout
        # voter_name should be widest non-relative column, serial should be narrow
        if not _validate_column_proportions(zones, w):
            return None

        return zones

    return None  # Not enough separators detected


def _validate_column_proportions(zones, page_width):
    """Validate detected columns have reasonable proportions.

    Prevents wildly wrong column boundaries from being used.
    Expected Karnataka layout proportions (approximate):
        serial: 8-12%, house: 8-12%, name: 15-22%, relation: 6-10%,
        relative: 18-25%, gender: 5-8%, age: 5-8%, voter_id: 12-20%
    """
    if not zones or len(zones) != 8:
        return False

    widths = {}
    for name, x_start, x_end in zones:
        widths[name] = (x_end - x_start) / page_width

    # Key sanity checks
    # voter_name should be at least 12% of page width
    if widths.get("voter_name", 0) < 0.12:
        return False
    # relative_name should be at least 12% of page width
    if widths.get("relative_name", 0) < 0.12:
        return False
    # serial_no should be less than 15% of page width
    if widths.get("serial_no", 1) > 0.15:
        return False
    # gender should be less than 12% of page width
    if widths.get("gender", 1) > 0.12:
        return False

    return True


def assign_columns(words, column_zones):
    """Assign OCR words to table columns based on their x-center position.

    Args:
        words: List of word dicts with x_center positions
        column_zones: List of (name, x_start, x_end) tuples

    Returns:
        dict: Column name -> list of words belonging to that column
    """
    result = {col[0]: [] for col in column_zones}

    for word in words:
        xc = word["x_center"]
        assigned = False
        for col_name, x_min, x_max in column_zones:
            if x_min <= xc < x_max:
                result[col_name].append(word)
                assigned = True
                break
        if not assigned:
            min_dist = float('inf')
            nearest = column_zones[0][0]
            for col_name, x_min, x_max in column_zones:
                dist = min(abs(xc - x_min), abs(xc - x_max))
                if dist < min_dist:
                    min_dist = dist
                    nearest = col_name
            result[nearest].append(word)

    return result


def join_words(words):
    """Join word list into a single string, sorted by x-position."""
    if not words:
        return ""
    return " ".join(w["text"] for w in sorted(words, key=lambda w: w["x"]))


def avg_conf(words):
    """Calculate average OCR confidence across a list of words."""
    if not words:
        return 0.0
    return round(float(np.mean([w["conf"] for w in words])), 1)
