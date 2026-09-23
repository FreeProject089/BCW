// Types for @bettercommunity/studio. The runtime is plain ESM (src/*.js); these describe it.

export type BlockKind = 'text' | 'image' | 'box' | 'video' | 'embed' | 'replay' | 'button' | 'shape' | 'svg';
export type FrameFit = 'fixed' | 'content';
export type PhoneMode = 'stack' | 'board';
export type Board = 'light' | 'dark' | 'phone';

export interface Frame { w: number; h?: number; fit: FrameFit }
export interface PhoneFrame extends Frame { mode: PhoneMode }
export interface Frames { desktop: Frame; phone: PhoneFrame }

export interface BlockAnim {
  kind: string; trigger?: string; delay?: number; duration?: number; easing?: string; loop?: boolean; custom?: string;
}
export interface Overlay { x?: number; y?: number; w?: number; h?: number; opacity?: number; hidden?: boolean; props?: Record<string, unknown> }
export interface PhonePlace { order?: number; hidden?: boolean; x?: number; y?: number; w?: number; h?: number }

export interface Block {
  id: string;
  kind: BlockKind;
  /** Board coordinates: may be negative or beyond the frame, within ±BOUND. */
  x: number; y: number; w: number; h: number; z: number;
  props: Record<string, unknown>;
  opacity: number;
  themes: { light?: Overlay; dark?: Overlay };
  phone: PhonePlace | null;
  anim: BlockAnim | null;
  name: string; locked: boolean; hidden: boolean;
  rotate: number; shadow: string; hover: string; link: string;
  component: { id: string; inst: string } | null;
}

/** A document as `normalizeDoc` returns it: v2, every field present. */
export interface StudioDoc {
  v: 2;
  id: string;
  title: string;
  frames: { desktop: Required<Frame>; phone: Required<PhoneFrame> };
  /** Read-only conveniences derived from `frames`; never stored. */
  height: number; phoneHeight: number; phoneBoard: boolean;
  bg: string; grid: number; css: string;
  blocks: Block[];
}

/** A document as it is STORED (serializeDoc): defaults left out, derived values never written. */
export interface StoredDoc {
  v: 2; id: string; title: string; frames: Frames;
  bg?: string; grid?: number; css?: string;
  blocks: Array<Partial<Block> & Pick<Block, 'id' | 'kind' | 'x' | 'y' | 'w' | 'h' | 'z'>>;
}

