"""
PDF Rendering — Page-to-image conversion for OCR pipeline.
"""

import fitz  # PyMuPDF
import cv2
import numpy as np


def render_page(pdf_path, page_num, dpi=300):
    """Render a single PDF page to a numpy BGR image array.

    Args:
        pdf_path: Path to the PDF file
        page_num: Zero-indexed page number
        dpi: Resolution for rendering (default 300)

    Returns:
        numpy.ndarray: BGR image of the rendered page
    """
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    doc.close()
    return img


def get_page_count(pdf_path):
    """Get the number of pages in a PDF."""
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count
