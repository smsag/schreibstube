export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingEntry {
  level: HeadingLevel;
  text: string;
  lineNumber: number;
}

export type HeadingIndex = HeadingEntry[];

export type FocusMode = "off" | "sentence" | "paragraph";

export interface OverlayState {
  ancestorStack: HeadingEntry[];
  expandedLevel: HeadingLevel | null;
}

export interface SchreibstubeSettings {
  focusMode: FocusMode;
  focusDimOpacity: number;
}
