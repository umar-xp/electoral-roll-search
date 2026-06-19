"""Analyze garbage records and attempt intelligent fixes"""
import json
import glob
import re

garbage = []
for f in glob.glob('data/districts/MYSORE/*/part_*.json'):
    d = json.load(open(f, encoding='utf-8'))
    for v in d['voters']:
        if v['dq'] == 0:
            garbage.append(v)

print(f'Total garbage records: {len(garbage)}')
print()

# Categorize garbage
categories = {
    'pure_noise': [],       # Completely unsalvageable
    'has_real_name': [],    # Has a real Kannada name buried in noise
    'english_mixed': [],    # English text that could be a name
    'numbers_only': [],     # Numbers in name field
}

# Pattern for valid Kannada name chars
kannada_pattern = re.compile(r'[\u0C80-\u0CFF]+')
# Pattern for noise
noise_pattern = re.compile(r'[!@#$%^&*()=+\[\]{}<>\\|;:"\'?/~`]')
# English name pattern
english_name = re.compile(r'^[A-Z][a-z]{2,}')

for v in garbage:
    kn = v['vk']
    en = v['vn']
    
    # Extract Kannada portions
    kannada_parts = kannada_pattern.findall(kn)
    kannada_text = ''.join(kannada_parts)
    noise_chars = noise_pattern.findall(kn)
    
    if len(kannada_text) >= 4 and len(noise_chars) <= 4:
        categories['has_real_name'].append(v)
    elif english_name.search(en) and len(en.split()[0]) >= 4:
        categories['english_mixed'].append(v)
    else:
        categories['pure_noise'].append(v)

print(f'Categories:')
print(f'  Has real Kannada name (fixable): {len(categories["has_real_name"])}')
print(f'  English name visible (fixable): {len(categories["english_mixed"])}')
print(f'  Pure noise (unsalvageable): {len(categories["pure_noise"])}')
print()

# Show fixable examples
print('=== FIXABLE: Has Real Kannada Name ===')
for v in categories['has_real_name'][:20]:
    kn = v['vk']
    en = v['vn']
    # Extract just the Kannada words (strip noise)
    kannada_words = kannada_pattern.findall(kn)
    clean_kn = ' '.join(w for w in kannada_words if len(w) >= 2)
    
    # Try to extract clean English name
    en_words = en.split()
    clean_en_words = [w for w in en_words if re.match(r'^[A-Z][a-z]+$', w) and len(w) >= 3]
    clean_en = ' '.join(clean_en_words)
    
    print(f'  Original KN: {kn}')
    print(f'  Original EN: {en}')
    print(f'  CLEANED KN:  {clean_kn}')
    print(f'  CLEANED EN:  {clean_en}')
    print(f'  Age: {v["a"]} Gender: {v["g"]}')
    print()

print()
print('=== PURE NOISE (unsalvageable) ===')
for v in categories['pure_noise'][:15]:
    print(f'  KN: {v["vk"][:60]}')
    print(f'  EN: {v["vn"][:60]}')
    print()
