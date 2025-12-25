/**
 * Cell options for executable code blocks
 * Inspired by RMarkdown chunk options
 */
export interface CellOptions {
  /** Use Shadow DOM for CSS/JS isolation */
  shadow: boolean;
  /** Show source after execution (default: true) */
  echo: boolean;
  /** Don't auto-render on load, require manual run */
  defer: boolean;
  /** Scope CSS to this cell using unique class (non-shadow alternative) */
  scope: boolean;
}

/**
 * Metadata for an executed HTML cell
 */
export interface HtmlCellMeta {
  execId: string;
  options: CellOptions;
  sourceRange: { from: number; to: number };
}

/**
 * Default cell options
 */
export const DEFAULT_CELL_OPTIONS: CellOptions = {
  shadow: false,
  echo: true,
  defer: false,
  scope: false,
};
