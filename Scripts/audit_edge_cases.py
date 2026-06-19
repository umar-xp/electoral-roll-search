"""Edge case audit for data quality concerns"""
import sqlite3

conn = sqlite3.connect('data/rolls.sqlite')
cur = conn.cursor()

print('=' * 60)
print('  EDGE CASE AUDIT — DATA QUALITY CONCERNS')
print('=' * 60)

# 1. House numbers - mixed Kannada/English
print('\n--- 1. House Numbers (sample with non-numeric) ---')
cur.execute("""SELECT house_no, voter_name_kn, voter_name_en, ac_num, part_num 
    FROM voters WHERE house_no != '' AND house_no IS NOT NULL 
    ORDER BY RANDOM() LIMIT 10""")
for r in cur.fetchall():
    print(f'  HN: [{r[0]}] | {r[1]} ({r[2]}) | AC{r[3]}/P{r[4]}')

# House numbers with Kannada chars
print('\n--- 1b. House Numbers with Kannada/Special Chars ---')
cur.execute("""SELECT house_no, voter_name_en, ac_num FROM voters 
    WHERE house_no GLOB '*[^0-9A-Za-z/ -]*' AND house_no != ''
    ORDER BY RANDOM() LIMIT 10""")
rows = cur.fetchall()
if rows:
    for r in rows:
        print(f'  HN: [{r[0]}] | {r[1]} | AC{r[2]}')
else:
    print('  None found - house numbers are clean')

# Count house number issues
cur.execute("""SELECT COUNT(*) FROM voters WHERE house_no GLOB '*[^0-9A-Za-z/ -]*' AND house_no != ''""")
print(f'  Total with non-standard chars: {cur.fetchone()[0]}')

# 2. Names with initials/prefixes
print('\n--- 2. Names with Initials (dots) — Transliteration Quality ---')
cur.execute("""SELECT voter_name_kn, voter_name_en FROM voters 
    WHERE voter_name_kn LIKE '%.%' 
    ORDER BY RANDOM() LIMIT 15""")
for r in cur.fetchall():
    print(f'  {r[0]} -> {r[1]}')

# Count
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn LIKE '%.%'")
total_initials = cur.fetchone()[0]
print(f'\n  Total names with initials: {total_initials}')

# 3. Garbage: English text in Kannada name field
print('\n--- 3. English Text in Kannada Name Field ---')
cur.execute("""SELECT voter_name_kn, voter_name_en, ac_num, part_num FROM voters 
    WHERE voter_name_kn GLOB '*[a-zA-Z]*' 
    ORDER BY RANDOM() LIMIT 10""")
rows = cur.fetchall()
for r in rows:
    print(f'  {r[0]} -> {r[1]} | AC{r[2]}/P{r[3]}')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn GLOB '*[a-zA-Z]*'")
print(f'\n  Total with English in Kannada field: {cur.fetchone()[0]}')

# 4. Names with numbers (OCR artifacts)
print('\n--- 4. Names with Numbers (OCR artifacts) ---')
cur.execute("""SELECT voter_name_kn, voter_name_en, ac_num FROM voters 
    WHERE voter_name_kn GLOB '*[0-9]*' 
    ORDER BY RANDOM() LIMIT 10""")
rows = cur.fetchall()
for r in rows:
    print(f'  {r[0]} -> {r[1]} | AC{r[2]}')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn GLOB '*[0-9]*'")
print(f'\n  Total with numbers in name: {cur.fetchone()[0]}')

# 5. Very short names
print('\n--- 5. Very Short Names (1-3 chars) ---')
cur.execute("""SELECT voter_name_kn, voter_name_en, ac_num FROM voters 
    WHERE LENGTH(voter_name_kn) BETWEEN 1 AND 3 
    ORDER BY RANDOM() LIMIT 10""")
for r in cur.fetchall():
    print(f'  [{r[0]}] -> [{r[1]}] | AC{r[2]}')
cur.execute("SELECT COUNT(*) FROM voters WHERE LENGTH(voter_name_kn) BETWEEN 1 AND 3")
print(f'\n  Total very short names: {cur.fetchone()[0]}')

# 6. Special characters
print('\n--- 6. Names with Special Characters (!@#$%^&*) ---')
cur.execute("""SELECT voter_name_kn, voter_name_en, ac_num FROM voters 
    WHERE voter_name_kn GLOB '*[!@#$%^&*()=+]*' AND voter_name_kn NOT LIKE '%.%'
    ORDER BY RANDOM() LIMIT 10""")
for r in cur.fetchall():
    print(f'  {r[0]} -> {r[1]} | AC{r[2]}')

# 7. Search tokens quality check
print('\n--- 7. Search Tokens Quality ---')
cur.execute("""SELECT voter_name_en, search_tokens FROM voters 
    WHERE voter_name_en LIKE '%.%' AND search_tokens != ''
    ORDER BY RANDOM() LIMIT 10""")
for r in cur.fetchall():
    print(f'  Name: {r[0]}')
    print(f'    Tokens: {r[1]}')

# 8. Relation type distribution
print('\n--- 8. Relation Type Distribution ---')
cur.execute("SELECT relation_type, COUNT(*) FROM voters GROUP BY relation_type ORDER BY COUNT(*) DESC")
for r in cur.fetchall():
    rt = r[0] if r[0] else '(empty)'
    print(f'  {rt}: {r[1]}')

# Summary
print('\n' + '=' * 60)
print('  SUMMARY OF ISSUES')
print('=' * 60)
cur.execute("SELECT COUNT(*) FROM voters")
total = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn GLOB '*[a-zA-Z]*'")
eng_in_kn = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn GLOB '*[0-9]*'")
nums_in_name = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM voters WHERE LENGTH(voter_name_kn) BETWEEN 1 AND 3")
short_names = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn LIKE '%.%'")
has_initials = cur.fetchone()[0]
cur.execute("""SELECT COUNT(*) FROM voters WHERE house_no GLOB '*[^0-9A-Za-z/ -]*' AND house_no != ''""")
bad_hn = cur.fetchone()[0]

print(f'  Total records: {total}')
print(f'  English in Kannada field: {eng_in_kn} ({eng_in_kn/total*100:.2f}%)')
print(f'  Numbers in names: {nums_in_name} ({nums_in_name/total*100:.2f}%)')
print(f'  Very short names: {short_names} ({short_names/total*100:.2f}%)')
print(f'  Names with initials: {has_initials} ({has_initials/total*100:.1f}%)')
print(f'  Non-standard house numbers: {bad_hn} ({bad_hn/total*100:.2f}%)')

conn.close()
