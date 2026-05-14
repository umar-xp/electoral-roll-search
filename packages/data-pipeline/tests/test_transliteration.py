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
    assert r.is_muslim is True


def test_pair_search_index_and_flags() -> None:
    ve, re_, is_muslim, search_index, corr, failed = transliterate_pair("ಜಹೀರ ಖಾನ್", "ಅಬ್ಬುಲ")
    assert ve and re_
    assert is_muslim is True
    assert search_index
    assert failed is False
    assert corr is True


def test_reference_csv_if_present() -> None:
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "samples", "shivajinagar_voter_sample.csv"))
    if not os.path.exists(path):
        pytest.skip("shivajinagar_voter_sample.csv not found")
    df = pd.read_csv(path)
    for _, row in df.iterrows():
        kn_v = str(row.get("voter_name_kn") or "")
        en_v_expected = str(row.get("voter_name_en_expected") or "")
        if kn_v.strip() and en_v_expected.strip():
            got = transliterate_name(kn_v).en
            assert got == en_v_expected

        kn_r = str(row.get("relative_name_kn") or "")
        en_r_expected = str(row.get("relative_name_en_expected") or "")
        if kn_r.strip() and en_r_expected.strip():
            got = transliterate_name(kn_r).en
            assert got == en_r_expected
