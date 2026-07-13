"""Test script for Kannada-to-English transliteration module.
Author: Mohammed Shoaib U
"""
import sys; sys.path.insert(0, 'packages/data-pipeline/lib')
from transliteration import transliterate_name, map_relation_type, map_gender

tests = [
    'ಕೃಷ್ಣಮೂರ್ತಿ',
    'ಅಬ್ದುಲ್ ವಾಹಾಬ್ ಖಾನ್',
    'ಶ್ರೀನಿವಾಸರಾವ್',
    'ಫಜಲೂರ್ ರಹೀಂ',
    'ಮೋಹನ್ ಕುಮಾರಿ',
    'ವೇಣುಗೋಪಾಲ್',
    'ಷನಾಜ್ ಬಾನು',
    'ಜಯನಂದ ಡಿಮೆಲ್ಲೋ',
]
print("TRANSLITERATION TEST:")
for name in tests:
    r = transliterate_name(name)
    print(f"  {name} -> {r.en} (urdu_origin={r.urdu_origin}, tokens={r.search_tokens})")

print()
print(f"  Relation: {repr(map_relation_type('ತಂದೆ'))}")
print(f"  Relation: {repr(map_relation_type('ಗಂಡ'))}")
print(f"  Relation: {repr(map_relation_type('ಇತರೆ'))}")
print(f"  Gender: {repr(map_gender('ಗಂ'))}")
print(f"  Gender: {repr(map_gender('ಹೆಂ'))}")
