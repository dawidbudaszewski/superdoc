import { describe, it, expect, vi, beforeAll } from 'vitest';
import { encodeMarksFromRPr, decodeRPrFromMarks, encodeCSSFromRPr, encodeCSSFromPPr } from './styles.js';

beforeAll(() => {
  vi.stubGlobal('SuperConverter', {
    toCssFontFamily: (font) => font,
  });
});

describe('encodeMarksFromRPr', () => {
  it('returns empty marks for undefined run properties', () => {
    expect(encodeMarksFromRPr(undefined, {})).toEqual([]);
  });

  it('should encode bold, italic, and strike properties', () => {
    const rPr = { bold: true, italic: true, strike: true };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toEqual(
      expect.arrayContaining([
        { type: 'bold', attrs: { value: true } },
        { type: 'italic', attrs: { value: true } },
        { type: 'strike', attrs: { value: true } },
      ]),
    );
  });

  it('should encode color and fontSize', () => {
    const rPr = { color: { val: 'FF0000' }, fontSize: 24 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { color: '#FF0000', fontSize: '12pt' },
    });
  });

  it('falls back to szCs for the editable fontSize when no w:sz is present', () => {
    // Arabic/complex-script runs commonly carry only <w:szCs> (here 38 half-points
    // = 19pt) and no <w:sz>. Without the fallback the editor would render these at
    // the 12pt default; Word renders them at szCs.
    const rPr = { fontSizeCs: 38 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontSize: '19pt' },
    });
  });

  it('prefers an explicit w:sz over szCs for a non-complex-script run', () => {
    // sz = 24 (12pt), szCs = 38 (19pt), no rtl flag. For Latin runs the Latin
    // size must win so we never override a run that does specify <w:sz>.
    const rPr = { fontSize: 24, fontSizeCs: 38 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontSize: '12pt' },
    });
  });

  it('prefers szCs over an explicit w:sz for a complex-script (rtl) run', () => {
    // sz = 24 (12pt), szCs = 38 (19pt) with <w:rtl/>. Word sizes complex-script
    // text from szCs regardless of the Latin <w:sz>, so the editor must too —
    // otherwise AI-generated Arabic runs (which often emit a 12pt <w:sz>) render
    // far smaller on-screen than in the exported DOCX.
    const rPr = { fontSize: 24, fontSizeCs: 38, rtl: true };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontSize: '19pt' },
    });
  });

  it('renders the cs font face for a complex-script (rtl) run', () => {
    // The run paints with the ascii font (Times New Roman) but carries a distinct
    // complex-script font in the cs slot (Arial). Word renders Arabic glyphs with the
    // cs font; without this the editor paints Arabic in Times, giving different glyph
    // metrics than the document (which shifts tab-positioned text). The cs font becomes
    // the rendered fontFamily while csFontFamily is retained for export round-tripping.
    const rPr = {
      fontFamily: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Arial' },
      rtl: true,
    };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark.attrs.fontFamily).toMatch(/^Arial/);
    expect(textStyleMark.attrs.csFontFamily).toMatch(/^Arial/);
  });

  it('keeps the ascii font face for a non-complex-script run with a cs font', () => {
    // No <w:rtl/>: this is a Latin run, so the rendered face must stay the ascii font
    // and the cs slot remains round-trip metadata only.
    const rPr = {
      fontFamily: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Arial' },
    };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark.attrs.fontFamily).toMatch(/^Times New Roman/);
    expect(textStyleMark.attrs.csFontFamily).toMatch(/^Arial/);
  });

  it('should encode underline', () => {
    const rPr = { underline: { 'w:val': 'single', 'w:color': 'auto' } };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'underline',
      attrs: { underlineType: 'single', underlineColor: 'auto' },
    });
  });

  it('should encode highlight from w:highlight', () => {
    const rPr = { highlight: { 'w:val': 'yellow' } };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'highlight',
      attrs: { color: '#FFFF00' },
    });
  });

  it('should encode highlight from a hash-prefixed w:val', () => {
    const rPr = { highlight: { 'w:val': '#ECCF35' } };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'highlight',
      attrs: { color: '#ECCF35' },
    });
  });

  it('should encode highlight from w:shd', () => {
    const rPr = { shading: { fill: 'FFA500' } };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'highlight',
      attrs: { color: '#FFA500' },
    });
  });

  it('should encode fontFamily', () => {
    const rPr = { fontFamily: { 'w:ascii': 'Arial' } };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontFamily: 'Arial, sans-serif' },
    });
  });

  it('should encode textTransform', () => {
    const rPr = { textTransform: 'uppercase' };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { textTransform: 'uppercase' },
    });
  });

  it('encodes vertical alignment and position into textStyle', () => {
    const rPr = { vertAlign: 'subscript', position: 4 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { vertAlign: 'subscript', position: '2pt' },
    });
  });

  it('encodes styleId into textStyle', () => {
    const rPr = { styleId: 'Heading1Char' };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { styleId: 'Heading1Char' },
    });
  });
});

