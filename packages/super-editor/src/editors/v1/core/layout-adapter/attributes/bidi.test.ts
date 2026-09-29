import { describe, it, expect } from 'vitest';
import { mirrorIndentForRtl } from './bidi.js';
import type { ParagraphIndent } from '@superdoc/contracts';

describe('mirrorIndentForRtl', () => {
  it('swaps left and right', () => {
    const input: ParagraphIndent = { left: 10, right: 20 };
    expect(mirrorIndentForRtl(input)).toEqual({ left: 20, right: 10 });
  });

  it('preserves firstLine and hanging (dir=rtl + text-indent handles direction)', () => {
    // The RTL paint path applies firstLine/hanging via CSS text-indent on a
    // dir="rtl" element; negating here would outdent the first line. Side
    // fields are absent so the indent is returned unchanged.
    const input: ParagraphIndent = { firstLine: 12, hanging: -8 };
    expect(mirrorIndentForRtl(input)).toBe(input);
  });

  it('swaps sides but leaves firstLine/hanging untouched', () => {
    const input: ParagraphIndent = { left: 24, right: 48, firstLine: 6, hanging: 0 };
    expect(mirrorIndentForRtl(input)).toEqual({ left: 48, right: 24, firstLine: 6, hanging: 0 });
  });

  it('maps a one-sided left indent onto the right edge', () => {
    const input: ParagraphIndent = { left: 30, firstLine: 5 };
    expect(mirrorIndentForRtl(input)).toEqual({ right: 30, firstLine: 5 });
  });

  it('returns same object when no side fields exist', () => {
    expect(mirrorIndentForRtl({})).toEqual({});
    const firstLineOnly: ParagraphIndent = { firstLine: 9 };
    expect(mirrorIndentForRtl(firstLineOnly)).toBe(firstLineOnly);
  });

  it('does not mutate input', () => {
    const input: ParagraphIndent = { left: 10, right: 20, firstLine: 5 };
    const original = { ...input };
    mirrorIndentForRtl(input);
    expect(input).toEqual(original);
  });
});
