/** Core types for the SeeCode architecture graph */

export type NodeCategory =
  | 'core'
  | 'voice'
  | 'visual'
  | 'api-client'
  | 'proxy'
  | 'external'
  | 'utility'
  | 'data'
  | 'config';

export interface ArchModule {
  id: string;
  name: string;
  files: string[];
  category: NodeCategory;
  responsibility: string;
  keyTypes: string[];
  keyMethods: string[];
  lineCount?: number;
}

export interface ArchEdge {
  from: string;
  to: string;
  type: 'owns' | 'depends' | 'dataflow' | 'weak';
  label?: string;
}

export interface DataTrace {
  name: string;
  description: string;
  path: string[]; // module IDs in order
}

export interface ArchGraph {
  repoUrl: string;
  repoName: string;
  commitSha: string;
  analyzedAt: string;
  modules: ArchModule[];
  edges: ArchEdge[];
  traces: DataTrace[];
  mermaid?: string; // Raw Mermaid source for debug view
}

/** Category → color mapping */
export const CATEGORY_COLORS: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  core:       { bg: '#1a2744', border: '#3b82f6', text: '#bfdbfe' },
  voice:      { bg: '#14332a', border: '#22c55e', text: '#bbf7d0' },
  visual:     { bg: '#2a1a3f', border: '#a855f7', text: '#e9d5ff' },
  'api-client': { bg: '#332a14', border: '#f59e0b', text: '#fef3c7' },
  proxy:      { bg: '#0f2f33', border: '#06b6d4', text: '#cffafe' },
  external:   { bg: '#331a1a', border: '#ef4444', text: '#fecaca' },
  utility:    { bg: '#1e2028', border: '#64748b', text: '#cbd5e1' },
  data:       { bg: '#33142a', border: '#ec4899', text: '#fce7f3' },
  config:     { bg: '#231a3f', border: '#8b5cf6', text: '#ddd6fe' },
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  core: 'Core',
  voice: 'Voice',
  visual: 'Visual',
  'api-client': 'AI',
  proxy: 'Proxy',
  external: 'External',
  utility: 'Utility',
  data: 'Data',
  config: 'Config',
};
