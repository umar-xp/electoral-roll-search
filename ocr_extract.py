import argparse
import json
import os
import statistics
import sys
from dataclasses import dataclass

import fitz
import numpy as np
from PIL import Image, ImageEnhance, ImageOps


@dataclass(frozen=True)
class OcrToken:
    text: str
    confidence: float


def render_page_to_pil(page: fitz.Page, dpi: int) -> Image.Image:
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    mode = "RGB"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    return img


def preprocess_pil(img: Image.Image, *, target_dpi: int) -> Image.Image:
    gray = img.convert("L")
    gray = ImageOps.autocontrast(gray)

    contrast = ImageEnhance.Contrast(gray)
    gray = contrast.enhance(1.6)

    sharp = ImageEnhance.Sharpness(gray)
    gray = sharp.enhance(1.8)

    if target_dpi < 300:
        gray = gray.resize((gray.width * 2, gray.height * 2), Image.Resampling.LANCZOS)
    return gray


def _cv2_deskew(binary: np.ndarray) -> np.ndarray:
    import cv2

    coords = np.column_stack(np.where(binary < 128))
    if coords.shape[0] < 2000:
        return binary

    rect = cv2.minAreaRect(coords.astype(np.float32))
    angle = rect[-1]
    if angle < -45:
        angle = 90 + angle

    if abs(angle) < 0.05:
        return binary

    h, w = binary.shape[:2]
    center = (w // 2, h // 2)
    m = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(binary, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)
    return rotated


def preprocess_cv2(img: Image.Image, *, target_dpi: int, mode: str) -> Image.Image:
    import cv2

    arr = np.array(img)
    if arr.ndim == 3:
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    else:
        gray = arr

    if target_dpi < 300:
        gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    gray = cv2.fastNlMeansDenoising(gray, None, 20, 7, 21)

    if mode == "cv2_otsu":
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    elif mode in {"cv2_adaptive", "cv2_adaptive_deskew"}:
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
        )
    else:
        raise ValueError(f"Unknown preprocess mode: {mode}")

    if binary.mean() < 127:
        binary = cv2.bitwise_not(binary)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)

    if mode == "cv2_adaptive_deskew":
        binary = _cv2_deskew(binary)

    return Image.fromarray(binary, mode="L")


def preprocess(img: Image.Image, *, target_dpi: int, mode: str) -> Image.Image:
    if mode == "pil":
        return preprocess_pil(img, target_dpi=target_dpi)
    if mode in {"cv2_otsu", "cv2_adaptive", "cv2_adaptive_deskew"}:
        return preprocess_cv2(img, target_dpi=target_dpi, mode=mode)
    raise ValueError(f"Unknown preprocess mode: {mode}")


