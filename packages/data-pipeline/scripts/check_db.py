"""Quick database inspection utility.
Author: Mohammed Shoaib U
"""
import sqlite3, json
conn = sqlite3.connect('data/rolls_test.sqlite')
conn.row_factory = sqlite3.Row
rows = conn.execute('SELECT serial_no, house_no, voter_name_kn, voter_name_en, relative_name_en, relation_type, gender, age, voter_id, name_origin, search_tokens FROM voters LIMIT 5').fetchall()
for r in rows:
    print(dict(r))
print()
print(f"Total: {conn.execute('SELECT COUNT(1) FROM voters').fetchone()[0]}")
print(f"Valid: {conn.execute('SELECT COUNT(1) FROM voters WHERE data_quality=1').fetchone()[0]}")
print(f"Urdu-origin: {conn.execute('SELECT COUNT(1) FROM voters WHERE name_origin=''urdu''').fetchone()[0]}")
conn.close()
