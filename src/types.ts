/**
 * Shared types for the voter search application.
 * @module types
 */

export interface VoterRecord {
  sn: number | string | null;
  psn?: string;
  vn: string;
  vk: string;
  rn: string;
  rk: string;
  rt: string;
  g: string;
  a: number | string | null;
  hn?: string;
  id?: string | null;
  pn?: number | string;
  ac?: number | string;
  dq?: number;
  vt?: string[];
  rnt?: string[];
}

export interface SearchFilters {
  voterName: string;
  relName: string;
  age: string;
  relType: string;
  gender: string;
  voterId: string;
}

export interface SearchResult {
  voter: VoterRecord;
  score: number;
  partKey?: string;
}

export interface MasterIndex {
  schema_version: string;
  generated_at: string;
  stats: {
    total_districts_live: number;
    total_voters_live: number;
  };
  districts: Record<string, DistrictInfo>;
}

export interface DistrictInfo {
  status: 'live' | 'coming_soon' | 'planned';
  display_name: string;
  voter_count: number;
  ac_count: number;
  acs: ACInfo[];
}

export interface ACInfo {
  ac_num: number;
  name: string;
  voter_count: number;
  part_count: number;
}

export interface PartIndex {
  ac_num: number;
  ac_name: string;
  district: string;
  parts: PartInfo[];
}

export interface PartInfo {
  part_num: number;
  voter_count: number;
  file: string;
}

export interface ACDataEntry {
  name: string;
  num: string;
}