def compute_success(tokens: list[OcrToken]) -> dict:
    if not tokens:
        return {
            "token_count": 0,
            "high_conf_token_pct": 0.0,
            "mean_confidence_pct": 0.0,
            "char_weighted_confidence_pct": 0.0,
        }

    confs = [t.confidence for t in tokens]
    token_count = len(tokens)
    high_conf = [t for t in tokens if t.confidence >= 0.5]
    high_conf_token_pct = (len(high_conf) / token_count) * 100.0

    total_chars = sum(len(t.text) for t in tokens if t.text)
    if total_chars == 0:
        char_weighted = 0.0
    else:
        char_weighted = (
            sum(t.confidence * len(t.text) for t in tokens if t.text) / total_chars
        ) * 100.0

    return {
        "token_count": token_count,
        "high_conf_token_pct": high_conf_token_pct,
        "mean_confidence_pct": statistics.fmean(confs) * 100.0,
        "char_weighted_confidence_pct": char_weighted,
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--pdf",
        default=os.path.join(
            os.getcwd(), "GULBARGA", "AC 19 - Shorapur", "A0190016.pdf"
        ),
    )
    parser.add_argument("--pages", default="1")
    parser.add_argument("--dpi", default="200,300")
    parser.add_argument("--langs", default="kn,en")
    parser.add_argument(
        "--preprocess",
        default="pil",
        choices=["pil", "cv2_otsu", "cv2_adaptive", "cv2_adaptive_deskew"],
    )
    parser.add_argument("--out-json", default=None)
    parser.add_argument("--export-images-dir", default=None)
    parser.add_argument("--export-only", action="store_true")
    args = parser.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(pdf_path)

    page_numbers = []
    for part in args.pages.split(","):
        part = part.strip()
        if not part:
            continue
        page_numbers.append(int(part))
    if not page_numbers:
        raise ValueError("--pages must select at least one page (1-based).")

    dpis = []
    for part in args.dpi.split(","):
        part = part.strip()
        if not part:
            continue
        dpis.append(int(part))
    if not dpis:
        raise ValueError("--dpi must contain at least one value.")

    langs = [s.strip() for s in args.langs.split(",") if s.strip()]
    if not langs:
        raise ValueError("--langs must contain at least one language code.")

    doc = fitz.open(pdf_path)
    try:
        for p in page_numbers:
            if p < 1 or p > doc.page_count:
                raise ValueError(f"Page {p} out of range (1..{doc.page_count}).")
    except Exception:
        doc.close()
        raise

    export_dir = None
    if args.export_images_dir:
        export_dir = os.path.abspath(args.export_images_dir)
        os.makedirs(export_dir, exist_ok=True)

        pdf_base = os.path.splitext(os.path.basename(pdf_path))[0]
        for dpi in dpis:
            for page_no in page_numbers:
                page = doc.load_page(page_no - 1)
                img = render_page_to_pil(page, dpi=dpi)
                img = preprocess(img, target_dpi=dpi, mode=args.preprocess)
                out_name = f"{pdf_base}_p{page_no}_dpi{dpi}_{args.preprocess}.png"
                out_path = os.path.join(export_dir, out_name)
                img.save(out_path, format="PNG")
                print(f"EXPORTED {out_path}")

    if args.export_only:
        doc.close()
        return 0

    import easyocr

    reader = easyocr.Reader(langs, gpu=False)

    all_results = {
        "pdf": pdf_path,
        "pages": page_numbers,
        "langs": langs,
        "runs": [],
    }

    for dpi in dpis:
        tokens: list[OcrToken] = []
        extracted_text_lines: list[str] = []

        for page_no in page_numbers:
            page = doc.load_page(page_no - 1)
            img = render_page_to_pil(page, dpi=dpi)
            img = preprocess(img, target_dpi=dpi, mode=args.preprocess)
            arr = np.array(img)

            results = reader.readtext(arr, detail=1, paragraph=False)
            for _bbox, text, conf in results:
                if not text:
                    continue
                tokens.append(OcrToken(text=text, confidence=float(conf)))
                extracted_text_lines.append(text)

        metrics = compute_success(tokens)
        run = {
            "dpi": dpi,
            "preprocess": args.preprocess,
            "metrics": metrics,
            "text_sample": "\n".join(extracted_text_lines[:200]),
        }
        all_results["runs"].append(run)

        print(f"\nPDF: {pdf_path}")
        print(f"Pages: {page_numbers}  Langs: {langs}  DPI: {dpi}")
        print(
            "Success:"
            f" token_count={metrics['token_count']},"
            f" high_conf_token_pct={metrics['high_conf_token_pct']:.1f}%,"
            f" mean_confidence_pct={metrics['mean_confidence_pct']:.1f}%,"
            f" char_weighted_confidence_pct={metrics['char_weighted_confidence_pct']:.1f}%"
        )
        print("\n--- Extracted text (first ~200 lines) ---\n")
        print(run["text_sample"])

    if args.out_json:
        out_path = os.path.abspath(args.out_json)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=2)
        print(f"\nSaved JSON: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
