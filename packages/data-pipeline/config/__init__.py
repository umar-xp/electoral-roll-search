"""Configuration package for the electoral roll pipeline."""
from .settings import settings, ocr_settings, search_settings, OCRSettings, PipelineSettings, SearchSettings

__all__ = ["settings", "ocr_settings", "search_settings", "OCRSettings", "PipelineSettings", "SearchSettings"]
