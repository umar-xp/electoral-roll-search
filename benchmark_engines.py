"""
Multi-Engine OCR Benchmark — Compare Tesseract, EasyOCR, and RapidOCR
on Karnataka electoral roll PDFs (Kannada + English).

Tests: Character confidence, text extraction quality, and speed.
"""

import time
import json
import sys
import os
import cv2
import numpy as np
from pathlib import Path

# PDF handling
import fitz  # PyMuPDF

# Tesseract
import pytesseract
from PIL import Image

# EasyOCR
import easyocr

# RapidOCR
from rapidocr_onnxruntime import RapidOCR

# Setup Tesseract path
TESSERACT_PATH = r"C:\Users\gt114735\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

# PDFs to test
PDFS = [
    "A1160043.pdf",
    "A1160061.pdf",
    "A1160150.pdf",
]

# Pages to sample (0-indexed) — page 2 is typically the first data page
SAMPLE_PAGES = [1, 2, 3]  # pages 2, 3, 4

# Region of interest: voter table area (approximate % of page)
# Skip header (top 15%) and footer (bottom 10%)
ROI_TOP_PCT = 0.15
ROI_BOTTOM_PCT = 0.90


def pdf_page_to_image(pdf_path, page_num, dpi=300):
    """Convert a PDF page to a numpy image at given DPI."""
    doc = fitz.open(pdf_path)
    if page_num >= len(doc):
        return None
    page = doc[page_num]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:  # RGBA
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:  # RGB
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    doc.close()
    return img


def extract_table_region(img):
    """Extract just the table region from a full page image."""
    h, w = img.shape[:2]
    top = int(h * ROI_TOP_PCT)
    bottom = int(h * ROI_BOTTOM_PCT)
    return img[top:bottom, :]


def benchmark_tesseract(img, lang="kan+eng"):
    """Run Tesseract OCR and return results with timing."""
    start = time.time()
    
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)
    
    # Full page OCR with data output
    config = '--psm 6 --oem 1'
    data = pytesseract.image_to_data(pil_img, lang=lang, config=config,
                                     output_type=pytesseract.Output.DICT)
    
    elapsed = time.time() - start
    
    texts = []
    confs = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if text and data["conf"][i] > 0:
            texts.append(text)
            confs.append(int(data["conf"][i]))
    
    avg_conf = float(np.mean(confs)) if confs else 0.0
    high_conf_pct = (sum(1 for c in confs if c >= 80) / len(confs) * 100) if confs else 0.0
    
    return {
        "engine": "Tesseract 5.4 (kan+eng)",
        "words_detected": len(texts),
        "avg_confidence": round(avg_conf, 1),
        "high_conf_pct": round(high_conf_pct, 1),
        "time_seconds": round(elapsed, 2),
        "sample_text": " ".join(texts[:20]),
    }


def benchmark_tesseract_sauvola(img, lang="kan+eng"):
    """Run Tesseract with Sauvola preprocessing (our enhanced pipeline)."""
    start = time.time()
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    
    # 3x upscale + Sauvola binarization (our best preprocessing)
    gray = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    
    # Sauvola threshold
    gray_f = gray.astype(np.float64)
    window_size = 25
    k = 0.2
    mean = cv2.blur(gray_f, (window_size, window_size))
    mean_sq = cv2.blur(gray_f * gray_f, (window_size, window_size))
    std = np.sqrt(np.maximum(mean_sq - mean * mean, 0))
    threshold = mean * (1.0 + k * (std / 128.0 - 1.0))
    binary = np.where(gray_f > threshold, 255, 0).astype(np.uint8)
    
    pil_img = Image.fromarray(binary)
    config = '--psm 6 --oem 1'
    data = pytesseract.image_to_data(pil_img, lang=lang, config=config,
                                     output_type=pytesseract.Output.DICT)
    
    elapsed = time.time() - start
    
    texts = []
    confs = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if text and data["conf"][i] > 0:
            texts.append(text)
            confs.append(int(data["conf"][i]))
    
    avg_conf = float(np.mean(confs)) if confs else 0.0
    high_conf_pct = (sum(1 for c in confs if c >= 80) / len(confs) * 100) if confs else 0.0
    
    return {
        "engine": "Tesseract 5.4 + Sauvola 3x",
        "words_detected": len(texts),
        "avg_confidence": round(avg_conf, 1),
        "high_conf_pct": round(high_conf_pct, 1),
        "time_seconds": round(elapsed, 2),
        "sample_text": " ".join(texts[:20]),
    }


