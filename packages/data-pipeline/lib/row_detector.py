"""
Row Detection — Finding horizontal row boundaries in electoral roll tables.
"""

import cv2
import numpy as np
from scipy.signal import find_peaks


def find_row_boundaries(img):
    """Detect horizontal row boundaries in the electoral roll table.

    Uses morphological operations to find major horizontal rules, then
    applies valley detection on the horizontal projection profile to
    locate individual row separators within the data area.

    Args:
        img: BGR image of the full page

    Returns:
        tuple: (boundaries, data_top, data_bottom, major_lines)
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)

    h, w = img.shape[:2]
    h_proj = np.sum(binary, axis=1)

    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 4, 1))
    horiz_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kernel)
    horiz_proj = np.sum(horiz_mask, axis=1)
    line_thresh = w * 50

    major_lines = []
    in_line = False
    line_start = 0
    for y in range(h):
        if horiz_proj[y] > line_thresh and not in_line:
            in_line = True
            line_start = y
        elif horiz_proj[y] <= line_thresh and in_line:
            in_line = False
            major_lines.append((line_start + y) // 2)

    if len(major_lines) >= 2:
        data_top = major_lines[1] + 5
        data_bottom = major_lines[-1] - 5
        if data_bottom <= data_top and len(major_lines) >= 3:
            data_top = major_lines[2] + 5
            data_bottom = major_lines[-1] - 5
    else:
        data_top = int(h * 0.12)
        data_bottom = int(h * 0.93)

    if data_bottom <= data_top:
        data_top = int(h * 0.12)
        data_bottom = int(h * 0.93)

    data_region = h_proj[data_top:data_bottom]

    if len(data_region) < 50:
        row_height = 66
        boundaries = list(range(data_top, data_bottom, row_height))
        boundaries.append(data_bottom)
        return boundaries, data_top, data_bottom, major_lines

    row_height_estimate = 66
    kernel_size = 5
    smoothed = np.convolve(data_region, np.ones(kernel_size) / kernel_size, mode='same')

    if np.max(smoothed) == 0:
        row_height = 66
        boundaries = list(range(data_top, data_bottom, row_height))
        boundaries.append(data_bottom)
        return boundaries, data_top, data_bottom, major_lines

    inverted = -smoothed
    peaks, _ = find_peaks(inverted, distance=row_height_estimate * 0.6,
                          prominence=np.max(smoothed) * 0.05)

    boundaries = [data_top] + [data_top + int(p) for p in peaks] + [data_bottom]
    return boundaries, data_top, data_bottom, major_lines
