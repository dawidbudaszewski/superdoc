import { describe, it, expect, beforeEach } from 'vitest';
import type { FlowBlock, Layout, Measure } from '@superdoc/contracts';
import { createTestPainter } from '../_test-utils.js';

const makeMeasure = (): Measure => ({
  kind: 'paragraph',
  lines: [{ fromRun: 0, fromChar: 0, toRun: 0, toChar: 8, width: 160, ascent: 12, descent: 4, lineHeight: 20 }],
  totalHeight: 20,
});

const makeLayout = (): Layout => ({
  pageSize: { w: 400, h: 500 },
  pages: [
    {
      number: 1,
      fragments: [{ kind: 'para', blockId: 'p-ins', fromLine: 0, toLine: 1, x: 24, y: 24, width: 260 }],
    },
  ],
});

const makeBlock = (withTrackedChange: boolean): FlowBlock => ({
  kind: 'paragraph',
  id: 'p-ins',
  runs: [{ text: 'inserted', fontFamily: 'Arial', fontSize: 16, pmStart: 1, pmEnd: 9 }],
  attrs: {
    trackedChangesMode: 'review',
    trackedChangesEnabled: true,
    ...(withTrackedChange ? { trackedChange: { kind: 'insert', id: 'ins-1', author: 'A' } } : {}),
  },
});

describe('block-level tracked-change accept repaints clean', () => {
  let mount: HTMLElement;
  beforeEach(() => {
    mount = document.createElement('div');
  });

  it('clears the block insert decoration when trackedChange is removed and painter reused', () => {
    const painter = createTestPainter({ blocks: [makeBlock(true)], measures: [makeMeasure()] });
    painter.paint(makeLayout(), mount);

    const beforeFrag = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(beforeFrag).toBeTruthy();
    expect(beforeFrag.dataset.trackChangeKind).toBe('insert');
    expect(beforeFrag.classList.contains('track-insert-dec')).toBe(true);

    // Simulate accept: same block id + text, trackedChange attr removed.
    painter.setData([makeBlock(false)], [makeMeasure()]);
    painter.paint(makeLayout(), mount);

    const afterFrag = mount.querySelector('.superdoc-fragment') as HTMLElement;
    expect(afterFrag).toBeTruthy();
    expect(afterFrag.dataset.trackChangeKind).toBeUndefined();
    expect(afterFrag.classList.contains('track-insert-dec')).toBe(false);
  });
});
