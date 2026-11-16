import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProjects, librarySortPreference } from "../public/library.js";

const scores = [
  { id: "a", title: "Study 10", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-03-01T00:00:00Z" },
  { id: "b", title: "study 2", createdAt: "2024-03-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
  { id: "c", title: "Bass", createdAt: "2024-02-01T00:00:00Z", updatedAt: "2024-02-01T00:00:00Z" },
];
const ids = (items) => items.map((item) => item.id);

test("library supports all six sort orders without changing its input", () => {
  const original = structuredClone(scores);
  for (const [field, ascending] of [
    ["createdAt", ["a", "c", "b"]], ["updatedAt", ["b", "c", "a"]], ["title", ["c", "b", "a"]],
  ]) {
    assert.deepEqual(ids(filterProjects(scores, { field, direction: "asc", locale: "en" })), ascending);
    assert.deepEqual(ids(filterProjects(scores, { field, direction: "desc", locale: "en" })), [...ascending].reverse());
  }
  assert.deepEqual(scores, original);
  assert.deepEqual(ids(filterProjects(scores)), ["a", "c", "b"]);
});
test("search matches title fragments, case, full-width and decomposed Unicode, and literal punctuation", () => {
  const items = [
    { id: "a", title: "Toe - Goodbye (Live)" },
    { id: "b", title: "【スパロボ】 Bass Study 10" },
    { id: "c", title: "雨の歌 [Bass]" },
  ];
  assert.deepEqual(ids(filterProjects(items, { query: " BYE  toe " })), ["a"]);
  assert.deepEqual(ids(filterProjects(items, { query: "スパロボ　ＢＡＳＳ" })), ["b"]);
  assert.deepEqual(ids(filterProjects(items, { query: "の歌 [" })), ["c"]);
  assert.deepEqual(ids(filterProjects(items, { query: "nothing matches" })), []);
  assert.equal(filterProjects(items, { query: " \t " }).length, 3);
});
test("unknown dates sort last and ties have a deterministic order", () => {
  const items = [...scores, { id: "unknown", title: "AAA", updatedAt: "invalid" }];
  for (const direction of ["asc", "desc"])
    assert.equal(filterProjects(items, { field: "updatedAt", direction }).at(-1).id, "unknown");
  const ties = [{ id: "b", title: "Same" }, { id: "a", title: "Same" }];
  assert.deepEqual(ids(filterProjects(ties, { field: "title" })), ["a", "b"]);
});
test("invalid saved preferences fall back to recently modified first", () => {
  assert.deepEqual(librarySortPreference(), { field: "updatedAt", direction: "desc" });
  assert.deepEqual(librarySortPreference({ field: "__proto__", direction: "wrong" }), librarySortPreference());
  assert.deepEqual(librarySortPreference({ field: "title", direction: "asc" }), { field: "title", direction: "asc" });
});
