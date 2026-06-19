"""
Generate inverted search index for high-performance O(1) voter lookups.

This replaces the brute-force O(n) scan with a compact inverted index
that maps phonetic keys → (district, ac, part, offset) tuples.

Output structure:
  data/search_index/
    ├── phonetic_index.json      # phoneticKey → list of (district, ac, part, positions)
    ├── trigram_index.json       # 3-char trigram → list of references
    ├── voter_id_index.json      # voter_id → (district, ac, part, position)
    └── metadata.json            # index stats and version

Usage:
    python packages/data-pipeline/scripts/generate_search_index.py --data-dir ./data
"""

import argparse
import json
import os
import re
import sys
import hashlib
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone


# ─── Phonetic normalization (mirrors frontend search-utils.js) ───────────────

PHONETIC_MAP = {
    'th': 't', 'dh': 'd', 'bh': 'b', 'kh': 'k', 'gh': 'g',
    'ph': 'f', 'sh': 's', 'ch': 'c',
    'ee': 'i', 'oo': 'u', 'aa': 'a', 'ou': 'u',
    'ai': 'e', 'ei': 'e', 'au': 'o',
    'pp': 'p', 'tt': 't', 'kk': 'k', 'mm': 'm',
    'nn': 'n', 'll': 'l', 'ss': 's', 'dd': 'd',
}


def phonetic_key(token: str) -> str:
    """Generate phonetic key matching frontend algorithm."""
    key = token.lower().strip()
    for frm, to in PHONETIC_MAP.items():
        key = key.replace(frm, to)
    # Remove trailing vowels
    key = re.sub(r'[aeiou]+$', '', key)
    return key


def tokenize_name(name: str) -> list[str]:
    """Split name into searchable tokens."""
    if not name:
        return []
    # Check if Kannada
    if re.search(r'[\u0C80-\u0CFF]', name):
        return [name.strip()]
    return [t for t in re.split(r'[\s.,\-/]+', name.lower()) if len(t) >= 2]


def generate_trigrams(token: str) -> set[str]:
    """Generate character trigrams for fuzzy matching."""
    if len(token) < 3:
        return {token}
    return {token[i:i+3] for i in range(len(token) - 2)}


# ─── Index Builder ───────────────────────────────────────────────────────────

