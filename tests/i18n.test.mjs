import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { t, setLanguage, getLanguage, translateError, retranslate, bindTranslations } from "../public/i18n.js";
import { messages } from "../public/messages.js";
const require = createRequire(import.meta.url);
const { DOMParser } = require("../vendor/xmldom/package/lib/index.js");

test("all English messages preserve interpolation placeholders", () => {
  const placeholders = (value) => [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [source, translated] of Object.entries(messages)) {
    assert(translated.trim(), source);
    assert.deepEqual(placeholders(translated), placeholders(source), source);
  }
});
test("language switches preserve literal user content and localize application errors", () => {
  const stored = new Map();
  globalThis.localStorage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  setLanguage("en");
  assert.equal(getLanguage(), "en");
  assert.equal(stored.get("localtab.language"), "en");
  assert.equal(t`显示 ${"音符 {0} <guitar>"}`, "Show 音符 {0} <guitar>");
  assert.equal(translateError("GitHub 请求失败（403）。请检查服务端 gh 登录、仓库权限或网络后重试。"),
    "GitHub request failed (403). Check the server's gh login, repository permissions and network, then retry.");
  const status = t("已保存到本机");
  setLanguage("zh-CN");
  assert.equal(retranslate(status), "已保存到本机");
  setLanguage("invalid"); assert.equal(getLanguage(), "zh-CN");
  globalThis.localStorage = { setItem() { throw Error("blocked"); } };
  assert.doesNotThrow(() => setLanguage("en"));
  setLanguage("zh-CN"); delete globalThis.localStorage;
});
test("static bindings update labels without replacing controls or translating user text", () => {
  const doc = new DOMParser().parseFromString('<html><body><label>乐器名称<input value="乐器名称" title="保存"/></label><p>保存</p><div data-i18n-ignore="">音符</div></body></html>', "application/xml");
  function connect(node) { Object.defineProperty(node, "isConnected", { get: () => !!node.parentNode || node === doc }); for (const child of Array.from(node.childNodes || [])) connect(child); }
  connect(doc);
  const input = doc.getElementsByTagName("input")[0], p = doc.getElementsByTagName("p")[0];
  input.value = "我的名字";
  const unbind = bindTranslations(doc);
  setLanguage("en");
  assert.equal(doc.getElementsByTagName("label")[0].firstChild.data, "Instrument name");
  assert.equal(input.value, "我的名字");
  assert.equal(input.getAttribute("title"), "Save");
  assert.equal(doc.getElementsByTagName("div")[0].textContent, "音符");
  p.firstChild.data = "用户的曲名";
  setLanguage("zh-CN");
  assert.equal(p.textContent, "用户的曲名");
  assert.equal(input.getAttribute("title"), "保存");
  unbind();
});