def benchmark_easyocr(img, reader):
    """Run EasyOCR and return results with timing."""
    start = time.time()
    
    # EasyOCR expects BGR or RGB numpy array
    results = reader.readtext(img, detail=1, paragraph=False)
    
    elapsed = time.time() - start
    
    texts = []
    confs = []
    for (bbox, text, conf) in results:
        if text.strip():
            texts.append(text.strip())
            confs.append(conf * 100)  # normalize to 0-100
    
    avg_conf = float(np.mean(confs)) if confs else 0.0
    high_conf_pct = (sum(1 for c in confs if c >= 80) / len(confs) * 100) if confs else 0.0
    
    return {
        "engine": "EasyOCR 1.7.2 (kn+en)",
        "words_detected": len(texts),
        "avg_confidence": round(avg_conf, 1),
        "high_conf_pct": round(high_conf_pct, 1),
        "time_seconds": round(elapsed, 2),
        "sample_text": " ".join(texts[:20]),
    }


def benchmark_rapidocr(img, rapid_engine):
    """Run RapidOCR and return results with timing."""
    start = time.time()
    
    result, elapse = rapid_engine(img)
    
    elapsed = time.time() - start
    
    texts = []
    confs = []
    if result:
        for item in result:
            # RapidOCR returns: [box, text, confidence]
            text = str(item[1]).strip() if len(item) > 1 else ""
            conf = float(item[2]) * 100 if len(item) > 2 else 0  # normalize to 0-100
            if text:
                texts.append(text)
                confs.append(float(conf))
    
    avg_conf = float(np.mean(confs)) if confs else 0.0
    high_conf_pct = (sum(1 for c in confs if c >= 80) / len(confs) * 100) if confs else 0.0
    
    return {
        "engine": "RapidOCR (ONNX/PaddleOCR)",
        "words_detected": len(texts),
        "avg_confidence": round(avg_conf, 1),
        "high_conf_pct": round(high_conf_pct, 1),
        "time_seconds": round(elapsed, 2),
        "sample_text": " ".join(texts[:20]),
    }


