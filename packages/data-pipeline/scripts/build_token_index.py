"""
build_token_index.py â€” Generate Compact Token Lookup Index
============================================================
Author: Mohammed Shoaib U
Date: June 2026

Description:
    Builds a lightweight token-to-location index that enables the browser
    to quickly identify which part files contain a given name WITHOUT
    downloading all voter data.
    
    The token index maps: normalized_name_token -> list of (district, ac, part)
    
    This is ~5-15MB (gzipped ~2-4MB) and allows instant narrowing of
    search space from 7M voters to typically 10-50 relevant part files.
    
    Architecture:
        1. Scan all part_*.json files
        2. For each voter, extract name tokens
        3. Build inverted index: token -> set of (district, ac, part) locations
        4. Prune very common tokens (> 500 locations = generic names like "Kumar")
        5. Output sharded by first character for parallel loading

    Output:
        data/search/token_index_manifest.json
        data/search/tokens_a.json, tokens_b.json, ... tokens_z.json
        data/search/tokens_ka.json (Kannada tokens)

Usage:
    python build_token_index.py
"""

import json
import os
import time
from pathlib import Path
from collections import defaultdict


# ========== CONFIGURATION ==========

DATA_DIR = Path("data/districts")
OUTPUT_DIR = Path("data/search")
MASTER_INDEX_PATH = Path("data/master_index.json")

# Tokens appearing in more than this many parts are too generic for lookup
MAX_PARTS_PER_TOKEN = 800


def normalize_token(token):
    """Normalize a name token for indexing.
    
    
    Args:
        token: Raw name token
    
    Returns:
        str: Lowercase, stripped token (empty if too short)
    """
    t = token.lower().strip().strip(".-,;:'\"()0123456789")
    if len(t) < 3:
        return ""
    return t


def build_token_index():
    """Build the inverted token index across all live districts.
    
    
    Scans every voter record and maps each name token to the set of
    (district, ac, part) tuples where that token appears.
    
    Returns:
        tuple: (token_to_locations dict, stats dict)
    """
    # token -> set of "DISTRICT|AC|PART" strings
    token_index = defaultdict(set)
    stats = {"total_voters": 0, "total_tokens": 0, "districts": 0}
    
    with open(MASTER_INDEX_PATH, "r", encoding="utf-8") as f:
        master = json.load(f)
    
    districts = master.get("districts", {})
    
    for dist_key, dist_info in sorted(districts.items()):
        if dist_info.get("status") != "live":
            continue
        
        dir_name = dist_key.replace(" ", "_")
        district_dir = DATA_DIR / dir_name
        
        if not district_dir.exists():
            continue
        
        stats["districts"] += 1
        print(f"  Indexing: {dist_key}...", end="", flush=True)
        dist_voters = 0
        
        ac_dirs = sorted([d for d in district_dir.iterdir() if d.is_dir()])
        
        for ac_dir in ac_dirs:
            try:
                ac_num = int(ac_dir.name)
            except ValueError:
                continue
            
            part_files = sorted(ac_dir.glob("part_*.json"))
            
            for part_file in part_files:
                try:
                    with open(part_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except (json.JSONDecodeError, IOError):
                    continue
                
                # Extract part number from filename
                part_num = int(part_file.stem.split("_")[1])
                location = f"{dir_name}|{ac_num}|{part_num}"
                
                for voter in data.get("voters", []):
                    dist_voters += 1
                    
                    # Index voter name tokens
                    for tok in voter.get("vt", []):
                        nt = normalize_token(tok)
                        if nt:
                            token_index[nt].add(location)
                    
                    # Index relative name tokens
                    for tok in voter.get("rnt", []):
                        nt = normalize_token(tok)
                        if nt:
                            token_index[nt].add(location)
        
        stats["total_voters"] += dist_voters
        print(f" {dist_voters:,} voters")
    
    stats["total_tokens"] = len(token_index)
    return token_index, stats


def shard_and_write(token_index, stats):
    """Shard the token index by first character and write to disk.
    
    
    Groups tokens by their first character (a-z for English, Kannada block
    for Kannada tokens) and writes each group as a separate JSON file.
    This allows the browser to load only the relevant shard.
    
    Args:
        token_index: dict mapping token -> set of location strings
        stats: Statistics dict to update
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Group tokens by first character
    shards = defaultdict(dict)
    pruned = 0
    
    for token, locations in token_index.items():
        # Prune overly common tokens (they're useless for narrowing)
        if len(locations) > MAX_PARTS_PER_TOKEN:
            pruned += 1
            continue
        
        # Determine shard key
        first_char = token[0] if token else "_"
        if "a" <= first_char <= "z":
            shard_key = first_char
        elif "\u0C80" <= first_char <= "\u0CFF":
            # Kannada Unicode block â€” group into one shard
            shard_key = "kn"
        else:
            shard_key = "other"
        
        # Convert set to sorted list for JSON serialization
        shards[shard_key][token] = sorted(locations)
    
    # Write shard files
    manifest_shards = {}
    total_size = 0
    
    for shard_key, tokens in sorted(shards.items()):
        filename = f"tokens_{shard_key}.json"
        filepath = OUTPUT_DIR / filename
        
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(tokens, f, ensure_ascii=False, separators=(",", ":"))
        
        file_size = filepath.stat().st_size
        total_size += file_size
        
        manifest_shards[shard_key] = {
            "file": filename,
            "token_count": len(tokens),
            "size_bytes": file_size,
        }
    
    # Write manifest
    manifest = {
        "version": "1.0",
        "type": "token_index",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_voters": stats["total_voters"],
        "total_tokens": stats["total_tokens"],
        "tokens_pruned": pruned,
        "max_parts_per_token": MAX_PARTS_PER_TOKEN,
        "total_index_size_mb": round(total_size / (1024 * 1024), 2),
        "shard_count": len(manifest_shards),
        "shards": manifest_shards,
    }
    
    manifest_path = OUTPUT_DIR / "token_index_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    return manifest, total_size, pruned


def main():
    """Main: Build and shard the token lookup index.
    
    """
    print("=" * 70)
    print("BUILD TOKEN INDEX â€” Fast Lookup for Karnataka Voter Search")
    print("=" * 70)
    
    start = time.time()
    
    print("\nPhase 1: Scanning all voter records...")
    token_index, stats = build_token_index()
    
    print(f"\nPhase 2: Sharding and writing index files...")
    manifest, total_size, pruned = shard_and_write(token_index, stats)
    
    elapsed = time.time() - start
    
    print(f"\n{'=' * 70}")
    print(f"DONE")
    print(f"  Total voters indexed: {stats['total_voters']:,}")
    print(f"  Unique tokens: {stats['total_tokens']:,}")
    print(f"  Tokens pruned (too common): {pruned:,}")
    print(f"  Index shards: {manifest['shard_count']}")
    print(f"  Total index size: {total_size / (1024*1024):.1f} MB")
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Output: {OUTPUT_DIR}/")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
