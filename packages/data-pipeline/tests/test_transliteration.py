import os
import sys

import pandas as pd
import pytest

_LIB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lib"))
sys.path.insert(0, _LIB_DIR)

from transliteration import transliterate_name, transliterate_pair


@pytest.mark.parametrize(
    "kn,expected_en",
    [
        ("ಅಬ್ಬುಲ", "Abdul"),
        ("ಅಬ್ದುಲ", "Abdul"),
        ("ಫಾತಿಮಾ", "Fatima"),
        ("ಫಯಾಜ್", "Fayaz"),
        ("ಜಹೀರ ಖಾನ್", "Zaheer Khan"),
        ("ಬೇಗ", "Begum"),
    ],
)
def test_known_muslim_cases(kn: str, expected_en: str) -> None:
    r = transliterate_name(kn)
    assert r.en == expected_en
    assert r.urdu_origin is True


def test_pair_search_index_and_flags() -> None:
    ve, re_, urdu_origin, search_index, corr, failed = transliterate_pair("ಜಹೀರ ಖಾನ್", "ಅಬ್ಬುಲ")
    assert ve and re_
    assert urdu_origin is True
    assert search_index
    assert failed is False
    assert corr is True


def test_reference_csv_if_present() -> None:
    """Test transliteration against reference CSV.
    
    This is a regression guard, not an exact-match test. The transliteration
    library produces phonetic approximations; the CSV contains manually
    standardized English spellings. We assert the match rate doesn't drop
    below a known baseline (currently ~19%).
    """
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "samples", "shivajinagar_voter_sample.csv"))
    if not os.path.exists(path):
        pytest.skip("shivajinagar_voter_sample.csv not found")
    df = pd.read_csv(path)
    total = 0
    passed = 0
    for _, row in df.iterrows():
        kn_v = str(row.get("voter_name_kn") or "")
        en_v_expected = str(row.get("voter_name_en_expected") or "")
        if kn_v.strip() and en_v_expected.strip():
            total += 1
            got = transliterate_name(kn_v).en
            if got == en_v_expected:
                passed += 1

        kn_r = str(row.get("relative_name_kn") or "")
        en_r_expected = str(row.get("relative_name_en_expected") or "")
        if kn_r.strip() and en_r_expected.strip():
            total += 1
            got = transliterate_name(kn_r).en
            if got == en_r_expected:
                passed += 1

    accuracy = passed / total if total > 0 else 0
    # Baseline: 19% exact match (fuzzy search handles the rest)
    # If this drops significantly, transliteration logic regressed
    assert accuracy >= 0.15, (
        f"Transliteration accuracy dropped below 15%: {accuracy:.1%} ({passed}/{total}). "
        f"Check for regressions in _base_transliterate or correction dictionaries."
    )
