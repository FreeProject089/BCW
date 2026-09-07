// Types for @bettercommunity/bmd-editor.
//
// The package shipped none, so every TypeScript consumer imported all three components as
// `any`: no prop names, no completion, and no error for a typo in one of them. That costs
// nothing inside this repo, where the only caller is JavaScript — and everything outside it,
// which is the point of publishing.
//
// Hand-written rather than generated, for the same reason bmd's markdown.d.ts is: the source
// is JSX with defaulted destructured props, and what a prop MEANS is not in the signature.

import type { ComponentType, ReactNode, RefObject } from 'react';

/** One insertable snippet. `md` may carry `${sel|default}` and `${cursor}` placeholders. */
export interface BmdSnippet {
  id: string;
  label: string;
  md: string;
  /** Inline snippets wrap a selection (bold, a link) rather than inserting a block. */
  inline?: boolean;
  shortcut?: string;
}
export interface BmdSnippetGroup {
  id?: string;
  label: string;
  icon?: string;
  items: BmdSnippet[];
}

export const SNIPPET_GROUPS: BmdSnippetGroup[];
export const SNIPPETS: BmdSnippet[];
/** Fill a snippet's placeholders against the current selection. */
export function expandSnippet(md: string, selection?: string): { text: string; caret?: number };
/** The same groups with their labels in `lang`, falling back to English per string. */
export function localizeSnippetGroups(groups: BmdSnippetGroup[], lang: string): BmdSnippetGroup[];

/** The inline SVG path data the editor draws its own toolbar with. */
export const ICO: Record<string, string>;

export interface BmdEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  lang?: string;
  /** Known page paths, for the link checker's "this link goes nowhere" pass. */
  pageMap?: Record<string, unknown> | null;
  /** `auto` picks side-by-side or tabs from `breakpoint`; `tabs` and `split` force one. */
  layout?: 'auto' | 'tabs' | 'split';
  breakpoint?: number;
  height?: string | number;
  toolbar?: boolean;
  status?: boolean;
  compact?: boolean;
  snippetGroups?: BmdSnippetGroup[];
  extraGroups?: BmdSnippetGroup[];
  placeholder?: string;
  exportTitle?: string;
  onSave?: (value: string) => void;
  markdownProps?: Record<string, unknown>;
  className?: string;
  extraTools?: ReactNode;
  /**
   * The host's own ref on the textarea. Anything that needs the SELECTION needs the element —
   * a floating format toolbar cannot find one otherwise.
   */
  textareaRef?: RefObject<HTMLTextAreaElement> | null;
}
declare const BmdEditor: ComponentType<BmdEditorProps>;
export default BmdEditor;

export interface BmdBlockCanvasProps {
  value?: string;
  onChange?: (value: string) => void;
  snippetGroups?: BmdSnippetGroup[];
  /** The <Markdown> component, for the per-block preview. Omit for a source-only canvas. */
  renderer?: ComponentType<{ children?: string }> | null;
  lang?: string;
  /** UI strings; every key falls back to the built-in English. */
  labels?: Record<string, string> | null;
  /** Resolve an icon name for a directive's `icon=` — the host owns the picker. */
  pickIcon?: (() => Promise<string | null>) | null;
}
/** The document as a stack of reorderable cards, each editable in place. */
export const BmdBlockCanvas: ComponentType<BmdBlockCanvasProps>;

export interface BmdLivePreviewProps {
  value?: string;
  onChange?: (value: string) => void;
  renderer?: ComponentType<{ children?: string }> | null;
  lang?: string;
  snippetGroups?: BmdSnippetGroup[];
  labels?: Record<string, string> | null;
  /** Locked by default: the preview is read-only until the host (or the reader) unlocks it. */
  unlocked?: boolean;
  onUnlockedChange?: (unlocked: boolean) => void;
}
/** The rendered document, editable block by block where you are looking at it. */
export const BmdLivePreview: ComponentType<BmdLivePreviewProps>;
