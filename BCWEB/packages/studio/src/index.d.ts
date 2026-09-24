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
  rotate: number; shadow: string; hover: string;
  /** What pressing it does (actions.js, phase 5). A legacy `link` / `props.action` is read into it. */
  action: ActionStep[];
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
  /** The closed background (phase 4). `bgNote` is 'replaced' when a legacy `bg` could not be kept. */
  background: Background; bgNote: '' | 'replaced';
  grid: number; css: string;
  blocks: Block[];
}

/** A document as it is STORED (serializeDoc): defaults left out, derived values never written. */
export interface StoredDoc {
  v: 2; id: string; title: string; frames: Frames;
  /** Absent = `site`. `bg` is only ever READ (a page saved before phase 4). */
  background?: Background; bg?: string; grid?: number; css?: string;
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
export function validateDoc(doc: unknown, prefix?: string, opts?: { links?: LinkPolicy }): Problem[];
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

// ── Backgrounds (background.js, phase 4) ───────────────────────────────────────────────
export type BackgroundType = 'site' | 'color' | 'gradient' | 'image' | 'pattern' | 'scene3d' | 'board';
export interface GradientStop { color: string; at: number }
export type Background =
  | { type: 'site' }
  | { type: 'color'; color: string }
  | { type: 'gradient'; angle: number; stops: GradientStop[] }
  | { type: 'image'; src: string; fit: 'cover' | 'contain' | 'tile'; position: 'center' | 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'pattern'; id: string; color: string; size: number; opacity: number }
  | { type: 'scene3d'; shape: string; surface: 'solid' | 'wire' | 'both'; position: 'center' | 'left' | 'right';
      detail: number; noise: number; speed: number; opacity: number; scale: number; glow: number; twinkles: number; fps: number }
  | { type: 'board'; color: string; grid: number };
export const BACKGROUND_TYPES: readonly BackgroundType[];
export const BACKGROUND_FIELDS: Readonly<Record<BackgroundType, readonly string[]>>;
export const BG_TOKENS: readonly string[];
export const BG_IMAGE_PREFIXES: readonly string[];
export const BG_IMAGE_FITS: readonly string[];
export const BG_POSITIONS: readonly string[];
export const SCENE3D_POSITIONS: readonly string[];
export const BOARD_GRIDS: readonly number[];
export const GRADIENT_STOPS: Readonly<{ min: number; max: number }>;
export function bgColor(raw: unknown): string;
export function patternColor(raw: unknown): string;
export function bgImagePath(raw: unknown): string;
export function normalizeBackground(raw: unknown): Background;
export function serializeBackground(raw: unknown): Background | null;
export function backgroundFromLegacy(raw: unknown): { background: Background; recognized: boolean };
export function gradientCss(b: { angle: number; stops: GradientStop[] }): string;
export function backgroundStyle(raw: unknown): Record<string, string>;
export function backgroundProblems(raw: unknown, push: (path: string, reason: string, value: unknown) => void, at?: string): void;

// ── Patterns (patterns.js) and the scene vocabulary (scene.js) ─────────────────────────
export const PATTERNS: ReadonlyArray<{ id: string; name: string; nameFr: string; draw: (size: number, color: string) => string }>;
export const PATTERN_IDS: readonly string[];
export function patternImage(id: string, opts?: { color?: string; size?: number }): string;
export function patternStyle(cfg: { id?: string; color?: string; size?: number; opacity?: number } | null): Record<string, string>;
export const SCENE_SHAPES: readonly string[];
export const SCENE_SURFACES: readonly string[];
export const SCENE_BOUNDS: Readonly<Record<string, { min: number; max: number; step: number; unit: string }>>;
export const SHAPE_DETAIL_MAX: Readonly<Record<string, number>>;
export const SCENE_LOOK_DEFAULTS: Readonly<Record<string, string | number>>;
export function detailMaxFor(shape: string): number;
export function clampSceneNumber(key: string, value: unknown, shape: string, fallback?: number): number;

// ── Actions (actions.js, phase 5) ──────────────────────────────────────────────────────
export type ActionType = 'navigate' | 'page' | 'external' | 'mailto' | 'scroll' | 'reveal' | 'copy' | 'download' | 'submit' | 'theme';
export interface ActionStep {
  type: ActionType | string;
  to?: string; canvasId?: string; url?: string; address?: string; target?: string; mode?: string;
  text?: string; file?: string; asset?: string; endpoint?: string; fields?: Record<string, unknown>;
}
export interface LinkPolicy { mode: 'block' | 'allow'; hosts: string[] }
export interface SubmitField { kind: 'email' | 'id' | 'ids' | 'ref' | 'slug' | 'text'; required?: boolean; min?: number; max?: number; multiline?: boolean }
export interface SubmitEntry {
  method: 'POST'; path: string; pow: string | null;
  author: Readonly<Record<string, SubmitField>>; visitor: Readonly<Record<string, SubmitField>>; rateLimit: string;
}
export interface ActionPlan {
  kind: 'none' | 'link' | 'button' | 'inert';
  href: string; steps: ActionStep[]; reason: string;
  internal?: boolean; external?: boolean; download?: boolean; host?: string; at?: number; last?: ActionStep;
}
export const ACTION_TYPES: readonly ActionType[];
export const RESERVED_ACTIONS: readonly string[];
export const REMOVED_ACTIONS: Readonly<Record<string, string>>;
export const MAX_STEPS: number;
export const NAV_TYPES: readonly string[];
export const TERMINAL_TYPES: readonly string[];
export const STEP_FIELDS: Readonly<Record<ActionType, readonly string[]>>;
export const REVEAL_MODES: readonly string[];
export const THEME_MODES: readonly string[];
export const COPY_MAX: number;
export const URL_MAX: number;
export const DOWNLOAD_PREFIXES: readonly string[];
export const ASSET_KEY: RegExp;
export const LINK_POLICY_MODES: readonly string[];
export const MAX_POLICY_HOSTS: number;
export const DEFAULT_LINK_POLICY: Readonly<LinkPolicy>;
export const SUBMIT_REGISTRY: Readonly<Record<string, SubmitEntry>>;
export const SUBMIT_KEYS: readonly string[];
export function internalPath(raw: unknown): string;
export function normalizeHost(raw: unknown): string;
export function normalizeLinkPolicy(raw: unknown): LinkPolicy;
export function linkPolicyProblems(raw: unknown): Array<{ path: string; reason: string }>;
export function hostAllowed(host: string, policy: unknown): boolean;
export function externalUrl(raw: unknown, policy?: unknown): { href: string; host: string; reason: string };
export function mailAddress(raw: unknown): string;
export function downloadPath(raw: unknown): string;
export function submitFieldProblem(spec: SubmitField, value: unknown): string;
export function submitRequest(key: string, author: unknown, visitor: unknown, ctx?: { lang?: string; pow?: unknown }):
  { ok: true; method: string; url: string; body: Record<string, unknown>; pow: string | null } | { ok: false; field: string; reason: string };
export function stepProblems(step: unknown, ctx: { links?: LinkPolicy; blockIds?: Set<string> | null } | null, push: (field: string, reason: string, value: unknown) => void): void;
export function actionProblems(raw: unknown, ctx: { links?: LinkPolicy; blockIds?: Set<string> | null } | null, push: (path: string, reason: string, value: unknown) => void, at?: string): void;
export function normalizeAction(raw: unknown): ActionStep[];
export function legacyAction(block: unknown): ActionStep[];
export function blockSteps(block: unknown): ActionStep[];
export function migrateDocActions<T>(doc: T): T;
export function planAction(steps: unknown, ctx?: { links?: unknown; blockIds?: Set<string> | null }): ActionPlan;
export function revealTargets(blocks: unknown): Set<string>;
