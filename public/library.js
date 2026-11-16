export const LIBRARY_PREFERENCE_KEY = "localtab.librarySort";
export const DEFAULT_LIBRARY_SORT = { field: "updatedAt", direction: "desc" };

export function librarySortPreference(value) {
  return {
    field: ["updatedAt", "createdAt", "title"].includes(value?.field)
      ? value.field : DEFAULT_LIBRARY_SORT.field,
    direction: ["asc", "desc"].includes(value?.direction)
      ? value.direction : DEFAULT_LIBRARY_SORT.direction,
  };
}

// NFKC also matches full-width characters and composed/decomposed Japanese titles.
const searchText = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function filterProjects(items, { query = "", field, direction, locale = "zh-CN" } = {}) {
  const sort = librarySortPreference({ field, direction });
  const terms = searchText(query).split(" ").filter(Boolean);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sign = sort.direction === "asc" ? 1 : -1;
  return items.filter((item) => terms.every((term) => searchText(item.title).includes(term)))
    .sort((a, b) => {
      if (sort.field !== "title") {
        const left = Date.parse(a[sort.field]), right = Date.parse(b[sort.field]);
        // Missing timestamps always sort last, even in descending order.
        if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
        if (Number.isFinite(left) && left !== right) return (left - right) * sign;
      }
      return collator.compare(a.title, b.title) * sign || String(a.id).localeCompare(String(b.id), "en");
    });
}
