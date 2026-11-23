import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = createRequire(import.meta.url)(path.join(here, '../../src/Jellyfin.Plugin.PlaylistToolkit/Web/client.js'));

const entry = (pid, id) => ({ PlaylistItemId: pid, Id: id });

test('ownedEntries: finds session entries wherever they are', () => {
    const queue = [entry('e1', 'a'), entry('x9', 'z'), entry('e7', 'b')];
    assert.deepEqual(core.ownedEntries(queue, ['e7', 'e1']).map((e) => e.PlaylistItemId), ['e1', 'e7']);
    assert.equal(core.ownedEntries(queue, ['gone']).length, 0);
});

test('ownedEntries: a long session keeps ownership (no limit on remembered entries)', () => {
    const ids = Array.from({ length: 300 }, (_, i) => 'e' + i);
    const queue = [entry('e0', 'a')];
    assert.equal(core.ownedEntries(queue, ids).length, 1);
});

test('addedEntries: new entries of the part, tolerant of removals by other scripts', () => {
    const before = [entry('e1', 'a'), entry('e2', 'b'), entry('e3', 'c')];
    // another script removed e2 meanwhile and the part [d, e, f] was appended
    const after = [entry('e1', 'a'), entry('e3', 'c'), entry('e4', 'd'), entry('e5', 'e'), entry('e6', 'f')];
    assert.deepEqual(core.addedEntries(before, after, ['d', 'e', 'f']).map((e) => e.PlaylistItemId), ['e4', 'e5', 'e6']);
});

test('addedEntries: foreign new entries (user queued something else) are not taken', () => {
    const before = [entry('e1', 'a')];
    const after = [entry('e1', 'a'), entry('e2', 'd'), entry('u1', 'zzz')];
    assert.deepEqual(core.addedEntries(before, after, ['d']).map((e) => e.PlaylistItemId), ['e2']);
});

test('staleEntries: removed tracks waiting in the queue, not the running one, not foreign ones', () => {
    const queue = [entry('e1', 'AAAA'), entry('e2', 'bbbb'), entry('e3', 'cccc'), entry('u1', 'dddd'), entry('e4', 'eeee')];
    const entries = ['e1', 'e2', 'e3', 'e4'];
    // playlist lost bbbb, cccc, dddd and eeee; queue position 1 is running
    const stale = core.staleEntries(queue, 1, entries, ['aaaa']);
    assert.deepEqual(stale.map((e) => e.PlaylistItemId), ['e3', 'e4']);
});

test('staleEntries: ids compare without dashes and case', () => {
    const queue = [entry('e1', 'x'), entry('e2', '11111111222233334444555555555555')];
    assert.equal(core.staleEntries(queue, 0, ['e2'], ['11111111-2222-3333-4444-555555555555']).length, 0);
});

test('staleEntries: everything is still in the playlist', () => {
    const queue = [entry('e1', 'a'), entry('e2', 'b')];
    assert.equal(core.staleEntries(queue, 0, ['e1', 'e2'], ['a', 'b']).length, 0);
});

test('staleEntries: the running entry only counts when asked for (a track that started after it was removed)', () => {
    const queue = [entry('e1', 'aaaa'), entry('e2', 'bbbb'), entry('e3', 'cccc')];
    const entries = ['e1', 'e2', 'e3'];
    assert.deepEqual(core.staleEntries(queue, 1, entries, ['aaaa', 'cccc']).map((e) => e.PlaylistItemId), []);
    assert.deepEqual(core.staleEntries(queue, 1, entries, ['aaaa', 'cccc'], true).map((e) => e.PlaylistItemId), ['e2']);
});

test('staleEntries: disliked or queue-removed tracks are stale although they are in the playlist; the entry started on purpose is not', () => {
    const queue = [entry('e1', 'aaaa'), entry('e2', 'bbbb'), entry('e3', 'cccc'), entry('e4', 'bbbb')];
    const entries = ['e1', 'e2', 'e3', 'e4'];
    const all = ['aaaa', 'bbbb', 'cccc'];
    assert.deepEqual(core.staleEntries(queue, 0, entries, all, false, ['BBBB']).map((e) => e.PlaylistItemId), ['e2', 'e4']);
    assert.deepEqual(core.staleEntries(queue, 1, entries, all, true, ['bbbb'], 'e2').map((e) => e.PlaylistItemId), ['e4']);
});

test('splitArticle: a whole first word from the list, with more words after it', () => {
    const list = ['The', 'Die'];
    assert.deepEqual(core.splitArticle('The Pretty Reckless', list), { article: 'The', rest: 'Pretty Reckless' });
    assert.deepEqual(core.splitArticle('die Antwoord', list), { article: 'die', rest: 'Antwoord' });
    for (const name of ['Diesel', 'Theory of a Deadman', 'The', 'Die ', 'Within Temptation', '']) {
        assert.equal(core.splitArticle(name, list), null, name);
    }
    assert.equal(core.splitArticle('The Who', []), null);
});
