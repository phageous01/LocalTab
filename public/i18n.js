import { messages } from "./messages.js";

export const LANGUAGE_KEY = "localtab.language";
export const LANGUAGES = ["zh-CN", "en"];
const listeners = new Set();
const rendered = new Map();
let language = "zh-CN";
try {
  const saved = globalThis.localStorage?.getItem(LANGUAGE_KEY);
  if (LANGUAGES.includes(saved)) language = saved;
} catch { /* Preferences are optional when storage is unavailable. */ }

export const getLanguage = () => language;

function format(key, values, locale = language) {
  const template = locale === "en" ? (messages[key] ?? key) : key;
  return template.replace(/\{(\d+)\}/g, (match, index) =>
    index < values.length ? String(values[index]) : match);
}

// Source strings are keys. Tagged templates keep user content out of translation.
export function t(source, ...values) {
  const key = Array.isArray(source)
    ? source.reduce((text, part, i) => text + (i ? `{${i - 1}}` : "") + part, "")
    : source;
  const result = format(key, values);
  rendered.set(result, { key, values });
  if (rendered.size > 2000) rendered.delete(rendered.keys().next().value);
  return result;
}

// Only use on application-owned status messages, never on score or recording names.
export function retranslate(text) {
  const original = rendered.get(text);
  if (original) return t(original.key, ...original.values);
  if (Object.hasOwn(messages, text)) return t(text);
  const key = Object.keys(messages).find((key) => messages[key] === text);
  return key === undefined ? text : t(key);
}

export function translateError(text) {
  if (!text) return text;
  if (Object.hasOwn(messages, text)) return t(text);
  // The server returns Chinese messages, including a few parameterized errors.
  for (const key of Object.keys(messages).filter((key) => /\{\d+\}/.test(key))) {
    const indices = [];
    const pattern = key.split(/(\{\d+\})/).map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        indices.push(Number(part.slice(1, -1)));
        return "([\\s\\S]*?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    const match = text.match(new RegExp("^" + pattern + "$"));
    if (match) {
      const values = [];
      indices.forEach((index, i) => { values[index] = match[i + 1]; });
      return t(key, ...values);
    }
  }
  for (const prefix of ["PDF 生成失败：", "无法生成 PDF：", "排版失败："]) {
    if (text.startsWith(prefix)) return t(prefix) + text.slice(prefix.length);
  }
  return retranslate(text);
}

export function onLanguageChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setLanguage(next) {
  if (!LANGUAGES.includes(next)) return;
  const changed = language !== next;
  language = next;
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, language); } catch { /* Optional. */ }
  if (globalThis.document) document.documentElement.lang = language;
  if (changed) for (const callback of listeners) callback(language);
}

if (globalThis.document) document.documentElement.lang = language;

// Bind only static UI, before inserting user content. No DOM-wide observer is used.
// Updating text nodes instead of innerHTML preserves handlers, focus and form values.
export function bindTranslations(root) {
  const bindings = [];
  const capture = (read, write) => {
    const original = read();
    const key = original.replace(/\s+/g, " ").trim();
    if (!Object.hasOwn(messages, key)) return;
    const before = original.match(/^\s*/)[0], after = original.match(/\s*$/)[0];
    let previous = original;
    bindings.push(() => {
      if (read() !== previous) return; // A dynamic renderer has taken ownership.
      previous = before + t(key) + after;
      write(previous);
    });
  };
  const walk = (node) => {
    if (node.nodeType === 1) {
      if (["SCRIPT", "STYLE", "TEXTAREA", "SVG"].includes(node.tagName.toUpperCase()) ||
          node.hasAttribute("data-i18n-ignore")) return;
      for (const name of ["title", "aria-label", "placeholder"])
        if (node.hasAttribute(name))
          capture(() => node.isConnected ? node.getAttribute(name) : null,
            (value) => node.setAttribute(name, value));
    } else if (node.nodeType === 3) {
      capture(() => node.isConnected ? node.data : null, (value) => { node.data = value; });
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  const update = () => bindings.forEach((binding) => binding());
  update();
  return onLanguageChange(update);
}