class SearchIndexBuilder:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.phonetic_index: dict[str, list] = defaultdict(list)
        self.trigram_index: dict[str, set] = defaultdict(set)
        self.voter_id_index: dict[str, tuple] = {}
        self.stats = {
            'total_voters_indexed': 0,
            'total_phonetic_keys': 0,
            'total_trigrams': 0,
            'total_voter_ids': 0,
            'districts_processed': 0,
        }

    def process_all(self):
        """Process all districts and build indexes."""
        master_path = self.data_dir / 'master_index.json'
        if not master_path.exists():
            print(f"ERROR: master_index.json not found at {master_path}")
            sys.exit(1)

        with open(master_path, 'r', encoding='utf-8') as f:
            master = json.load(f)

        districts = master.get('districts', [])
        if isinstance(districts, dict):
            districts_iter = districts.items()
        else:
            districts_iter = [(d.get('name'), d) for d in districts]

        for dist_key, dist_info in districts_iter:
            self._process_district(dist_key, dist_info)
            self.stats['districts_processed'] += 1

        self.stats['total_phonetic_keys'] = len(self.phonetic_index)
        self.stats['total_trigrams'] = len(self.trigram_index)
        self.stats['total_voter_ids'] = len(self.voter_id_index)

    def _process_district(self, dist_key: str, dist_info: dict):
        """Process a single district's data."""
        dir_name = dist_key.replace(' ', '_')
        dist_dir = self.data_dir / 'districts' / dir_name
        if not dist_dir.exists():
            print(f"  SKIP: Directory not found for {dist_key}")
            return

        print(f"  Processing {dist_key}...")
        for ac_index_path in dist_dir.glob('*_index.json'):
            with open(ac_index_path, 'r', encoding='utf-8') as f:
                ac_index = json.load(f)

            ac_num = ac_index.get('ac') # Assuming it's stored as 'ac' or we parse from filename
            if not ac_num:
                # Fallback: parse from filename e.g. "116_index.json"
                ac_num = ac_index_path.name.split('_')[0]

            parts = ac_index.get('parts', [])
            for part_info in parts:
                part_num = part_info['part_num']
                part_file = dist_dir / str(ac_num) / f'part_{part_num}.json'
                if not part_file.exists():
                    continue

                self._process_part(dist_key, ac_num, part_num, part_file)

    def _process_part(self, dist_key: str, ac_num: int, part_num: int, part_file: Path):
        """Process a single part file and add entries to indexes."""
        try:
            with open(part_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return

        voters = data.get('voters', [])
        location_ref = f"{dist_key}|{ac_num}|{part_num}"

        for idx, voter in enumerate(voters):
            self.stats['total_voters_indexed'] += 1

            # Index voter name tokens
            name_tokens = voter.get('vt', [])
            if not name_tokens and voter.get('vn'):
                name_tokens = tokenize_name(voter['vn'])

            for token in name_tokens:
                if not token:
                    continue
                pkey = phonetic_key(token)
                if pkey and len(pkey) >= 2:
                    # Store compact reference: "dist|ac|part|idx"
                    ref = f"{location_ref}|{idx}"
                    self.phonetic_index[pkey].append(ref)

                    # Generate trigrams for the phonetic key
                    for tri in generate_trigrams(pkey):
                        self.trigram_index[tri].add(pkey)

            # Index relative name tokens
            rel_tokens = voter.get('rnt', [])
            if not rel_tokens and voter.get('rn'):
                rel_tokens = tokenize_name(voter['rn'])

            for token in rel_tokens:
                if not token:
                    continue
                pkey = phonetic_key(token)
                if pkey and len(pkey) >= 2:
                    ref = f"{location_ref}|{idx}"
                    # Prefix with 'r:' to distinguish relative name entries
                    self.phonetic_index[f"r:{pkey}"].append(ref)

            # Index voter ID
            voter_id = voter.get('id')
            if voter_id and len(str(voter_id)) >= 4:
                vid = str(voter_id).strip().upper()
                self.voter_id_index[vid] = f"{location_ref}|{idx}"

    def write_indexes(self, output_dir: Path):
        """Write all indexes to disk as sharded JSON."""
        output_dir.mkdir(parents=True, exist_ok=True)

        # Shard the phonetic index by first 2 chars for faster loading
        shards: dict[str, dict] = defaultdict(dict)
        for key, refs in self.phonetic_index.items():
            # Use first 2 chars of the key (after r: prefix if present)
            clean_key = key[2:] if key.startswith('r:') else key
            shard_id = clean_key[:2] if len(clean_key) >= 2 else clean_key
            
            # Skip invalid Windows filename characters and noise
            if not re.match(r'^[a-z0-9]+$', shard_id):
                continue
                
            shards[shard_id][key] = refs

        # Write phonetic shards
        shard_dir = output_dir / 'shards'
        shard_dir.mkdir(exist_ok=True)
        shard_manifest = {}

        for shard_id, shard_data in shards.items():
            shard_file = shard_dir / f'{shard_id}.json'
            with open(shard_file, 'w', encoding='utf-8') as f:
                json.dump(shard_data, f, separators=(',', ':'))
            shard_manifest[shard_id] = {
                'file': f'shards/{shard_id}.json',
                'keys': len(shard_data),
                'size': shard_file.stat().st_size,
            }

        # Write trigram index (for fuzzy completion)
        trigram_data = {k: list(v) for k, v in self.trigram_index.items()}
        trigram_path = output_dir / 'trigram_index.json'
        with open(trigram_path, 'w', encoding='utf-8') as f:
            json.dump(trigram_data, f, separators=(',', ':'))

        # Write voter ID index (sharded by first 3 chars)
        id_shards: dict[str, dict] = defaultdict(dict)
        for vid, ref in self.voter_id_index.items():
            prefix = vid[:3] if len(vid) >= 3 else vid
            
            # Skip invalid Windows filename characters
            if not re.match(r'^[a-zA-Z0-9]+$', prefix):
                continue
                
            id_shards[prefix][vid] = ref

        id_shard_dir = output_dir / 'id_shards'
        id_shard_dir.mkdir(exist_ok=True)
        id_manifest = {}
        for prefix, id_data in id_shards.items():
            id_file = id_shard_dir / f'{prefix}.json'
            with open(id_file, 'w', encoding='utf-8') as f:
                json.dump(id_data, f, separators=(',', ':'))
            id_manifest[prefix] = {
                'file': f'id_shards/{prefix}.json',
                'count': len(id_data),
            }

        # Write metadata
        metadata = {
            'version': '1.0',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'stats': self.stats,
            'shard_manifest': shard_manifest,
            'id_manifest': id_manifest,
            'trigram_file': 'trigram_index.json',
        }
        with open(output_dir / 'metadata.json', 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2)

        print(f"\n✅ Index generated successfully:")
        print(f"   Voters indexed: {self.stats['total_voters_indexed']:,}")
        print(f"   Phonetic keys:  {self.stats['total_phonetic_keys']:,}")
        print(f"   Trigrams:       {self.stats['total_trigrams']:,}")
        print(f"   Voter IDs:      {self.stats['total_voter_ids']:,}")
        print(f"   Shards:         {len(shard_manifest)}")
        print(f"   Output:         {output_dir}")


def main():
    parser = argparse.ArgumentParser(description='Generate search index for voter data')
    parser.add_argument('--data-dir', default='./data', help='Path to data directory')
    parser.add_argument('--output-dir', default=None, help='Output directory (default: data/search_index)')
    args = parser.parse_args()

    data_dir = Path(args.data_dir).resolve()
    output_dir = Path(args.output_dir) if args.output_dir else data_dir / 'search_index'

    print(f"🔍 Generating search index from: {data_dir}")
    builder = SearchIndexBuilder(data_dir)
    builder.process_all()
    builder.write_indexes(output_dir)


if __name__ == '__main__':
    main()