def run_benchmark():
    """Run full benchmark across all engines and PDFs."""
    print("=" * 70)
    print("  MULTI-ENGINE OCR BENCHMARK — Karnataka Electoral Rolls")
    print("  Engines: Tesseract, Tesseract+Sauvola, EasyOCR, RapidOCR")
    print("=" * 70)
    
    # Initialize engines
    print("\n[1/4] Initializing engines...")
    
    print("  - Tesseract 5.4... OK")
    
    print("  - EasyOCR (kn+en)... ", end="", flush=True)
    easyocr_reader = easyocr.Reader(['kn', 'en'], gpu=False, verbose=False)
    print("OK")
    
    print("  - RapidOCR (ONNX)... ", end="", flush=True)
    rapid_engine = RapidOCR()
    print("OK")
    
    all_results = {}
    engine_totals = {
        "Tesseract 5.4 (kan+eng)": {"confs": [], "times": []},
        "Tesseract 5.4 + Sauvola 3x": {"confs": [], "times": []},
        "EasyOCR 1.7.2 (kn+en)": {"confs": [], "times": []},
        "RapidOCR (ONNX/PaddleOCR)": {"confs": [], "times": []},
    }
    
    for pdf_name in PDFS:
        pdf_path = Path(pdf_name)
        if not pdf_path.exists():
            print(f"\n  WARNING: {pdf_name} not found, skipping")
            continue
        
        print(f"\n{'─' * 70}")
        print(f"  PDF: {pdf_name}")
        print(f"{'─' * 70}")
        
        all_results[pdf_name] = []
        
        for page_num in SAMPLE_PAGES:
            img = pdf_page_to_image(str(pdf_path), page_num)
            if img is None:
                continue
            
            # Extract table region only
            table_img = extract_table_region(img)
            
            print(f"\n  Page {page_num + 1} ({table_img.shape[1]}x{table_img.shape[0]} px):")
            print(f"  {'Engine':<30} {'Words':<8} {'Avg Conf':<10} {'>=80%':<8} {'Time':<8}")
            print(f"  {'-'*30} {'-'*8} {'-'*10} {'-'*8} {'-'*8}")
            
            # Run each engine
            r1 = benchmark_tesseract(table_img)
            print(f"  {r1['engine']:<30} {r1['words_detected']:<8} {r1['avg_confidence']:<10} {r1['high_conf_pct']:<8} {r1['time_seconds']:<8}")
            
            r2 = benchmark_tesseract_sauvola(table_img)
            print(f"  {r2['engine']:<30} {r2['words_detected']:<8} {r2['avg_confidence']:<10} {r2['high_conf_pct']:<8} {r2['time_seconds']:<8}")
            
            r3 = benchmark_easyocr(table_img, easyocr_reader)
            print(f"  {r3['engine']:<30} {r3['words_detected']:<8} {r3['avg_confidence']:<10} {r3['high_conf_pct']:<8} {r3['time_seconds']:<8}")
            
            r4 = benchmark_rapidocr(table_img, rapid_engine)
            print(f"  {r4['engine']:<30} {r4['words_detected']:<8} {r4['avg_confidence']:<10} {r4['high_conf_pct']:<8} {r4['time_seconds']:<8}")
            
            page_results = {"page": page_num + 1, "results": [r1, r2, r3, r4]}
            all_results[pdf_name].append(page_results)
            
            # Accumulate totals
            for r in [r1, r2, r3, r4]:
                engine_totals[r["engine"]]["confs"].append(r["avg_confidence"])
                engine_totals[r["engine"]]["times"].append(r["time_seconds"])
    
    # Summary
    print(f"\n{'=' * 70}")
    print("  OVERALL SUMMARY (averaged across all pages)")
    print(f"{'=' * 70}")
    print(f"  {'Engine':<30} {'Avg Conf':<12} {'Avg Time':<12} {'Verdict'}")
    print(f"  {'-'*30} {'-'*12} {'-'*12} {'-'*20}")
    
    best_conf = 0
    best_engine = ""
    for engine, data in engine_totals.items():
        if data["confs"]:
            avg_c = round(np.mean(data["confs"]), 1)
            avg_t = round(np.mean(data["times"]), 2)
            if avg_c > best_conf:
                best_conf = avg_c
                best_engine = engine
            print(f"  {engine:<30} {avg_c:<12} {avg_t:<12}s")
    
    print(f"\n  WINNER: {best_engine} ({best_conf}% avg confidence)")
    
    # Save detailed results
    output_path = "ocr_benchmark/engine_comparison.json"
    os.makedirs("ocr_benchmark", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "pdfs_tested": PDFS,
            "pages_sampled": [p + 1 for p in SAMPLE_PAGES],
            "summary": {
                engine: {
                    "avg_confidence": round(np.mean(d["confs"]), 1) if d["confs"] else 0,
                    "avg_time_seconds": round(np.mean(d["times"]), 2) if d["times"] else 0,
                }
                for engine, d in engine_totals.items()
            },
            "detailed_results": all_results,
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n  Detailed results saved to: {output_path}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    run_benchmark()
