"""Tests for the pipeline orchestrator checkpoint system."""
import sys
import os
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.pipeline_orchestrator import PipelineOrchestrator


class TestPipelineOrchestrator:
    def setup_method(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.orch = PipelineOrchestrator(self.tmp.name)

    def teardown_method(self):
        self.orch.close()
        os.unlink(self.tmp.name)

    def test_pending_pdfs_all_new(self):
        pdfs = ["a.pdf", "b.pdf", "c.pdf"]
        result = self.orch.pending_pdfs(pdfs)
        assert result == pdfs

    def test_pending_pdfs_filters_done(self):
        pdfs = ["a.pdf", "b.pdf", "c.pdf"]
        # Mark a.pdf as done
        self.orch.pending_pages("a.pdf", 10)
        self.orch.mark_pdf_done("a.pdf")
        result = self.orch.pending_pdfs(pdfs)
        assert "a.pdf" not in result
        assert "b.pdf" in result

    def test_pending_pages(self):
        pages = self.orch.pending_pages("test.pdf", 5)
        assert pages == [0, 1, 2, 3, 4]

    def test_mark_page_done(self):
        self.orch.pending_pages("test.pdf", 5)
        self.orch.mark_page_done("test.pdf", 0, voters_extracted=30, elapsed=1.5)
        self.orch.mark_page_done("test.pdf", 1, voters_extracted=28, elapsed=1.2)
        remaining = self.orch.pending_pages("test.pdf", 5)
        assert remaining == [2, 3, 4]

    def test_mark_pdf_failed(self):
        self.orch.pending_pages("bad.pdf", 3)
        self.orch.mark_pdf_failed("bad.pdf", "OCR timeout")
        # Should still be in pending since it's failed, not done
        result = self.orch.pending_pdfs(["bad.pdf"])
        assert "bad.pdf" in result

    def test_reset_failed(self):
        self.orch.pending_pages("bad.pdf", 3)
        self.orch.mark_pdf_failed("bad.pdf", "error")
        self.orch.reset_failed()
        stats = self.orch.get_stats()
        assert stats["failed_pdfs"] == 0

    def test_get_stats(self):
        self.orch.pending_pages("a.pdf", 10)
        self.orch.mark_page_done("a.pdf", 0, 30)
        self.orch.mark_page_done("a.pdf", 1, 25)
        stats = self.orch.get_stats()
        assert stats["total_pdfs"] == 1
        assert stats["pages_processed"] == 2
        assert stats["voters_extracted"] == 55

    def test_start_and_finish_run(self):
        run_id = self.orch.start_run(total_pdfs=5)
        assert run_id >= 1
        self.orch.finish_run(run_id, total_pages=100, total_voters=5000)
        # No exception = success