describe('encodeCSSFromRPr', () => {
  it('should encode basic font toggles', () => {
    const css = encodeCSSFromRPr({ bold: true, italic: false, strike: true }, {});
    expect(css).toMatchObject({
      'font-weight': 'bold',
      'font-style': 'normal',
      'text-decoration-line': 'line-through',
    });
    expect(css).not.toHaveProperty('text-decoration');
  });

  it('should encode underline styles and merge strike decorations', () => {
    const css = encodeCSSFromRPr({ underline: { 'w:val': 'double', 'w:color': 'FF0000' }, strike: true }, {});
    expect(css).toMatchObject({
      'text-decoration-style': 'double',
      'text-decoration-color': '#FF0000',
    });
    expect(css['text-decoration-line'].split(' ').sort()).toEqual(['line-through', 'underline'].sort());
  });

  it('should encode highlight without overriding explicit text color', () => {
    const css = encodeCSSFromRPr({ color: { val: 'FF0000' }, highlight: { 'w:val': 'yellow' } }, {});
    expect(css).toMatchObject({
      color: '#FF0000',
      'background-color': '#FFFF00',
    });
  });

  it('should encode font size and letter spacing', () => {
    const css = encodeCSSFromRPr({ fontSize: 24, letterSpacing: 240 }, {});
    expect(css).toMatchObject({
      'font-size': '12pt',
      'letter-spacing': '12pt',
    });
  });

  it('should encode font family using converter fallbacks', () => {
    const css = encodeCSSFromRPr({ fontFamily: { 'w:ascii': 'Arial' } }, {});
    expect(css['font-family']).toBe('Arial, sans-serif');
  });

  it('applies vertical-align and scaling for superscript/subscript', () => {
    const css = encodeCSSFromRPr({ vertAlign: 'superscript', fontSize: 20 }, {});
    expect(css['vertical-align']).toBe('super');
    expect(css['font-size']).toBe('6.5pt'); // 20 half-points = 10pt; scaled 65%
  });

  it('uses numeric position when provided', () => {
    const css = encodeCSSFromRPr({ position: 4 }, {});
    expect(css['vertical-align']).toBe('2pt');
  });
});

describe('decodeRPrFromMarks', () => {
  it('decodes vertAlign and position from textStyle mark', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { vertAlign: 'subscript', position: '1.5pt' } }];
    expect(decodeRPrFromMarks(marks)).toMatchObject({ vertAlign: 'subscript', position: 3 });
  });

  it('decodes styleId from textStyle mark', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { styleId: 'Heading1Char' } }];
    expect(decodeRPrFromMarks(marks)).toMatchObject({ styleId: 'Heading1Char' });
  });

  it('does not write debug output while decoding marks', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      decodeRPrFromMarks([{ type: { name: 'bold' }, attrs: { value: true } }]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('encodeMarksFromRPr - vertAlign/position edge cases', () => {
  it('handles null vertAlign gracefully', () => {
    const rPr = { vertAlign: null };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.vertAlign).toBeUndefined();
  });

  it('handles undefined vertAlign gracefully', () => {
    const rPr = { vertAlign: undefined };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.vertAlign).toBeUndefined();
  });

  it('handles null position gracefully', () => {
    const rPr = { position: null };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.position).toBeUndefined();
  });

  it('handles undefined position gracefully', () => {
    const rPr = { position: undefined };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.position).toBeUndefined();
  });

  it('handles NaN position gracefully', () => {
    const rPr = { position: NaN };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.position).toBeUndefined();
  });

  it('handles Infinity position gracefully', () => {
    const rPr = { position: Infinity };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.position).toBeUndefined();
  });

  it('handles negative Infinity position gracefully', () => {
    const rPr = { position: -Infinity };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark?.attrs?.position).toBeUndefined();
  });

  it('handles negative position values correctly', () => {
    const rPr = { position: -4 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { position: '-2pt' },
    });
  });

  it('handles zero position value', () => {
    const rPr = { position: 0 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { position: '0pt' },
    });
  });

  it('handles both vertAlign and position set together', () => {
    const rPr = { vertAlign: 'superscript', position: 4 };
    const marks = encodeMarksFromRPr(rPr, {});
    expect(marks).toContainEqual({
      type: 'textStyle',
      attrs: { vertAlign: 'superscript', position: '2pt' },
    });
  });
});