export interface Problem { path: string; reason: string; key: string }
export interface View { x: number; y: number; s: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const DOC_VERSION: 2;
export const BOUND: number;
export const DESIGN_WIDTH: number;
export const PHONE_WIDTH: number;
export const STACK_BELOW: number;
export const MIN_SCALE: number;
export const GRID: number;
export const MIN_FRAME_H: number;
export const ZOOM_MIN: number;
export const ZOOM_MAX: number;
export const MAX_DOC_BYTES: number;
export const LIMITS: Readonly<Record<string, number>>;
export const BLOCK_KINDS: readonly BlockKind[];
export const SHAPES: readonly string[];
export const ANIM_KINDS: readonly string[];
export const ANIM_TRIGGERS: readonly string[];
export const ANIM_EASINGS: readonly string[];
export const EASING_CURVES: Readonly<Record<string, string>>;
export const BUTTON_VARIANTS: readonly string[];
export const BUTTON_ACTIONS: readonly string[];
export const LEGACY_ACTIONS: Readonly<Record<string, string>>;
export const SHADOWS: readonly string[];
export const HOVER_EFFECTS: readonly string[];
export const GRID_SIZES: readonly number[];
export const TEXT_ALIGNS: readonly string[];
export const COMMON_PROPS: readonly string[];
export const KIND_PROPS: Readonly<Record<BlockKind, readonly string[]>>;
export const BLOCK_KEYS: readonly string[];
export const FRAME_WIDTHS: Readonly<{ desktop: number; phone: number }>;
export const FRAME_FITS: readonly FrameFit[];
export const PHONE_MODES: readonly PhoneMode[];
export const ID_SHAPE: RegExp;
export const HANDLES: Readonly<Record<string, [number, number]>>;

// The document
export function migrate(raw: unknown): Record<string, unknown>;
export function normalizeDoc(raw: unknown): StudioDoc;
export const normalizeCanvas: typeof normalizeDoc;
export function serializeDoc(doc: unknown, extra?: Record<string, unknown>): StoredDoc;
export function serializeCanvas(doc: unknown, raw?: unknown, extra?: Record<string, unknown>): StoredDoc;
export function validateDoc(doc: unknown, prefix?: string): Problem[];
export function cssValueOk(value: unknown): boolean;
export function pinsToViewport(css: unknown): boolean;
export function propAllowed(kind: string, key: string): boolean;
export function cleanProps(kind: string, raw: unknown): Record<string, unknown>;

// Links and actions
export function safeLink(raw: unknown): string;
export function menuItemHref(raw: unknown): string;
export function buttonTarget(action: unknown): { type: string; href: string; external: boolean; reason: string };

// Layout
export function inFrame(b: Partial<Rect>, frame: { w: number; h: number }): boolean;
/** The blocks a reader gets: what crosses the frame, in paint (or reading) order. */
export function frameBlocks(doc: StudioDoc, mode?: 'scale' | 'phone' | 'stack', theme?: 'light' | 'dark'): Block[];
export const ALIGNMENTS: readonly string[];
export function frameContentHeight(blocks: Partial<Rect>[], frameW?: number): number;
export function contentHeight(blocks: Partial<Rect>[]): number;
export function phoneBoardBlocks(blocks: Block[], band?: number, desk?: { w: number; h: number } | null): Array<Block & { placed: boolean; parked?: boolean }>;
export function phoneContentHeight(blocks: Block[], desk?: { w: number; h: number } | null): number;
export function phoneOrder(blocks: Block[], band?: number): Block[];
export function readingOrder<T extends Partial<Rect>>(blocks: T[], band?: number): T[];
export function paintOrder<T extends { z?: number }>(blocks: T[]): T[];
export function resolveBlock(b: Block, theme?: string): Block;
export function layoutFor(viewportWidth: number, doc: StudioDoc): { mode: 'scale' | 'phone' | 'stack'; scale: number; width: number; height: number | null };
export function keepsHeightStacked(kind: string): boolean;
export function snap(v: number, grid?: number): number;

// Editing
export function dragTo(start: Partial<Rect>, dx: number, dy: number, scale: number, opts?: { snap?: boolean; grid?: number; width?: number }): { x: number; y: number };
export function resizeTo(start: Rect, handle: string, dx: number, dy: number, scale: number, opts?: { snap?: boolean; grid?: number; min?: number; width?: number }): Rect;
export function alignmentGuides(moving: Rect & { id?: string }, others: Array<Rect & { id?: string }>, tol?: number): { v: { at: number; delta: number } | null; h: { at: number; delta: number } | null };
export function boundsOf(blocks: Partial<Rect>[]): Rect | null;
export function blocksInRect<T extends Partial<Rect>>(blocks: T[], rect: Rect): T[];
export function moveMany<T extends Partial<Rect> & { id: string }>(blocks: T[], ids: string[], dx: number, dy: number, scale: number, opts?: Record<string, unknown>): T[];
export function alignMany<T>(blocks: T[], ids: string[], how: string): T[];
export function distributeMany<T>(blocks: T[], ids: string[], axis?: 'x' | 'y'): T[];
export function matchSizeMany<T>(blocks: T[], ids: string[], axis: 'w' | 'h', width?: number): T[];
export function bringTo<T>(blocks: T[], id: string, where: 'front' | 'back'): T[];
export function reorder<T>(blocks: T[], id: string, dir: 'up' | 'down'): T[];
export function boardBlocks(doc: StudioDoc, board?: Board): Block[];
export function boardFrame(doc: StudioDoc, board?: Board): { w: number; h: number; fit: FrameFit };
export function offFrameIds(doc: StudioDoc, board?: Board): Set<string>;
export function commitGeometry(blocks: Block[], before: Block[], after: Block[], board?: Board): { blocks: Block[]; extra: Record<string, unknown> };
export function alignOnBoard(doc: StudioDoc, ids: string[], how: string, board?: Board): { blocks: Block[]; extra: Record<string, unknown> };
export function distributeOnBoard(doc: StudioDoc, ids: string[], axis: 'x' | 'y', board?: Board): { blocks: Block[]; extra: Record<string, unknown> };
export function matchSizeOnBoard(doc: StudioDoc, ids: string[], axis: 'w' | 'h', board?: Board): { blocks: Block[]; extra: Record<string, unknown> };
export function duplicateOnBoard(doc: StudioDoc, ids: string[], board: Board, newId: () => string): { blocks: Block[]; ids: string[]; extra: Record<string, unknown> };
export function placeOnBoard(doc: StudioDoc, fresh: Block[], board?: Board): { blocks: Block[]; extra: Record<string, unknown> };
export function dragPatch(view: Rect, next: { x: number; y: number }, board?: Board): Partial<Rect>;

// The camera
export function clampZoom(s: number): number;
export function toBoard(view: View, sx: number, sy: number): { x: number; y: number };
export function toScreen(view: View, bx: number, by: number): { x: number; y: number };
export function zoomAt(view: View, sx: number, sy: number, nextScale: number): View;
export function wheelZoom(view: View, sx: number, sy: number, deltaY: number, deltaMode?: number): View;
export function pinchView(start: View, a0: { x: number; y: number }, b0: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): View;
export function fitFrameView(frame: { w: number; h?: number }, hostW: number, hostH: number, pad?: number): View;
export function showAllView(frame: { w: number; h: number }, blocks: Partial<Rect>[], hostW: number, hostH: number, pad?: number): View;
export function revealView(view: View, rect: Rect, hostW: number, hostH: number, pad?: number): View;

// Undo
export const HISTORY_LIMIT: number;
export const COALESCE_MS: number;
export interface History { past: unknown[]; future: unknown[]; key: string | null; at: number }
export function emptyHistory(): History;
export function pushHistory(hist: History, snapshot: unknown, key?: string | null, now?: number): History;
export function undo(hist: History, current: unknown): { hist: History; value: unknown } | null;
export function redo(hist: History, current: unknown): { hist: History; value: unknown } | null;

// Presets
export const CANVAS_PRESETS: ReadonlyArray<{ id: string; name: string; nameFr: string; blocks: () => Array<Partial<Block>> }>;
export const STAGGER_STEPS: readonly number[];
export function presetBlocks(id: string): Array<Partial<Block>>;

// CSS and SVG
export function decodeCssEscapes(input: string): string;
export function safeCssValue(input: unknown): string;
export function scopeCss(input: string, scope: string): { css: string; refused: string[] };
export function safeClasses(input: unknown): string;
export function safeInlineStyle(input: unknown): Record<string, string>;
export function sanitizeSvg(input: unknown): string;
export function svgRefusals(input: unknown): string[];
