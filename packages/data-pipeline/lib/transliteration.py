"""
Kannada → English transliteration for Karnataka electoral roll names.
Author: Mohammed Shoaib U

Uses indic_transliteration as the base engine with custom corrections
for common Kannada name patterns, especially Muslim names.
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional
import re

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate


# ─── Custom correction dictionaries ────────────────────────────────────────────

# Common Kannada → English name fragments that need special handling
MUSLIM_NAME_CORRECTIONS = {
    "ಅಬ್ಬುಲ": "Abdul", "ಅಬ್ದುಲ": "Abdul", "ಅಬ್ದುಲ್": "Abdul",
    "ಫಾತಿಮಾ": "Fatima", "ಫಾತಿಮ": "Fatima",
    "ಖಾನ್": "Khan", "ಖಾನ": "Khan",
    "ಬೇಗಂ": "Begum", "ಬೇಗ": "Begum",
    "ಪಾಷಾ": "Pasha", "ಪಾಷ": "Pasha",
    "ಹುಸೇನ್": "Husain", "ಹುಸ್ಯೆನ್": "Husain", "ಹುಸೈನ್": "Husain",
    "ಅಹಮದ್": "Ahmad", "ಅಹ್ಮದ್": "Ahmad", "ಅಹಮ್ಮದ್": "Ahmad",
    "ಮೊಹಮ್ಮದ್": "Mohammad", "ಮಹಮ್ಮದ್": "Mohammad", "ಮಹಮದ್": "Mohammad",
    "ಮೊಹಮದ್": "Mohammad", "ಮಹ್ಮದ್": "Mohammad",
    "ಷರೀಫ್": "Sharif", "ಷರೀಫ": "Sharif",
    "ಸುಲ್ತಾನ": "Sultan", "ಸುಲ್ತಾನ್": "Sultan",
    "ಫಯಾಜ್": "Fayaz", "ಫಯಾಜ": "Fayaz",
    "ಇಕ್ಬಾಲ್": "Iqbal", "ಇಕ್ಬಾಲ": "Iqbal",
    "ನಜೀಮಾ": "Nazeema", "ನಸೀಮ": "Naseem", "ನಸೀಮ್": "Naseem",
    "ಸೈಫುಲ್ಲಾ": "Saifullah", "ನೂರುಲ್ಲಾ": "Noorullah",
    "ರಹೀಂ": "Rahim", "ರಹಮಾನ್": "Rehman", "ರೆಹಮಾನ್": "Rehman",
    "ಬಾನು": "Banu", "ಬಾನೂ": "Banu",
    "ಜಹೀರ": "Zaheer", "ಜಫೂರ್": "Jafur",
    "ಮೆಹಬೂಬ್": "Mehboob", "ಮೊಹಬೂಬ್": "Mohboob",
    "ಖಾದರ್": "Khadar", "ಖಾದರ": "Khadar",
    "ಶಹನಾಜ್": "Shahnaz", "ಷನಾಜ್": "Shanaz",
    "ಫರಾನಾಜ್": "Faranaz",
    "ಗುಲ್ನಾರ್": "Gulnar",
    "ಖುಷೀದ್": "Khushid",
    "ಷಮೀಮಾ": "Shameema", "ಶಮೀಮ್": "Shameem",
    # Additional Muslim names (expanded)
    "ಇಬ್ರಾಹಿಂ": "Ibrahim", "ಇಬ್ರಾಹೀಂ": "Ibrahim",
    "ಇಸ್ಮಾಯಿಲ್": "Ismail", "ಇಸ್ಮಾಯಿಲ": "Ismail",
    "ಯೂಸುಫ್": "Yusuf", "ಯೂಸಫ್": "Yusuf",
    "ಅಲಿ": "Ali", "ಅಲ್ಲಿ": "Ali",
    "ಅಮೀನ": "Ameen", "ಅಮೀನ್": "Ameen",
    "ಆಯಿಷಾ": "Ayesha", "ಆಯೇಷಾ": "Ayesha",
    "ಸಲೀಮ": "Saleem", "ಸಲೀಂ": "Saleem",
    "ಹಸನ್": "Hasan", "ಹಸ್ಸನ್": "Hassan",
    "ಜಮಾಲ್": "Jamal", "ಜಮಾಲ": "Jamal",
    "ಕರೀಂ": "Kareem", "ಕರೀಮ": "Kareem",
    "ಮುಸ್ತಫಾ": "Mustafa", "ಮುಸ್ತಫ": "Mustafa",
    "ನವಾಜ್": "Nawaz", "ನವಾಜ": "Nawaz",
    "ರಶೀದ್": "Rasheed", "ರಶೀದ": "Rasheed",
    "ಸಿದ್ದೀಕ್": "Siddique", "ಸಿದ್ಧೀಖ್": "Siddique",
    "ತಾಜ್": "Taj", "ತಾಜ": "Taj",
    "ವಹೀದ್": "Waheed", "ವಹೀದ": "Waheed",
    "ಜಾಕಿರ್": "Zakir", "ಜಾಕೀರ್": "Zakir",
    "ಅನ್ವರ್": "Anwar", "ಅನ್ವಾರ್": "Anwar",
    "ಬಷೀರ್": "Basheer", "ಬಶೀರ್": "Basheer",
    "ದಾವೂದ್": "Dawood", "ದಾವೂದ": "Dawood",
    "ಫಿರೋಜ್": "Firoz", "ಫೈರೋಜ್": "Firoz",
    "ಗಫಾರ್": "Ghaffar", "ಗಫ್ಫಾರ್": "Ghaffar",
    "ಹಮೀದ್": "Hameed", "ಹಮೀದ": "Hameed",
    "ಜಾವೇದ್": "Javed", "ಜಾವೀದ್": "Javed",
    "ಲತೀಫ್": "Lateef", "ಲತೀಫ": "Lateef",
    "ಮಜೀದ್": "Majeed", "ಮಜೀದ": "Majeed",
    "ನಬೀ": "Nabi", "ನಬಿ": "Nabi",
    "ಒಮರ್": "Omar", "ಉಮರ್": "Omar",
    "ಸಮೀರ್": "Sameer", "ಸಮೀರ": "Sameer",
    "ತವಕ್ಕಲ್": "Tawakkal",
    "ಉಸ್ಮಾನ್": "Usman", "ಉಸ್ಮಾನ": "Usman",
    "ಯಾಸೀನ್": "Yaseen", "ಯಾಸಿನ್": "Yaseen",
    "ಜೈನಬ್": "Zainab", "ಜೈನಾಬ್": "Zainab",
    "ಮುನೀರ": "Muneer", "ಮುನೀರ್": "Muneer",
    "ನಜೀರ್": "Nazeer", "ನಜೀರ": "Nazeer",
    "ಶಬ್ಬೀರ್": "Shabbir", "ಶಬೀರ್": "Shabbir",
    "ತಸ್ಲೀಮ": "Tasleem", "ತಸ್ಲೀಮ್": "Tasleem",
    "ಹಫೀಜ್": "Hafeez", "ಹಫೀಜ": "Hafeez",
    "ಅಜೀಜ್": "Aziz", "ಅಜೀಜ": "Aziz",
    "ರಜಾಕ್": "Razak", "ರಜ್ಜಾಕ್": "Razak",
    "ಸೈಯದ್": "Syed", "ಸೈಯ್ಯದ್": "Syed", "ಸಯ್ಯದ್": "Syed",
    "ಶೇಖ್": "Sheikh", "ಶೇಖ": "Sheikh",
    "ಮೊಯ್ನುದ್ದೀನ್": "Moinuddin", "ಮೈನುದ್ದೀನ್": "Moinuddin",
    "ನೂರ್": "Noor", "ನೂರು": "Noor",
    "ಸಫಿಯಾ": "Safia", "ಸಫೀಯಾ": "Safia",
    "ರುಕಯ್ಯಾ": "Ruqayya", "ರುಕ್ಕಯ್ಯ": "Ruqayya",
    "ಹಲೀಮಾ": "Haleema", "ಹಲೀಮ": "Haleema",
    "ಸುಲೇಮಾನ": "Suleman", "ಸುಲೈಮಾನ": "Suleman",
    "ಅಫ್ಜಲ್": "Afzal", "ಅಫ್ಜಲ": "Afzal",
    "ಅಸ್ಲಂ": "Aslam", "ಅಸ್ಲಮ್": "Aslam",
    "ರಫೀಕ್": "Rafiq", "ರಫೀಕ": "Rafiq",
    "ಶಫೀಕ್": "Shafiq", "ಶಫೀಕ": "Shafiq",
}

# Known suffixes indicating Muslim names
MUSLIM_SUFFIXES = {"Khan", "Begum", "Pasha", "Banu", "Sultan", "Bi", "Bai",
                   "Ahmad", "Husain", "Rahim", "Sharif", "Rehman", "Syed",
                   "Sheikh", "Nabi", "Saheb", "Mulla", "Qureshi", "Ansari"}

# General Kannada name corrections
GENERAL_CORRECTIONS = {
    "ಗೌಡ": "Gowda", "ಗೌಡ್": "Gowda",
    "ಶೆಟ್ಟಿ": "Shetty", "ಶೆಟ್ಟಿ": "Shetty",
    "ನಾಯಕ": "Nayak", "ನಾಯ್ಕ": "Naik",
    "ಸ್ವಾಮಿ": "Swamy", "ಸ್ವಾಮಯ್ಯ": "Swamaiah",
    "ಅಯ್ಯ": "Aiah", "ಅಪ್ಪ": "Appa",
    "ಅಮ್ಮ": "Amma", "ಅಮ್ಮಣ್ಣಿ": "Ammanni",
    "ಕುಮಾರ": "Kumar", "ಕುಮಾರ್": "Kumar",
    "ಲಕ್ಷ್ಮಿ": "Lakshmi", "ಲಕ್ಷ್ಮಣ್": "Lakshmana",
    "ಕೃಷ್ಣ": "Krishna", "ಕೃಷ್ಣಮೂರ್ತಿ": "Krishnamurthy",
    "ರಾಜು": "Raju", "ರಾಜ": "Raja", "ರಾಜ್": "Raj",
    "ವೇಣುಗೋಪಾಲ": "Venugopala", "ವೇಣುಗೋಪಾಲ್": "Venugopal",
    "ದೀಪಕ": "Deepak", "ದೀಪಕ್": "Deepak",
    "ದೀಪ": "Deep", "ದೀಪ್": "Deep",
    "ರಾವ್": "Rao", "ರಾವ": "Rao",
    "ರೆಡ್ಡಿ": "Reddy", "ರೆಡ್ಡಿ": "Reddy",
    # Expanded general corrections for Karnataka names
    "ಬಸವರಾಜ": "Basavaraja", "ಬಸವರಾಜ್": "Basavaraj",
    "ಶಿವ": "Shiva", "ಶಿವಕುಮಾರ": "Shivakumar",
    "ಮಂಜುನಾಥ": "Manjunath", "ಮಂಜುನಾಥ್": "Manjunath",
    "ವೆಂಕಟೇಶ": "Venkatesha", "ವೆಂಕಟೇಶ್": "Venkatesh",
    "ನಾಗರಾಜ": "Nagaraj", "ನಾಗರಾಜ್": "Nagaraj",
    "ಮಹೇಶ": "Mahesha", "ಮಹೇಶ್": "Mahesh",
    "ಸುರೇಶ": "Suresha", "ಸುರೇಶ್": "Suresh",
    "ರಮೇಶ": "Ramesha", "ರಮೇಶ್": "Ramesh",
    "ಗಣೇಶ": "Ganesha", "ಗಣೇಶ್": "Ganesh",
    "ಯೋಗೇಶ": "Yogesha", "ಯೋಗೇಶ್": "Yogesh",
    "ಪ್ರಕಾಶ": "Prakash", "ಪ್ರಕಾಶ್": "Prakash",
    "ವಿಜಯ": "Vijaya", "ವಿಜಯ್": "Vijay",
    "ಸಂತೋಷ": "Santosha", "ಸಂತೋಷ್": "Santosh",
    "ಗಿರೀಶ": "Gireesha", "ಗಿರೀಶ್": "Gireesh",
    "ಹರೀಶ": "Hareesha", "ಹರೀಶ್": "Hareesh",
    "ಜಯಕುಮಾರ": "Jayakumar", "ಜಯಕುಮಾರ್": "Jayakumar",
    "ಚಂದ್ರ": "Chandra", "ಚಂದ್ರಶೇಖರ": "Chandrashekhar",
    "ಮಲ್ಲಿಕಾರ್ಜುನ": "Mallikarjuna", "ಮಲ್ಲಿಕಾರ್ಜುನ್": "Mallikarjun",
    "ಸಿದ್ಧಲಿಂಗ": "Siddalinga", "ಸಿದ್ದಲಿಂಗ": "Siddalinga",
    "ಹನುಮಂತ": "Hanumantha", "ಹನುಮಂತ್": "Hanumanth",
    "ಮಲ್ಲೇಶ": "Mallesha", "ಮಲ್ಲೇಶ್": "Mallesh",
    "ಶಂಕರ": "Shankara", "ಶಂಕರ್": "Shankar",
    "ವೀರಭದ್ರ": "Veerabhadra", "ವೀರಭದ್ರ್": "Veerabhadra",
    "ಮಾರುತಿ": "Maruthi", "ಮಾರುತಿ": "Maruthi",
    "ಅಮರ": "Amara", "ಅಮರ್": "Amar",
    "ಪ್ರಸಾದ": "Prasad", "ಪ್ರಸಾದ್": "Prasad",
    "ಪಾಟೀಲ": "Patil", "ಪಾಟೀಲ್": "Patil",
    "ಹಿರೇಮಠ": "Hiremath", "ಹಿರೇಮಠ್": "Hiremath",
    "ಕುಲಕರ್ಣಿ": "Kulkarni", "ಕುಲಕರ್ಣೀ": "Kulkarni",
    "ಜಾಧವ": "Jadhav", "ಜಾಧವ್": "Jadhav",
    "ದೇಸಾಯಿ": "Desai",
    "ಹೆಗಡೆ": "Hegde", "ಹೆಗ್ಡೆ": "Hegde",
    "ಭಟ್": "Bhat", "ಭಟ್ಟ": "Bhatt",
    "ಆಚಾರ್": "Achar", "ಆಚಾರ್ಯ": "Acharya",
    "ಲಿಂಗಯ್ಯ": "Lingaiah", "ಲಿಂಗಪ್ಪ": "Lingappa",
    "ಬಸಪ್ಪ": "Basappa", "ಬಸಯ್ಯ": "Basaiah",
    "ಶರಣಪ್ಪ": "Sharanappa", "ಶರಣಯ್ಯ": "Sharanaiah",
    "ಹಳ್ಳಿ": "Halli",
    "ಸಾಬ್": "Saab", "ಸಾಹೇಬ್": "Saheb",
    "ಪ್ರಭು": "Prabhu", "ಪ್ರಭಾ": "Prabha",
}

# Relation type mappings
RELATION_MAP = {
    "ತಂದೆ": "F",   # Father
    "ಗಂಡ": "H",    # Husband
    "ಇತರೆ": "O",   # Other
    "ತಾಯಿ": "M",   # Mother
}


@dataclass
class TranslitResult:
    """Result of transliterating a Kannada name."""
    en: str
    urdu_origin: bool  # True if name uses Urdu/Arabic-origin transliteration corrections
    search_tokens: List[str]
    corrected: bool


# ─── Kannada initial letter mappings ────────────────────────────────────────────
# Single Kannada characters used as initials (consonants only)
_KANNADA_INITIAL_MAP = {
    'ಅ': 'A', 'ಆ': 'A', 'ಇ': 'I', 'ಈ': 'I', 'ಉ': 'U', 'ಊ': 'U',
    'ಎ': 'E', 'ಏ': 'E', 'ಐ': 'Ai', 'ಒ': 'O', 'ಓ': 'O', 'ಔ': 'Au',
    'ಕ': 'K', 'ಖ': 'Kh', 'ಗ': 'G', 'ಘ': 'Gh',
    'ಚ': 'Ch', 'ಛ': 'Chh', 'ಜ': 'J', 'ಝ': 'Jh',
    'ಟ': 'T', 'ಠ': 'Th', 'ಡ': 'D', 'ಢ': 'Dh', 'ಣ': 'N',
    'ತ': 'T', 'ಥ': 'Th', 'ದ': 'D', 'ಧ': 'Dh', 'ನ': 'N',
    'ಪ': 'P', 'ಫ': 'Ph', 'ಬ': 'B', 'ಭ': 'Bh', 'ಮ': 'M',
    'ಯ': 'Y', 'ರ': 'R', 'ಲ': 'L', 'ವ': 'V', 'ಶ': 'Sh',
    'ಷ': 'Sh', 'ಸ': 'S', 'ಹ': 'H', 'ಳ': 'L',
    # Common multi-char initial patterns (with vowel signs)
    'ಕೆ': 'K', 'ಕೈ': 'K', 'ಬಿ': 'B', 'ಸಿ': 'C', 'ಡಿ': 'D',
    'ಜಿ': 'G', 'ಎಚ್': 'H', 'ಐ': 'I', 'ಜೆ': 'J', 'ಕೇ': 'K',
    'ಎಲ್': 'L', 'ಎಂ': 'M', 'ಎನ್': 'N', 'ಓ': 'O', 'ಪಿ': 'P',
    'ಆರ್': 'R', 'ಎಸ್': 'S', 'ಟಿ': 'T', 'ಯು': 'U', 'ವಿ': 'V',
    'ಡಬ್ಲ್ಯು': 'W',
}


def _split_initials(kannada_name: str) -> str:
    """Pre-process a Kannada name to separate dot-joined initials.
    
    Converts: 'ಕ.ಆರ್‌.ಗಿರೀಶ' → 'ಕ . ಆರ್‌ . ಗಿರೀಶ' (preserving dots as separators)
    So each initial gets transliterated independently.
    
    Returns the name with initials separated for proper transliteration.
    """
    if '.' not in kannada_name:
        return kannada_name
    
    # Split on dots
    parts = kannada_name.split('.')
    if len(parts) < 2:
        return kannada_name
    
    result_parts = []
    for i, part in enumerate(parts):
        part = part.strip().replace('\u200c', '').replace('\u200d', '')
        if not part:
            continue
        
        # Check if this part is a single initial (1-3 Kannada chars, short)
        # Initials are typically 1-3 characters without spaces
        is_last = (i == len(parts) - 1)
        
        if not is_last and len(part) <= 4 and ' ' not in part:
            # This looks like an initial — try to map it
            mapped = _KANNADA_INITIAL_MAP.get(part)
            if mapped:
                result_parts.append(mapped + '.')
            else:
                # Try stripping zero-width chars and virama
                clean = part.replace('್', '').replace('\u200c', '').replace('\u200d', '')
                mapped = _KANNADA_INITIAL_MAP.get(clean)
                if mapped:
                    result_parts.append(mapped + '.')
                else:
                    # Transliterate the short fragment and uppercase as initial
                    frag = _base_transliterate(part)
                    if frag and len(frag) <= 3:
                        result_parts.append(frag[0].upper() + '.')
                    else:
                        result_parts.append(frag)
        else:
            # This is the main name part — leave as Kannada for full transliteration
            result_parts.append(part)
    
    return ' '.join(result_parts)


# ─── House number normalization ─────────────────────────────────────────────────
# Kannada characters commonly used as suffixes in house numbers
_HOUSE_SUFFIX_MAP = {
    'ಎ': 'A', 'ಏ': 'A',
    'ಬಿ': 'B', 'ಬಿ': 'B',
    'ಸಿ': 'C',
    'ಡಿ': 'D',
    'ಇ': 'E', 'ಈ': 'E',
    'ಎಫ್': 'F',
    'ಜಿ': 'G',
    'ಎಚ್': 'H',
    'ಐ': 'I',
    'ಜೆ': 'J',
    'ಕೆ': 'K', 'ಕ': 'K',
}

# Kannada digits → Arabic digits
_KANNADA_DIGIT_MAP = str.maketrans('೦೧೨೩೪೫೬೭೮೯', '0123456789')


def normalize_house_number(house_no: str) -> str:
    """Normalize house number: convert Kannada suffixes/digits to English.
    
    Examples:
        '1-ಎ' → '1-A'
        '18ಬಿ' → '18B'
        '6-ಸಿ' → '6-C'
        '೧೫ಎ' → '15A'
    """
    if not house_no:
        return house_no
    
    result = house_no.strip()
    
    # Convert Kannada digits to Arabic
    result = result.translate(_KANNADA_DIGIT_MAP)
    
    # Replace Kannada letter suffixes with English equivalents
    # Try longest match first (multi-char like ಬಿ, ಸಿ before single-char ಬ, ಸ)
    for kn, en in sorted(_HOUSE_SUFFIX_MAP.items(), key=lambda x: -len(x[0])):
        if kn in result:
            result = result.replace(kn, en)
    
    # If there are still Kannada characters, try single-char mapping
    kannada_re = re.compile(r'[\u0C80-\u0CFF]+')
    remaining = kannada_re.findall(result)
    for fragment in remaining:
        mapped = _KANNADA_INITIAL_MAP.get(fragment)
        if mapped:
            result = result.replace(fragment, mapped)
    
    # Clean up: remove trailing dashes, double dashes
    result = re.sub(r'-+$', '', result)
    result = re.sub(r'-{2,}', '-', result)
    
    return result


def _base_transliterate(kannada_text: str) -> str:
    """Base transliteration using indic_transliteration library."""
    if not kannada_text or not kannada_text.strip():
        return ""
    # Transliterate Kannada → ITRANS → then clean up to readable English
    try:
        itrans = transliterate(kannada_text, sanscript.KANNADA, sanscript.ITRANS)
    except Exception:
        return kannada_text
    
    # Convert ITRANS to readable English
    result = itrans
    # ITRANS uses uppercase for long vowels and retroflexes:
    # A=aa, I=ii, U=uu, T=retroflex t, D=retroflex d, N=retroflex n
    # Map long vowels to doubled form first (preserves them through later cleanup)
    result = result.replace("AU", "au").replace("AI", "ai")
    result = result.replace("U", "oo").replace("A", "aa").replace("I", "ee")
    # Now reduce doubled vowels to single (common English spelling preference)
    result = result.replace("aa", "a").replace("ee", "e").replace("oo", "oo")
    # Handle special ITRANS sequences
    result = result.replace("RRi", "ri").replace("Ri", "ri")
    result = result.replace("~N", "n").replace(".n", "n").replace("~n", "n")
    result = result.replace("chh", "ch").replace("Ch", "ch")
    result = result.replace("Sh", "sh").replace("sh", "sh")
    result = result.replace("Th", "th").replace("T", "t")
    result = result.replace("Dh", "dh").replace("D", "d")
    result = result.replace("N", "n")
    result = result.replace(".a", "a").replace("|", "")
    result = result.replace("GY", "gn")
    
    # Strip remaining diacritics/accented characters → plain ASCII
    import unicodedata
    result = unicodedata.normalize('NFD', result)
    result = ''.join(c for c in result if unicodedata.category(c) != 'Mn')
    
    # Title-case each word
    words = result.split()
    words = [w.capitalize() if w else w for w in words]
    return " ".join(words)


def _apply_corrections(kannada_text: str, english_base: str) -> Tuple[str, bool, bool]:
    """Apply dictionary corrections. Returns (corrected_text, urdu_origin, was_corrected)."""
    urdu_origin = False
    was_corrected = False
    
    # Check for known fragments in the original Kannada
    words_kn = kannada_text.strip().split()
    corrected_words = []
    
    for word_kn in words_kn:
        # Strip zero-width chars
        word_kn_clean = word_kn.replace('\u200c', '').replace('\u200d', '').strip()
        
        matched = False
        # Check Muslim corrections first
        for kn_pattern, en_value in MUSLIM_NAME_CORRECTIONS.items():
            if word_kn_clean == kn_pattern or word_kn_clean.rstrip('್') == kn_pattern:
                corrected_words.append(en_value)
                urdu_origin = True
                was_corrected = True
                matched = True
                break
        
        if not matched:
            # Check general corrections
            for kn_pattern, en_value in GENERAL_CORRECTIONS.items():
                if word_kn_clean == kn_pattern:
                    corrected_words.append(en_value)
                    was_corrected = True
                    matched = True
                    break
        
        if not matched:
            # Use base transliteration for this word
            corrected_words.append(_base_transliterate(word_kn))
    
    result = " ".join(w for w in corrected_words if w)
    
    # Check if result contains Urdu/Arabic-origin name suffixes
    if not urdu_origin:
        for suffix in MUSLIM_SUFFIXES:
            if suffix.lower() in result.lower():
                urdu_origin = True
                break
    
    return result, urdu_origin, was_corrected


def _generate_search_tokens(english_name: str) -> List[str]:
    """Generate search tokens for fuzzy matching."""
    if not english_name:
        return []
    
    tokens = []
    words = english_name.split()
    
    for word in words:
        w = word.strip().strip(".,;:-'\"")
        if len(w) <= 1:
            continue  # Skip initials in tokens (keep them in display name)
        tokens.append(w)
    
    return tokens


def transliterate_name(kannada_name: str) -> TranslitResult:
    """Transliterate a single Kannada name to English with corrections."""
    if not kannada_name or not kannada_name.strip():
        return TranslitResult(en="", urdu_origin=False, search_tokens=[], corrected=False)
    
    # Clean input
    name = kannada_name.strip()
    
    # Pre-process: separate dot-joined initials before transliteration
    name_processed = _split_initials(name)
    
    # Check if initials were extracted (contains "X." pattern at start)
    if re.match(r'^[A-Z]\.', name_processed):
        # Initials were mapped — transliterate only the remaining Kannada part
        parts = name_processed.split()
        final_parts = []
        for part in parts:
            if re.match(r'^[A-Z]\.$', part):
                # Already an English initial
                final_parts.append(part)
            else:
                # Transliterate this Kannada fragment
                result = _apply_corrections(part, _base_transliterate(part))
                final_parts.append(result[0])
        
        corrected_en = ' '.join(p for p in final_parts if p)
        urdu_origin = any(
            suffix.lower() in corrected_en.lower() for suffix in MUSLIM_SUFFIXES
        )
        tokens = _generate_search_tokens(corrected_en)
        return TranslitResult(en=corrected_en, urdu_origin=urdu_origin,
                              search_tokens=tokens, corrected=True)
    
    # Standard path: base transliteration + corrections
    base_en = _base_transliterate(name)
    
    # Apply corrections
    corrected_en, urdu_origin, was_corrected = _apply_corrections(name, base_en)
    
    # Generate search tokens
    tokens = _generate_search_tokens(corrected_en)
    
    return TranslitResult(
        en=corrected_en,
        urdu_origin=urdu_origin,
        search_tokens=tokens,
        corrected=was_corrected,
    )


def transliterate_pair(voter_name_kn: str, relative_name_kn: str) -> Tuple[str, str, bool, List[str], bool, bool]:
    """Transliterate voter + relative name pair.
    
    Returns: (voter_en, relative_en, urdu_origin, search_index, corrected, failed)
    """
    voter_result = transliterate_name(voter_name_kn)
    relative_result = transliterate_name(relative_name_kn)
    
    urdu_origin = voter_result.urdu_origin or relative_result.urdu_origin
    
    # Combined search index
    search_index = voter_result.search_tokens + relative_result.search_tokens
    # Deduplicate while preserving order
    seen = set()
    unique_index = []
    for t in search_index:
        tl = t.lower()
        if tl not in seen:
            seen.add(tl)
            unique_index.append(t)
    
    corrected = voter_result.corrected or relative_result.corrected
    failed = (not voter_result.en and bool(voter_name_kn))
    
    return (voter_result.en, relative_result.en, urdu_origin, unique_index, corrected, failed)


def map_relation_type(kannada_relation: str) -> str:
    """Map Kannada relation word to code: F=Father, H=Husband, M=Mother, O=Other."""
    if not kannada_relation:
        return "O"
    cleaned = kannada_relation.strip().replace('\u200c', '')
    return RELATION_MAP.get(cleaned, "O")


def map_gender(kannada_gender: str) -> str:
    """Map Kannada gender to M/F."""
    if not kannada_gender:
        return ""
    if 'ಗಂ' in kannada_gender:
        return "M"
    if 'ಹೆಂ' in kannada_gender:
        return "F"
    return ""
