/**
 * Detect whether a ProseMirror transaction touches a structural tracked change
 * that lives on node attributes rather than inline marks:
 *   - whole-table insert/delete encoded on `tableRow.attrs.trackChange`
 *     (`{ type: 'rowInsert' | 'rowDelete' }`), and
 *   - whole-paragraph insert/delete encoded on `paragraph.attrs.trackChange`
 *     (`{ kind: 'insert' | 'delete' }`) — the Google-Docs-style paragraph
 *     re-suggest produced by the block diff.
 *
 * These node-attr revisions are NOT seen by the inline
 * `collectTouchedTrackedChangeIds` scan, so when one is part of a transaction
 * the right-rail bubble sync must run a FULL resync (the targeted, id-based
 * resync path only refreshes inline mark bubbles). This helper flags those
 * transactions so the caller can force a full resync, mirroring how inline mark
 * edits trigger sidebar refresh.
 *
 * Conservative by design: returns true if any node within a changed range is a
 * `tableRow` carrying a `rowInsert`/`rowDelete` `trackChange` OR a `paragraph`
 * carrying an `insert`/`delete` `trackChange`. False positives only cost an
 * extra full resync; false negatives would silently drop the bubble.
 *
 * @param {import('prosemirror-state').Transaction} transaction
 * @returns {boolean}
 */
export function transactionTouchesStructuralChange(transaction) {
  if (!transaction?.docChanged || !transaction?.doc || !transaction?.mapping?.maps?.length) return false;

  const docSize = transaction.doc.content.size;
  let touched = false;

  transaction.mapping.maps.forEach((stepMap, stepIndex) => {
    if (touched) return;
    stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touched) return;
      const mappingOffset = stepIndex + 1;
      const mappedFrom = transaction.mapping.slice(mappingOffset).map(newStart, 1);
      const mappedTo = transaction.mapping.slice(mappingOffset).map(newEnd, -1);
      const from = Math.max(0, mappedFrom - 1);
      const to = Math.min(docSize, mappedTo + 1);
      if (from >= to) return;

      transaction.doc.nodesBetween(from, to, (node) => {
        if (touched) return false;
        const tc = node?.attrs?.trackChange;
        if (!tc) return undefined;
        const nodeName = node.type?.name;
        const isRowStructural = nodeName === 'tableRow' && (tc.type === 'rowInsert' || tc.type === 'rowDelete');
        const isParagraphStructural = nodeName === 'paragraph' && (tc.kind === 'insert' || tc.kind === 'delete');
        if (isRowStructural || isParagraphStructural) {
          touched = true;
          return false;
        }
        return undefined;
      });
    });
  });

  return touched;
}