describe('encodeCSSFromRPr - vertAlign/position edge cases', () => {
  it('handles null vertAlign gracefully', () => {
    const css = encodeCSSFromRPr({ vertAlign: null }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles undefined vertAlign gracefully', () => {
    const css = encodeCSSFromRPr({ vertAlign: undefined }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles null position gracefully', () => {
    const css = encodeCSSFromRPr({ position: null }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles undefined position gracefully', () => {
    const css = encodeCSSFromRPr({ position: undefined }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles NaN position gracefully', () => {
    const css = encodeCSSFromRPr({ position: NaN }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles Infinity position gracefully', () => {
    const css = encodeCSSFromRPr({ position: Infinity }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles negative Infinity position gracefully', () => {
    const css = encodeCSSFromRPr({ position: -Infinity }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('handles negative position values correctly', () => {
    const css = encodeCSSFromRPr({ position: -4 }, {});
    expect(css['vertical-align']).toBe('-2pt');
  });

  it('handles zero position value', () => {
    const css = encodeCSSFromRPr({ position: 0 }, {});
    expect(css['vertical-align']).toBeUndefined();
  });

  it('treats zero position as identity when combined with vertAlign', () => {
    const css = encodeCSSFromRPr({ vertAlign: 'superscript', position: 0, fontSize: 20 }, {});
    expect(css['vertical-align']).toBe('super');
    expect(css['font-size']).toBe('6.5pt');
  });

  it('non-zero position takes precedence over vertAlign when both are set', () => {
    const css = encodeCSSFromRPr({ vertAlign: 'superscript', position: 4 }, {});
    expect(css['vertical-align']).toBe('2pt');
    expect(css['font-size']).toBeUndefined();
  });
});

describe('decodeRPrFromMarks - vertAlign/position edge cases', () => {
  it('handles null vertAlign gracefully', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { vertAlign: null } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.vertAlign).toBeUndefined();
  });

  it('handles null position gracefully', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { position: null } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.position).toBeUndefined();
  });

  it('handles invalid position string gracefully', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { position: 'invalid' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.position).toBeUndefined();
  });

  it('handles negative position values correctly', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { position: '-2pt' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.position).toBe(-4);
  });

  it('handles zero position value', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { position: '0pt' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.position).toBe(0);
  });

  it('handles both vertAlign and position set together', () => {
    const marks = [{ type: { name: 'textStyle' }, attrs: { vertAlign: 'subscript', position: '2pt' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.vertAlign).toBe('subscript');
    expect(rPr.position).toBe(4);
  });
});

describe('encodeCSSFromPPr', () => {
  it('converts spacing, indentation, and justification to CSS declarations', () => {
    const css = encodeCSSFromPPr({
      spacing: { before: 180, after: 120, line: 480, lineRule: 'auto' },
      indent: { left: 720, right: 1440, firstLine: 360 },
      justification: 'both',
    });

    expect(css).toMatchObject({
      'margin-top': '12px',
      'margin-bottom': '8px',
      'line-height': '2',
      'margin-left': '48px',
      'margin-right': '96px',
      'text-indent': '24px',
      'text-align': 'justify',
    });
  });

  it('maps the start-side indent to margin-right for an RTL paragraph', () => {
    // Word treats `w:left` in a bidi paragraph as the logical leading (visual
    // right) edge. A large left indent must therefore become margin-right so the
    // RTL line keeps its width and does not wrap (e.g. signature blocks). The
    // hanging outdent stays as a negative text-indent (browser applies it to the
    // start edge under dir="rtl").
    const css = encodeCSSFromPPr({
      indent: { left: 5760, hanging: 1530 },
      justification: 'both',
      rightToLeft: true,
    });

    expect(css['margin-right']).toBe('384px');
    expect(css['margin-left']).toBeUndefined();
    expect(css['text-indent']).toBe('-102px');
  });

  it('keeps physical left/right indents for an LTR paragraph', () => {
    const css = encodeCSSFromPPr({
      indent: { left: 720, right: 1440 },
      rightToLeft: false,
    });

    expect(css['margin-left']).toBe('48px');
    expect(css['margin-right']).toBe('96px');
  });

  it('prefers logical start/end indents over physical left/right', () => {
    const ltr = encodeCSSFromPPr({ indent: { start: 720, end: 360, left: 99, right: 99 } });
    expect(ltr['margin-left']).toBe('48px');
    expect(ltr['margin-right']).toBe('24px');

    const rtl = encodeCSSFromPPr({ indent: { start: 720, end: 360 }, rightToLeft: true });
    // start (leading) → visual right, end (trailing) → visual left for RTL.
    expect(rtl['margin-right']).toBe('48px');
    expect(rtl['margin-left']).toBe('24px');
  });

  it('forces drop caps to use single-line spacing regardless of provided spacing', () => {
    const cssWithoutFrame = encodeCSSFromPPr({
      spacing: { before: 0, after: 0, line: 720, lineRule: 'exact' },
    });
    const cssWithFrame = encodeCSSFromPPr({
      spacing: { before: 0, after: 0, line: 720, lineRule: 'exact' },
      framePr: { dropCap: 'drop' },
    });

    expect(cssWithoutFrame['line-height']).toBe('3');
    expect(cssWithFrame['line-height']).toBe('1');
  });

  it('keeps autospacing margins unless suppressed for list items', () => {
    const spacing = {
      before: 120,
      after: 120,
      line: 240,
      lineRule: 'auto',
      beforeAutospacing: true,
      afterAutospacing: true,
    };

    const css = encodeCSSFromPPr({ spacing });
    expect(css['margin-top']).toBe('8px');
    expect(css['margin-bottom']).toBe('8px');

    const listCss = encodeCSSFromPPr({
      spacing,
      numberingProperties: { numId: 1, ilvl: 0 },
    });
    expect(listCss['margin-top']).toBeUndefined();
    expect(listCss['margin-bottom']).toBeUndefined();
  });

  it('translates borders to CSS including padding for bottom space', () => {
    const css = encodeCSSFromPPr({
      borders: {
        top: { val: 'none' },
        bottom: { val: 'single', size: 8, color: 'FF0000', space: 16 },
      },
    });

    expect(css['border-top']).toBe('none');
    expect(css['border-bottom']).toContain('#FF0000');
    expect(css['border-bottom']).toContain('solid');
    expect(parseFloat(css['border-bottom'])).toBeCloseTo(1.333, 3);
    expect(parseFloat(css['padding-bottom'])).toBeCloseTo(2.6666, 3);
  });
});

describe('decodeRPrFromMarks', () => {
  it('should decode bold, italic, and strike marks', () => {
    const marks = [
      { type: 'bold', attrs: { value: true } },
      { type: 'italic', attrs: { value: true } },
      { type: 'strike', attrs: { value: true } },
    ];
    const rPr = decodeRPrFromMarks(marks);
    // SD-2912: `boldCs`/`italicCs` are independent OOXML properties and are no longer
    // auto-propagated from the latin bold/italic marks. They round-trip via the run's
    // stored runProperties when the source rPr actually contained them.
    expect(rPr).toEqual({ bold: true, italic: true, strike: true });
  });

  it('should decode textStyle marks for color and fontSize', () => {
    const marks = [{ type: 'textStyle', attrs: { color: '#FF0000', fontSize: '12pt' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({ color: { val: 'FF0000' }, fontSize: 24, fontSizeCs: 24 });
  });

  it('keeps fontSize and fontSizeCs in sync when decoding textStyle fontSize', () => {
    const marks = [{ type: 'textStyle', attrs: { fontSize: '36pt' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.fontSize).toBe(72);
    expect(rPr.fontSizeCs).toBe(72);
  });

  it('should decode underline marks', () => {
    const marks = [{ type: 'underline', attrs: { underlineType: 'single', underlineColor: '#FF0000' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({ underline: { 'w:val': 'single', 'w:color': 'FF0000' } });
  });

  it('should decode highlight marks', () => {
    const marks = [{ type: 'highlight', attrs: { color: '#FFFF00' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({ highlight: { 'w:val': '#FFFF00' } });
  });

  it('should decode textStyle with fontFamily', () => {
    const marks = [{ type: 'textStyle', attrs: { fontFamily: 'Arial, sans-serif' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({
      fontFamily: {
        ascii: 'Arial',
        cs: 'Arial',
        eastAsia: 'Arial',
        hAnsi: 'Arial',
      },
    });
  });

  it('ignores cleared per-script font attrs when decoding a user-applied fontFamily', () => {
    const marks = [
      {
        type: 'textStyle',
        attrs: {
          fontFamily: 'Courier New, monospace',
          eastAsiaFontFamily: null,
          csFontFamily: null,
        },
      },
    ];

    const rPr = decodeRPrFromMarks(marks);

    expect(rPr).toEqual({
      fontFamily: {
        ascii: 'Courier New',
        cs: 'Courier New',
        eastAsia: 'Courier New',
        hAnsi: 'Courier New',
      },
    });
  });

  it('should decode textStyle with textTransform', () => {
    const marks = [{ type: 'textStyle', attrs: { textTransform: 'uppercase' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({ textTransform: 'uppercase' });
  });

  it('should decode link mark into Hyperlink styleId', () => {
    const marks = [{ type: 'link', attrs: { href: 'https://example.com' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr).toEqual({ styleId: 'Hyperlink' });
  });

  // SD-2912: redundant default emissions on round-trip.
  // OOXML default for bCs/iCs is OFF and for w:highlight is "none" — emitting them
  // explicitly is byte noise that wasn't in the source. Word treats absence and explicit
  // off as identical, but the export should not introduce elements that weren't there.

  it('does not propagate boldCs when the bold mark is off (SD-2912)', () => {
    const marks = [{ type: 'bold', attrs: { value: false } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.bold).toBe(false);
    expect(rPr.boldCs).toBeUndefined();
  });

  it('does not propagate italicCs when the italic mark is off (SD-2912)', () => {
    const marks = [{ type: 'italic', attrs: { value: false } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.italic).toBe(false);
    expect(rPr.italicCs).toBeUndefined();
  });

  it('does not emit highlight when the highlight mark is transparent (SD-2912)', () => {
    const marks = [{ type: 'highlight', attrs: { color: 'transparent' } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.highlight).toBeUndefined();
  });

  it('preserves imported explicit highlight none clears (SD-2912)', () => {
    const marks = [{ type: 'highlight', attrs: { color: 'transparent', ooxmlHighlightClear: true } }];
    const rPr = decodeRPrFromMarks(marks);
    expect(rPr.highlight).toEqual({ 'w:val': 'none' });
  });
});

describe('marks encoding/decoding round-trip', () => {
  it('should correctly round-trip basic properties', () => {
    // SD-2912: `boldCs`/`italicCs` are not represented as PM marks (they are independent
    // OOXML properties tracked on the run's stored runProperties). The encode/decode mark
    // round-trip therefore lossily drops them at the mark layer; preservation through a
    // full DOCX round-trip happens via the run-properties passthrough path.
    const initialRPr = {
      bold: true,
      italic: true,
      strike: true,
      underline: { 'w:val': 'single', 'w:color': 'auto' },
      color: { val: 'FF0000' },
      fontSize: 28,
      fontSizeCs: 28,
      letterSpacing: 20,
    };

    const marks = encodeMarksFromRPr(initialRPr, {});
    const finalRPr = decodeRPrFromMarks(marks);

    expect(finalRPr).toEqual(initialRPr);
  });

  it('should round-trip fontFamily for simple symmetric cases', () => {
    const initialRPr = { fontFamily: { 'w:ascii': 'Arial', 'w:hAnsi': 'Arial' } };
    const marks = encodeMarksFromRPr(initialRPr, {});
    const finalRPr = decodeRPrFromMarks(marks);
    expect(finalRPr).toEqual({
      fontFamily: {
        ascii: 'Arial',
        cs: 'Arial',
        eastAsia: 'Arial',
        hAnsi: 'Arial',
      },
    });
  });

  it('should round-trip highlight to a consistent format', () => {
    const rPrHighlight = { highlight: { 'w:val': 'yellow' } };
    const marks1 = encodeMarksFromRPr(rPrHighlight, {});
    const finalRPr1 = decodeRPrFromMarks(marks1);
    expect(finalRPr1).toEqual({ highlight: { 'w:val': '#FFFF00' } });

    const rPrShading = { shading: { fill: 'FFA500' } };
    const marks2 = encodeMarksFromRPr(rPrShading, {});
    const finalRPr2 = decodeRPrFromMarks(marks2);
    expect(finalRPr2).toEqual({ highlight: { 'w:val': '#FFA500' } });
  });

  it('distinguishes explicit highlight none from transparent shading on round-trip', () => {
    const explicitClearMarks = encodeMarksFromRPr({ highlight: { 'w:val': 'none' } }, {});
    expect(explicitClearMarks).toEqual([
      { type: 'highlight', attrs: { color: 'transparent', ooxmlHighlightClear: true } },
    ]);
    expect(decodeRPrFromMarks(explicitClearMarks)).toEqual({ highlight: { 'w:val': 'none' } });

    const transparentShadingMarks = encodeMarksFromRPr({ shading: { val: 'clear', fill: 'auto' } }, {});
    expect(transparentShadingMarks).toEqual([{ type: 'highlight', attrs: { color: 'transparent' } }]);
    expect(decodeRPrFromMarks(transparentShadingMarks)).toEqual({});
  });

  it('should show asymmetry in textTransform/caps round-trip', () => {
    const rPrTextTransform = { textTransform: 'uppercase' };
    const marks = encodeMarksFromRPr(rPrTextTransform, {});
    const finalRPr = decodeRPrFromMarks(marks);
    expect(finalRPr).toEqual({ textTransform: 'uppercase' });

    // and the other way
    const rPrCaps = { caps: true };
    const marksFromCaps = encodeMarksFromRPr(rPrCaps, {});
    // encodeMarksFromRPr doesn't handle 'caps', so it produces no textTransform mark.
    expect(marksFromCaps.some((m) => m.type === 'textStyle' && m.attrs.textTransform)).toBe(false);
  });

  // SD-2517: per-script fonts (eastAsia, cs) must survive the mark round-trip.
  // ECMA-376 §17.3.2.26 defines 4 independent font slots: ascii, hAnsi, eastAsia, cs.
  it('preserves per-script fonts (eastAsia, cs) through encode → decode round-trip', () => {
    const rPr = {
      fontFamily: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'MS Mincho', cs: 'Times New Roman' },
    };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    // Encode should preserve per-script fonts as separate mark attributes
    expect(textStyleMark.attrs.eastAsiaFontFamily).toMatch(/^MS Mincho/);
    expect(textStyleMark.attrs.csFontFamily).toMatch(/^Times New Roman/);

    const decoded = decodeRPrFromMarks(marks);
    // Decode should restore per-script fonts, not flatten to ascii
    expect(decoded.fontFamily.ascii).toMatch(/^Arial/);
    expect(decoded.fontFamily.hAnsi).toMatch(/^Arial/);
    expect(decoded.fontFamily.eastAsia).toMatch(/^MS Mincho/);
    expect(decoded.fontFamily.cs).toMatch(/^Times New Roman/);
  });

  it('omits per-script mark attrs when all scripts match ascii', () => {
    const rPr = {
      fontFamily: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Arial', cs: 'Arial' },
    };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark.attrs.eastAsiaFontFamily).toBeUndefined();
    expect(textStyleMark.attrs.csFontFamily).toBeUndefined();

    const decoded = decodeRPrFromMarks(marks);
    expect(decoded.fontFamily).toEqual({ ascii: 'Arial', eastAsia: 'Arial', hAnsi: 'Arial', cs: 'Arial' });
  });

  it('preserves cs font when only cs differs from ascii', () => {
    const rPr = {
      fontFamily: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Arial', cs: 'Times New Roman' },
    };
    const marks = encodeMarksFromRPr(rPr, {});
    const textStyleMark = marks.find((m) => m.type === 'textStyle');
    expect(textStyleMark.attrs.eastAsiaFontFamily).toBeUndefined();
    expect(textStyleMark.attrs.csFontFamily).toMatch(/^Times New Roman/);

    const decoded = decodeRPrFromMarks(marks);
    expect(decoded.fontFamily.ascii).toMatch(/^Arial/);
    expect(decoded.fontFamily.cs).toMatch(/^Times New Roman/);
    expect(decoded.fontFamily.eastAsia).toMatch(/^Arial/);
  });
});
