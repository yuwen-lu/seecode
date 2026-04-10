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

export interface TraceStep {
  moduleId: string;
  summary: string;
  files?: string[];
  dataIn?: string;
  dataOut?: string;
}

export interface DynamicTrace {
  name: string;
  steps: TraceStep[];
}

export interface ArchGraph {
  repoUrl: string;
  repoName: string;
  commitSha: string;
  analyzedAt: string;
  modules: ArchModule[];
  edges: ArchEdge[];
  traces: DataTrace[];
}

/** Panel selection — either a component (group) or a specific module */
export type PanelSelection =
  | { kind: 'component'; category: NodeCategory; label: string; members: ArchModule[] }
  | { kind: 'module'; module: ArchModule };

/** Category → color mapping per theme */
const COLORS_DARK: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  core:       { bg: '#1a2744', border: '#3b82f6', text: '#bfdbfe' },
  voice:      { bg: '#14332a', border: '#22c55e', text: '#bbf7d0' },
  visual:     { bg: '#2a1a3f', border: '#a855f7', text: '#e9d5ff' },
  'api-client': { bg: '#2e2218', border: '#e8945a', text: '#fde0c8' },
  proxy:      { bg: '#0f2f33', border: '#06b6d4', text: '#cffafe' },
  external:   { bg: '#2e1a2a', border: '#f472b6', text: '#fad8e8' },
  utility:    { bg: '#1e2028', border: '#64748b', text: '#cbd5e1' },
  data:       { bg: '#33142a', border: '#ec4899', text: '#fce7f3' },
  config:     { bg: '#231a3f', border: '#8b5cf6', text: '#ddd6fe' },
};

const COLORS_LIGHT: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  core:       { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
  voice:      { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
  visual:     { bg: '#faf5ff', border: '#a855f7', text: '#6b21a8' },
  'api-client': { bg: '#fef5ee', border: '#e8945a', text: '#7c4a1e' },
  proxy:      { bg: '#ecfeff', border: '#06b6d4', text: '#155e75' },
  external:   { bg: '#fdf2f8', border: '#f472b6', text: '#9d174d' },
  utility:    { bg: '#f8fafc', border: '#64748b', text: '#334155' },
  data:       { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' },
  config:     { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6' },
};

export function getCategoryColors(isDark?: boolean): Record<NodeCategory, { bg: string; border: string; text: string }> {
  const dark = isDark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  return dark ? COLORS_DARK : COLORS_LIGHT;
}

/** @deprecated Use getCategoryColors() for theme-aware colors */
export const CATEGORY_COLORS = COLORS_DARK;

/** Build a raw GitHub URL for fetching file contents */
export function githubRawUrl(repoUrl: string, commitSha: string, filePath: string): string {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return "";
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commitSha}/${filePath}`;
}

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
