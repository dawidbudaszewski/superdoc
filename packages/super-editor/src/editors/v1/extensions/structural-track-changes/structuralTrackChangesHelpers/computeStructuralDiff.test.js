import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initTestEditor } from '@tests/helpers/helpers.js';
import { computeStructuralDiff } from './computeStructuralDiff.js';

const idAttr = (id) => ({ sdBlockId: id });

describe('computeStructuralDiff', () => {
  let editor, schema;
  beforeEach(() => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p></p>' }));
    schema = editor.schema;
  });
  afterEach(() => editor?.destroy());

  const makeDoc = (blocks) =>
    schema.nodes.doc.create(
      null,
      blocks.map((b) => b(schema)),
    );
  const p = (id, text) => (schema) => schema.nodes.paragraph.create(idAttr(id), schema.text(text));
  // Default cell text falls back to the id, so each table built here has a
  // unique content fingerprint matching the matcher's default behavior.
  const table =
    (id, text = id) =>
    (schema) => {
      const cell = schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
      const row = schema.nodes.tableRow.create(null, [cell]);
      return schema.nodes.table.create(idAttr(id), [row]);
    };
  const tableFingerprint = (text) => `table:${text}`;
  const paraFingerprint = (text) => `paragraph:${text}`;

  it('emits a remove hunk for a base table absent from proposal', () => {
    const base = makeDoc([p('p1', 'a'), table('t1'), p('p2', 'b')]);
    const proposal = makeDoc([p('p1', 'a'), p('p2', 'b')]);
    const hunks = computeStructuralDiff(base, proposal);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ kind: 'remove', changeId: tableFingerprint('t1') });
  });

  it('emits an insert hunk for a proposal table absent from base', () => {
    const base = makeDoc([p('p1', 'a')]);
    const proposal = makeDoc([p('p1', 'a'), table('t1')]);
    const hunks = computeStructuralDiff(base, proposal);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ kind: 'insert', changeId: tableFingerprint('t1') });
  });

  it('emits no hunks when both sides have matching tables', () => {
    const base = makeDoc([table('t1')]);
    const proposal = makeDoc([table('t1')]);
    expect(computeStructuralDiff(base, proposal)).toHaveLength(0);
  });

  it('matches tables across independent imports even when sdBlockIds differ', () => {
    const base = makeDoc([table('base-a', 'first'), table('base-b', 'second')]);
    const proposal = makeDoc([table('prop-x', 'first'), table('prop-y', 'second')]);
    expect(computeStructuralDiff(base, proposal)).toHaveLength(0);
  });

  it('anchor for insert is end of last shared base block', () => {
    const base = makeDoc([p('p1', 'first'), p('p2', 'second')]);
    const proposal = makeDoc([p('p1', 'first'), table('t-new'), p('p2', 'second')]);
    const hunks = computeStructuralDiff(base, proposal);
    const insert = hunks.find((h) => h.kind === 'insert');
    expect(insert).toBeDefined();
    expect(insert.anchorBasePos).toBe(base.child(0).nodeSize);
  });

  it('insert with no shared base block anchors at 0', () => {
    const base = makeDoc([p('p1', 'only')]);
    const proposal = makeDoc([table('t-new')]);
    const hunks = computeStructuralDiff(base, proposal);
    const insert = hunks.find((h) => h.kind === 'insert');
    expect(insert?.anchorBasePos).toBe(0);
  });

  it('default blockTypes (["table"]) ignores paragraph differences', () => {
    const base = makeDoc([]);
    const proposal = makeDoc([table('t1'), p('p1', 'extra')]);
    const hunks = computeStructuralDiff(base, proposal);
    expect(hunks.filter((h) => h.kind === 'insert')).toHaveLength(1);
    expect(hunks.find((h) => h.kind === 'insert')?.changeId).toBe(tableFingerprint('t1'));
  });

  it('paragraph mode: emits a remove + insert for an edited paragraph (red/green)', () => {
    const base = makeDoc([p('p1', 'intro'), p('p2', 'old middle'), p('p3', 'outro')]);
    const proposal = makeDoc([p('q1', 'intro'), p('q2', 'new middle'), p('q3', 'outro')]);
    const hunks = computeStructuralDiff(base, proposal, { blockTypes: ['paragraph'] });
    expect(hunks).toHaveLength(2);
    expect(hunks.some((h) => h.kind === 'remove' && h.changeId === paraFingerprint('old middle'))).toBe(true);
    expect(hunks.some((h) => h.kind === 'insert' && h.changeId === paraFingerprint('new middle'))).toBe(true);
  });

  it('paragraph mode: unchanged paragraphs produce no hunks', () => {
    const base = makeDoc([p('a', 'one'), p('b', 'two')]);
    const proposal = makeDoc([p('x', 'one'), p('y', 'two')]);
    expect(computeStructuralDiff(base, proposal, { blockTypes: ['paragraph'] })).toHaveLength(0);
  });

  it('pairReplacements: links an edited paragraph remove+insert with a shared operationId', () => {
    const base = makeDoc([p('p1', 'intro'), p('p2', 'old middle'), p('p3', 'outro')]);
    const proposal = makeDoc([p('q1', 'intro'), p('q2', 'new middle'), p('q3', 'outro')]);
    const hunks = computeStructuralDiff(base, proposal, { blockTypes: ['paragraph'], pairReplacements: true });
    const remove = hunks.find((h) => h.kind === 'remove');
    const insert = hunks.find((h) => h.kind === 'insert');
    expect(remove?.operationId).toBeTruthy();
    expect(insert?.operationId).toBe(remove?.operationId);
    // The paired insert is re-anchored to the END of its removed block so the
    // new (green) block lands immediately after the struck (red) one.
    expect(insert?.anchorBasePos).toBe((remove?.basePos ?? 0) + (remove?.baseNodeSize ?? 0));
  });

  it('pairReplacements: leaves a pure insert (no matching remove) unpaired', () => {
    const base = makeDoc([p('p1', 'intro')]);
    const proposal = makeDoc([p('q1', 'intro'), p('q2', 'brand new')]);
    const hunks = computeStructuralDiff(base, proposal, { blockTypes: ['paragraph'], pairReplacements: true });
    expect(hunks).toHaveLength(1);
    expect(hunks[0].kind).toBe('insert');
    expect(hunks[0].operationId).toBeUndefined();
  });

  it('pairReplacements is off by default (no operationId stamped)', () => {
    const base = makeDoc([p('p1', 'old')]);
    const proposal = makeDoc([p('q1', 'new')]);
    const hunks = computeStructuralDiff(base, proposal, { blockTypes: ['paragraph'] });
    expect(hunks.every((h) => h.operationId === undefined)).toBe(true);
  });

  it('consumer can opt back into sdBlockId-based matching via identityKey override', () => {
    const sdBlockIdKey = (node) => node.attrs?.sdBlockId ?? null;
    const base = makeDoc([table('t1', 'same')]);
    const proposal = makeDoc([table('t2', 'same')]);
    const hunks = computeStructuralDiff(base, proposal, { identityKey: sdBlockIdKey });
    expect(hunks.filter((h) => h.kind === 'remove')).toHaveLength(1);
    expect(hunks.filter((h) => h.kind === 'insert')).toHaveLength(1);
  });
});
