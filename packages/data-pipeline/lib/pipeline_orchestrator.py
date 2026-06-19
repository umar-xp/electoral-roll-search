"""
Pipeline Orchestrator — Checkpoint/resume capability for batch OCR processing.

Tracks progress in a SQLite checkpoint database so processing can resume
from where it left off after failures or interruptions.

Usage:
    from lib.pipeline_orchestrator import PipelineOrchestrator

    orchestrator = PipelineOrchestrator("./checkpoints.db")
    for pdf_path in orchestrator.pending_pdfs(pdf_list):
        for page_num in orchestrator.pending_pages(pdf_path, total_pages):
            results = process_page(pdf_path, page_num)
            orchestrator.mark_page_done(pdf_path, page_num, len(results))
        orchestrator.mark_pdf_done(pdf_path)
"""

import sqlite3
import time
from pathlib import Path
from typing import List, Optional


class PipelineOrchestrator:
    """Manages checkpoint state for resumable pipeline execution."""

    def __init__(self, checkpoint_db: str = "pipeline_checkpoints.db"):
        self.db_path = checkpoint_db
        self._conn = sqlite3.connect(checkpoint_db)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._create_tables()

    def _create_tables(self):
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS pdf_progress (
                pdf_path TEXT PRIMARY KEY,
                total_pages INTEGER,
                pages_done INTEGER DEFAULT 0,
                total_voters INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                started_at REAL,
                completed_at REAL,
                error_msg TEXT
            );
            CREATE TABLE IF NOT EXISTS page_progress (
                pdf_path TEXT NOT NULL,
                page_num INTEGER NOT NULL,
                voters_extracted INTEGER DEFAULT 0,
                elapsed_seconds REAL,
                status TEXT DEFAULT 'done',
                completed_at REAL,
                PRIMARY KEY (pdf_path, page_num)
            );
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                run_id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at REAL NOT NULL,
                completed_at REAL,
                total_pdfs INTEGER,
                total_pages INTEGER,
                total_voters INTEGER,
                status TEXT DEFAULT 'running'
            );
        """)
        self._conn.commit()

    def start_run(self, total_pdfs: int) -> int:
        """Record the start of a pipeline run. Returns run_id."""
        cur = self._conn.execute(
            "INSERT INTO pipeline_runs (started_at, total_pdfs, status) VALUES (?, ?, 'running')",
            (time.time(), total_pdfs)
        )
        self._conn.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, total_pages: int, total_voters: int):
        """Mark a pipeline run as complete."""
        self._conn.execute(
            "UPDATE pipeline_runs SET completed_at=?, total_pages=?, total_voters=?, status='done' WHERE run_id=?",
            (time.time(), total_pages, total_voters, run_id)
        )
        self._conn.commit()

    def pending_pdfs(self, pdf_list: List[str]) -> List[str]:
        """Filter pdf_list to only those not yet completed."""
        done = set()
        rows = self._conn.execute(
            "SELECT pdf_path FROM pdf_progress WHERE status='done'"
        ).fetchall()
        for row in rows:
            done.add(row[0])
        return [p for p in pdf_list if p not in done]

    def pending_pages(self, pdf_path: str, total_pages: int) -> List[int]:
        """Return page numbers not yet processed for a given PDF."""
        self._conn.execute(
            "INSERT OR IGNORE INTO pdf_progress (pdf_path, total_pages, started_at) VALUES (?, ?, ?)",
            (pdf_path, total_pages, time.time())
        )
        self._conn.commit()

        done_pages = set()
        rows = self._conn.execute(
            "SELECT page_num FROM page_progress WHERE pdf_path=?", (pdf_path,)
        ).fetchall()
        for row in rows:
            done_pages.add(row[0])

        return [p for p in range(total_pages) if p not in done_pages]

    def mark_page_done(self, pdf_path: str, page_num: int,
                       voters_extracted: int, elapsed: float = 0.0):
        """Record that a page has been successfully processed."""
        self._conn.execute(
            "INSERT OR REPLACE INTO page_progress (pdf_path, page_num, voters_extracted, elapsed_seconds, completed_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (pdf_path, page_num, voters_extracted, elapsed, time.time())
        )
        self._conn.execute(
            "UPDATE pdf_progress SET pages_done = pages_done + 1, total_voters = total_voters + ? WHERE pdf_path=?",
            (voters_extracted, pdf_path)
        )
        self._conn.commit()

    def mark_pdf_done(self, pdf_path: str):
        """Mark a PDF as fully processed."""
        self._conn.execute(
            "UPDATE pdf_progress SET status='done', completed_at=? WHERE pdf_path=?",
            (time.time(), pdf_path)
        )
        self._conn.commit()

    def mark_pdf_failed(self, pdf_path: str, error: str):
        """Mark a PDF as failed with error message."""
        self._conn.execute(
            "UPDATE pdf_progress SET status='failed', error_msg=? WHERE pdf_path=?",
            (error, pdf_path)
        )
        self._conn.commit()

    def get_stats(self) -> dict:
        """Get overall pipeline progress statistics."""
        row = self._conn.execute(
            "SELECT COUNT(*), SUM(CASE WHEN status='done' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END), "
            "SUM(pages_done), SUM(total_voters) FROM pdf_progress"
        ).fetchone()
        return {
            "total_pdfs": row[0] or 0,
            "done_pdfs": row[1] or 0,
            "failed_pdfs": row[2] or 0,
            "pages_processed": row[3] or 0,
            "voters_extracted": row[4] or 0,
        }

    def reset_failed(self):
        """Reset failed PDFs back to pending for retry."""
        self._conn.execute("UPDATE pdf_progress SET status='pending', error_msg=NULL WHERE status='failed'")
        self._conn.commit()

    def close(self):
        self._conn.close()
