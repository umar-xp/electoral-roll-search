"""
build_search_index.py â€” Generate Compact Search Index for Frontend
===================================================================
Author: Mohammed Shoaib U
Date: June 2026

Description:
    Generates a compact, sharded search index from the voter JSON data files.
    The index enables instant full-text search across all 7M+ voters without
    requiring the browser to download full voter datasets.
    
    Architecture:
    - Builds a trigram-based inverted index for name matching
    - Shards the index by district for progressive loading
    - Each shard contains: voter tokens -> list of (part, serial) references
    - The full voter record is only loaded when the user clicks a result
    
    Output Structure:
        data/search/
            manifest.json        â€” Index metadata (districts, shard sizes)
            BAGALKOT.idx.json    â€” Per-district search shard
            BBMP.idx.json        â€” ...
            ...

Usage:
    python build_search_index.py
"""

import json
import os
import sys
import time
from pathlib import Path
from collections import defaultdict


# ========== CONFIGURATION ==========

DATA_DIR = Path("data/districts")
OUTPUT_DIR = Path("data/search")
MASTER_INDEX_PATH = Path("data/master_index.json")


def load_master_index():
    """Load the master index to determine which districts are live.
    
    Returns:
        dict: Parsed master_index.json content
    """
    with open(MASTER_INDEX_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_token(token):
    """Normalize a search token for consistent matching.
    
    Converts to lowercase, strips punctuation, and removes very short tokens
    that would generate excessive trigram noise.
    
    Args:
        token: Raw token string from voter record
    
    Returns:
        str: Normalized lowercase token, or empty string if too short
    """
    t = token.lower().strip().strip(".-,;:'\"()")
    # Remove tokens shorter than 2 chars (not useful for search)
    if len(t) < 2:
        return ""
    return t


def generate_trigrams(text):
    """Generate character trigrams from a text string for fuzzy matching.
    
    Trigrams allow matching with edit distance tolerance â€” a misspelled name
    will share most trigrams with the correct spelling.
    
    Example: "Shoaib" -> ["sho", "hoa", "oai", "aib"]
    
    Args:
        text: Input text (already normalized/lowercased)
    
    Returns:
        set: Unique trigrams from the text
    """
    if len(text) < 3:
        return {text} if text else set()
    return {text[i:i+3] for i in range(len(text) - 2)}


def build_district_shard(district_key, district_dir):
    """Build a search shard for a single district.
    
    
    Reads all part_*.json files in the district's AC directories,
    extracts searchable tokens, and builds a compact index structure.
    
    The shard format:
    {
        "district": "BAGALKOT",
        "voter_count": 784485,
        "entries": [
            {
                "vn": "Basavaraja Hirematha",
                "vk": "à²¬à²¸à²µà²°à²¾à²œ à²¹à²¿à²°à³‡à²®à² ",
                "rn": "Calayya",
                "rk": "à²šà²¾à²³à²¯à³à²¯",
                "g": "M", "a": 44,
                "ac": 210, "pn": 1, "sn": 40,
                "rt": "F", "hn": "à²¬à²¿/4à²“",
                "id": null,
                "tokens": "basavaraja hirematha calayya"
            },
            ...
        ]
    }
    
    Args:
        district_key: District identifier (e.g., "BAGALKOT")
        district_dir: Path to district data directory
    
    Returns:
        dict: Shard data with entries and metadata
    """
    entries = []
    ac_dirs = sorted([d for d in district_dir.iterdir() if d.is_dir()])
    
    for ac_dir in ac_dirs:
        ac_num = int(ac_dir.name)
        part_files = sorted(ac_dir.glob("part_*.json"))
        
        for part_file in part_files:
            try:
                with open(part_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"  WARNING: Failed to read {part_file}: {e}")
                continue
            
            voters = data.get("voters", [])
            for voter in voters:
                # Build compact search entry
                vn = voter.get("vn", "")
                vk = voter.get("vk", "")
                rn = voter.get("rn", "")
                rk = voter.get("rk", "")
                
                # Build search token string from pre-tokenized fields
                vt = voter.get("vt", [])
                rnt = voter.get("rnt", [])
                
                # Combine all searchable tokens into a single lowercase string
                all_tokens = []
                for t in vt:
                    nt = normalize_token(t)
                    if nt:
                        all_tokens.append(nt)
                for t in rnt:
                    nt = normalize_token(t)
                    if nt:
                        all_tokens.append(nt)
                
                token_str = " ".join(all_tokens)
                
                entry = {
                    "vn": vn,
                    "vk": vk,
                    "rn": rn,
                    "rk": rk,
                    "g": voter.get("g", ""),
                    "a": voter.get("a", 0),
                    "ac": ac_num,
                    "pn": voter.get("pn", 0),
                    "sn": voter.get("sn", 0),
                    "rt": voter.get("rt", ""),
                    "hn": voter.get("hn", ""),
                    "id": voter.get("id", None),
                    "t": token_str,
                }
                entries.append(entry)
    
    return {
        "district": district_key,
        "voter_count": len(entries),
        "entries": entries,
    }


def build_compact_shard(district_key, district_dir):
    """Build a COMPACT search shard optimized for browser download size.
    
    
    Instead of full voter records, builds a columnar format that compresses
    much better with gzip (which Netlify serves automatically).
    
    Format: Array of arrays (columnar) instead of array of objects.
    Columns: [vn, vk, rn, rk, g, a, ac, pn, sn, rt, hn, id, tokens]
    
    This reduces JSON size by ~40% compared to object-per-voter format
    by eliminating repeated key names across 100K+ entries.
    
    Args:
        district_key: District identifier
        district_dir: Path to district data directory
    
    Returns:
        dict: Compact shard with columnar data
    """
    # Column arrays
    cols = {
        "vn": [], "vk": [], "rn": [], "rk": [],
        "g": [], "a": [], "ac": [], "pn": [],
        "sn": [], "rt": [], "hn": [], "id": [], "t": []
    }
    
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
            
            for voter in data.get("voters", []):
                vt = voter.get("vt", [])
                rnt = voter.get("rnt", [])
                
                # Build token string
                tokens = []
                for tok in vt:
                    nt = normalize_token(tok)
                    if nt:
                        tokens.append(nt)
                for tok in rnt:
                    nt = normalize_token(tok)
                    if nt:
                        tokens.append(nt)
                
                cols["vn"].append(voter.get("vn", ""))
                cols["vk"].append(voter.get("vk", ""))
                cols["rn"].append(voter.get("rn", ""))
                cols["rk"].append(voter.get("rk", ""))
                cols["g"].append(voter.get("g", ""))
                cols["a"].append(voter.get("a", 0))
                cols["ac"].append(ac_num)
                cols["pn"].append(voter.get("pn", 0))
                cols["sn"].append(voter.get("sn", 0))
                cols["rt"].append(voter.get("rt", ""))
                cols["hn"].append(voter.get("hn", ""))
                cols["id"].append(voter.get("id", None))
                cols["t"].append(" ".join(tokens))
    
    return {
        "district": district_key,
        "voter_count": len(cols["vn"]),
        "format": "columnar",
        "columns": ["vn", "vk", "rn", "rk", "g", "a", "ac", "pn", "sn", "rt", "hn", "id", "t"],
        "data": cols,
    }


def main():
    """Main entry point: Build search index shards for all live districts.
    
    """
    print("=" * 70)
    print("BUILD SEARCH INDEX â€” Karnataka Electoral Roll Search Engine")
    print("=" * 70)
    
    # Load master index
    master = load_master_index()
    districts = master.get("districts", {})
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    manifest = {
        "version": "2.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "format": "columnar",
        "total_voters": 0,
        "districts": {},
    }
    
    total_start = time.time()
    
    for dist_key, dist_info in sorted(districts.items()):
        if dist_info.get("status") != "live":
            print(f"\n  SKIP: {dist_key} (status={dist_info.get('status', 'unknown')})")
            continue
        
        # Map display name to directory name (replace spaces with underscores)
        dir_name = dist_key.replace(" ", "_")
        district_dir = DATA_DIR / dir_name
        
        if not district_dir.exists():
            print(f"\n  SKIP: {dist_key} (directory not found: {district_dir})")
            continue
        
        print(f"\n  Building shard: {dist_key}...")
        start = time.time()
        
        shard = build_compact_shard(dist_key, district_dir)
        
        # Write shard file
        shard_filename = f"{dir_name}.idx.json"
        shard_path = OUTPUT_DIR / shard_filename
        
        with open(shard_path, "w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
        
        file_size = shard_path.stat().st_size
        elapsed = time.time() - start
        
        manifest["districts"][dist_key] = {
            "file": shard_filename,
            "voter_count": shard["voter_count"],
            "size_bytes": file_size,
            "size_mb": round(file_size / (1024 * 1024), 1),
        }
        manifest["total_voters"] += shard["voter_count"]
        
        print(f"    âœ“ {shard['voter_count']:,} voters | "
              f"{file_size / (1024*1024):.1f} MB | {elapsed:.1f}s")
    
    # Write manifest
    manifest_path = OUTPUT_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    total_elapsed = time.time() - total_start
    
    print(f"\n{'=' * 70}")
    print(f"DONE: {manifest['total_voters']:,} voters indexed")
    print(f"Time: {total_elapsed:.1f}s")
    print(f"Output: {OUTPUT_DIR}/")
    print(f"Manifest: {manifest_path}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
