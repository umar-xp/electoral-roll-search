import sqlite3

conn = sqlite3.connect('data/rolls.sqlite')
cur = conn.cursor()

print('=' * 60)
print('  ROLLS.SQLITE - FULL DATA QUALITY REPORT')
print('=' * 60)

# Per-AC summary
print('\n--- Per-AC Summary ---')
cur.execute('SELECT ac_num, COUNT(*), COUNT(DISTINCT pdf_file), COUNT(DISTINCT part_num) FROM voters GROUP BY ac_num ORDER BY ac_num')
total_voters = 0
ac_data = cur.fetchall()
for r in ac_data:
    total_voters += r[1]
    print(f'  AC {r[0]:>3}: {r[1]:>6} voters | {r[2]:>3} PDFs | {r[3]:>3} parts')
print(f'  {"TOTAL":>6}: {total_voters:>6} voters')

# NULL/Empty fields across all
print('\n--- NULL/Empty Fields (all ACs) ---')
for col in ['voter_name_kn', 'voter_name_en', 'voter_id', 'gender', 'age']:
    cur.execute(f"SELECT COUNT(*) FROM voters WHERE {col} IS NULL OR {col} = ''")
    cnt = cur.fetchone()[0]
    pct = cnt / total_voters * 100
    print(f'  {col:>15}: {cnt:>6} missing ({pct:.1f}%)')

# Age stats
print('\n--- Age Distribution ---')
cur.execute('SELECT MIN(age), MAX(age), AVG(age) FROM voters WHERE age IS NOT NULL AND age > 0')
r = cur.fetchone()
print(f'  Min: {r[0]}, Max: {r[1]}, Avg: {r[2]:.1f}')
cur.execute('SELECT COUNT(*) FROM voters WHERE age < 18 OR age > 120')
print(f'  Invalid (<18 or >120): {cur.fetchone()[0]}')

# Gender
print('\n--- Gender Distribution ---')
cur.execute('SELECT gender, COUNT(*) FROM voters GROUP BY gender ORDER BY COUNT(*) DESC')
for r in cur.fetchall():
    g = r[0] if r[0] else '(empty)'
    print(f'  {g:>8}: {r[1]:>6} ({r[1]/total_voters*100:.1f}%)')

# Voter ID quality
print('\n--- Voter ID Quality ---')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_id IS NOT NULL AND voter_id != ''")
has_vid = cur.fetchone()[0]
print(f'  Has voter ID: {has_vid} ({has_vid/total_voters*100:.1f}%)')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_id != '' AND LENGTH(voter_id) = 10")
proper = cur.fetchone()[0]
print(f'  Proper 10-char IDs: {proper} ({proper/total_voters*100:.1f}%)')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_id != '' AND LENGTH(voter_id) < 10")
short = cur.fetchone()[0]
print(f'  Short/partial IDs: {short} ({short/total_voters*100:.1f}%)')

# Data quality scores
print('\n--- Data Quality Scores ---')
cur.execute('SELECT data_quality, COUNT(*) FROM voters GROUP BY data_quality ORDER BY data_quality')
for r in cur.fetchall():
    print(f'  Quality {r[0]}: {r[1]:>6} ({r[1]/total_voters*100:.1f}%)')

# Garbage detection
print('\n--- Potential Garbage Records ---')
cur.execute("SELECT COUNT(*) FROM voters WHERE LENGTH(voter_name_kn) < 2 AND voter_name_kn != ''")
print(f'  Very short names (<2 chars): {cur.fetchone()[0]}')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn LIKE '%!%' OR voter_name_kn LIKE '%?%' OR voter_name_kn LIKE '%@%'")
print(f'  Names with special chars (!?@): {cur.fetchone()[0]}')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_en LIKE '%!%' OR voter_name_en LIKE '%?%'")
print(f'  English names with !?: {cur.fetchone()[0]}')

# Duplicates
print('\n--- Duplicate Voter IDs ---')
cur.execute("SELECT COUNT(*) FROM (SELECT voter_id, COUNT(*) c FROM voters WHERE voter_id != '' GROUP BY voter_id HAVING c > 1)")
print(f'  Duplicate voter IDs: {cur.fetchone()[0]}')

# Accuracy estimate
print('\n--- Accuracy Estimate ---')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn != '' AND age > 0 AND gender != ''")
complete = cur.fetchone()[0]
print(f'  Records with name+age+gender: {complete} ({complete/total_voters*100:.1f}%)')
cur.execute("SELECT COUNT(*) FROM voters WHERE voter_name_kn != '' AND age > 0 AND gender != '' AND voter_id != ''")
full = cur.fetchone()[0]
print(f'  Fully complete records: {full} ({full/total_voters*100:.1f}%)')
cur.execute("SELECT COUNT(*) FROM voters WHERE data_quality = 1 AND voter_name_kn != ''")
good = cur.fetchone()[0]
print(f'  High quality + has name: {good} ({good/total_voters*100:.1f}%)')

# Sample suspicious
print('\n--- Sample Suspicious Records ---')
cur.execute("SELECT voter_name_kn, voter_name_en, ac_num, part_num FROM voters WHERE voter_name_kn LIKE '%!%' OR voter_name_en LIKE '%!%' LIMIT 5")
rows = cur.fetchall()
if rows:
    for r in rows:
        print(f'  [AC{r[2]}/Part{r[3]}] {r[0]} | {r[1]}')
else:
    print('  None found')

# Sample good records per AC
print('\n--- Sample Records (1 per AC) ---')
for ac_row in ac_data:
    ac = ac_row[0]
    cur.execute(f"SELECT voter_name_kn, voter_name_en, voter_id, age, gender FROM voters WHERE ac_num={ac} AND voter_name_en != '' ORDER BY RANDOM() LIMIT 1")
    r = cur.fetchone()
    if r:
        print(f'  AC {ac}: {r[0]} ({r[1]}) | VID: {r[2]} | Age: {r[3]} | {r[4]}')

conn.close()
