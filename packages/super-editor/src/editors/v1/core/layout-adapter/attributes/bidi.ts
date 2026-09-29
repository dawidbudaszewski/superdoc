/**
 * Bidirectional Text (BiDi) Utilities
 *
 * Functions for handling RTL text and indent mirroring.
 */

import type { ParagraphIndent } from '@superdoc/contracts';

/**
 * Mirror paragraph indent for RTL text.
 *
 * Swaps the physical left/right indents so a logical start-side indent
 * (resolved to `left` upstream) lands on the visual RIGHT edge in RTL.
 *
 * `firstLine`/`hanging` are intentionally left untouched. The RTL paint path
 * renders each line into a `dir="rtl"` element and applies the first-line
 * offset via CSS `text-indent` (see resolveParagraph + renderParagraphContent).
 * Because the element is already direction-aware, a positive `text-indent`
 * indents from the right exactly as the browser expects — the same approach
 * the editable v1 path uses in super-converter/styles.js. Negating these
 * values here would invert that into an outdent, pushing RTL first lines the
 * wrong way (the signature/greeting indentation regression).
 */
export const mirrorIndentForRtl = (indent: ParagraphIndent): ParagraphIndent => {
  const swapsSides = indent.left != null || indent.right != null;
  if (!swapsSides) return indent;

  const mirrored: ParagraphIndent = { ...indent };

  if (indent.right != null) {
    mirrored.left = indent.right;
  } else {
    delete mirrored.left;
  }
  if (indent.left != null) {
    mirrored.right = indent.left;
  } else {
    delete mirrored.right;
  }

  return mirrored;
};
