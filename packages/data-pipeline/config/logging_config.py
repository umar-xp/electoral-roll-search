"""
Structured Logging for Electoral Roll Pipeline
================================================

Provides consistent, configurable logging across all modules.
Supports both console (colored) and file output.

Usage:
    from config.logging_config import get_logger
    logger = get_logger(__name__)
    
    logger.info("Processing page", extra={"page": 5, "pdf": "A1160043.pdf"})
    logger.warning("Low confidence", extra={"conf": 42.3, "field": "voter_name"})
"""

import logging
import os
import sys
from pathlib import Path


# Load LOG_LEVEL from environment
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


class StructuredFormatter(logging.Formatter):
    """Formatter that includes structured context from 'extra' fields."""
    
    COLORS = {
        "DEBUG": "\033[90m",     # Gray
        "INFO": "\033[36m",      # Cyan
        "WARNING": "\033[33m",   # Yellow
        "ERROR": "\033[31m",     # Red
        "CRITICAL": "\033[41m",  # Red background
    }
    RESET = "\033[0m"
    
    def __init__(self, use_color=True):
        super().__init__()
        self.use_color = use_color and sys.stderr.isatty()
    
    def format(self, record):
        level = record.levelname
        timestamp = self.formatTime(record, "%H:%M:%S")
        
        # Build structured context from extra fields
        extras = {k: v for k, v in record.__dict__.items() 
                  if k not in logging.LogRecord("", 0, "", 0, "", (), None).__dict__ 
                  and k not in ("message", "msg", "args")}
        
        context = ""
        if extras:
            pairs = [f"{k}={v}" for k, v in extras.items()]
            context = f" [{', '.join(pairs)}]"
        
        if self.use_color:
            color = self.COLORS.get(level, "")
            return f"{color}{timestamp} {level:8s}{self.RESET} {record.name}: {record.getMessage()}{context}"
        else:
            return f"{timestamp} {level:8s} {record.name}: {record.getMessage()}{context}"


def get_logger(name: str, level: str = None) -> logging.Logger:
    """Get a configured logger for the given module name.
    
    Args:
        name: Module name (usually __name__)
        level: Override log level (default: from LOG_LEVEL env var)
    
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(StructuredFormatter(use_color=True))
        logger.addHandler(handler)
    
    logger.setLevel(getattr(logging, level or LOG_LEVEL, logging.INFO))
    return logger


def setup_file_logging(log_dir: Path = None):
    """Add file logging to the root logger.
    
    Call once at pipeline startup to log to file as well.
    """
    if log_dir is None:
        log_dir = Path(__file__).resolve().parent.parent.parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    
    file_handler = logging.FileHandler(
        log_dir / "pipeline.log", 
        encoding="utf-8"
    )
    file_handler.setFormatter(StructuredFormatter(use_color=False))
    
    root = logging.getLogger()
    root.addHandler(file_handler)
    root.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
