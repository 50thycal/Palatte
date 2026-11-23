// Types for palate-keys. The package itself is plain JavaScript.

export interface KeysContext {
  readonly el: HTMLInputElement | HTMLTextAreaElement;
  readonly text: string;
  readonly caret: number;
  readonly selection: { start: number; end: number; text: string };
  /** Insert at the caret. Supports {date} {time} {day} {iso} and a {cursor} marker. */
  insert(text: string): void;
  replace(start: number, end: number, text: string): void;
  replaceAll(text: string): void;
  clear(): void;
  setCaret(pos: number): void;
  backspace(): void;
  /** Press return: on an <input> it fires a keydown Enter and a `pk-enter` event. */
  submit(): void;
  setLayer(name: string): void;
  /** A short note in the prediction bar */
  flash(text: string): void;
  /** Hand this field to the system keyboard (dictation) until it loses focus */
  useSystemKeyboard(): void;
  hide(): void;
}

export interface HotkeyAction {
  label?: string;
  insert?: string;
  run?(ctx: KeysContext): void;
}

export interface Hotkey extends HotkeyAction {
  title?: string;
  /** Width in key units (default 1) */
  w?: number;
  /** 'plain' drops the accent colour */
  style?: 'hot' | 'plain';
  /** Swipe up: text to insert, or an action */
  alt?: string | HotkeyAction;
  /** Long press: text to insert, or an action */
  hold?: string | HotkeyAction;
  /** Jump to a layer instead of inserting */
  layer?: string;
  /** Hand the field to the system keyboard (the 🎤 key) */
  dictate?: boolean;
}

export type KeyDef =
  | string
  | { k: string; alt?: string }
  | { action: 'shift' | 'backspace' | 'space' | 'enter' | 'undo' | 'redo'; label?: string; w?: number }
  | { action: 'layer'; to: string; label: string; w?: number }
  | Hotkey;

export interface KeysStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InitOptions {
  mode?: 'auto' | 'always' | 'off';
  autocorrect?: boolean;
  haptics?: boolean;
  onLearn?(word: string): void;
  onVisibility?(visible: boolean): void;
  /** Word list URL, or false to skip loading one */
  dictionary?: string | false;
  storage?: KeysStorage;
  storagePrefix?: string;
  layouts?: Record<string, KeyDef[][]>;
  hotkeys?: Hotkey[] | Record<string, Hotkey[]>;
  hotkeyLayers?: string[];
}

export function init(options?: InitOptions): void;
export function setMode(mode: 'auto' | 'always' | 'off'): void;
export function setAutocorrect(on: boolean): void;
export function setHaptics(on: boolean): void;
export function setDebug(on: boolean): void;
export function setHotkeys(list: Hotkey[]): void;
export function setHotkeys(name: string, list: Hotkey[]): void;
export function registerLayout(name: string, rows: KeyDef[][]): void;
export function setShortcuts(list: { trigger: string; expansion: string }[]): void;
export function setAction(action: { label: string; onTap(): void } | null): void;
export function flash(text: string): void;
/** Prepare [data-pk] fields under root (suppresses the system keyboard) */
export function decorate(root?: ParentNode): void;
export function refresh(): void;
export function isEnabled(): boolean;
export function isVisible(): boolean;
export function aimStats(): { taps: number; keysLearned: number };
export function resetAim(): void;
export function clearClips(): void;

export namespace lang {
  function setDictionary(words: string[]): void;
  function loadDictionary(url?: string): Promise<void>;
  /** Extra words with a weight: ship names, places, slang */
  function setPersonalVocabulary(map: Map<string, number>): void;
  function setLearnedWords(words: string[]): void;
  /** Phrase statistics for the last one or two words typed (lowercase): feeds predictions and autocorrect */
  function setContextSource(
    fn: (context: string[]) => Promise<{ bigrams?: { word: string; count: number }[]; trigrams?: { word: string; count: number }[] }>,
  ): void;
  /** The words offered at the start of a sentence */
  function setStarters(words: string[]): void;
  /** The corrected word, or null to leave it alone */
  function correct(word: string, opts?: { sentenceStart?: boolean; contextCounts?: Map<string, number> | null }): string | null;
  function matchCase(template: string, word: string): string;
  function isKnown(word: string): boolean;
  const DEFAULT_DICTIONARY_URL: string;
}

export const DEFAULT_SHORTCUTS: { trigger: string; expansion: string }[];
export function validateShortcut(s: { trigger: string; expansion: string }): string | null;
export const LAYOUTS: Record<string, KeyDef[][]>;
export const ACCENTS: Record<string, string[]>;
