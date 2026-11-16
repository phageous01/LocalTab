import { t as tr, bindTranslations } from "./i18n.js";
const tabs = [
  ["notes", "音符", "Notes"],
  ["tab", "TAB 技巧", "Tab"],
  ["articulations", "奏法", "Articulations"],
  ["ornaments", "装饰", "Ornaments"],
  ["dynamics", "力度", "Dynamics"],
  ["measures", "小节", "Measures"],
  ["text", "文字 / 音色", "Text"],
];
const values = [
  ["whole", "全音符", "1"],
  ["half", "二分音符", "1/2"],
  ["quarter", "四分音符", "1/4"],
  ["eighth", "八分音符", "1/8"],
  ["16th", "十六分音符", "1/16"],
  ["32nd", "三十二分音符", "1/32"],
  ["64th", "六十四分音符", "1/64"],
];
function rhythmIcon(type) {
  const i = values.findIndex((v) => v[0] === type);
  return `<svg viewBox="0 0 32 34" aria-hidden="true"><ellipse cx="${i === 0 ? 16 : 11}" cy="25" rx="7" ry="4.5" transform="rotate(-18 ${i === 0 ? 16 : 11} 25)" fill="${i < 2 ? "none" : "currentColor"}" stroke="currentColor" stroke-width="1.7"/>${i ? '<path d="M17 24V3" stroke="currentColor" stroke-width="1.8"/>' : ""}${Array.from({ length: Math.max(0, i - 2) }, (_, j) => `<path d="M17 ${3 + j * 5}Q31 ${9 + j * 5} 22 ${19 + j * 4}" fill="none" stroke="currentColor" stroke-width="2"/>`).join("")}</svg>`;
}
export function createToolbar(host, hooks) {
  let active = "notes";
  const state = () => hooks.state(),
    focus = () => hooks.focus(),
    mode = () => host.querySelector("#durationMode").value;
  host.innerHTML = `<div class="tool-tabs" role="tablist" aria-label="编辑工具栏">${tabs.map(([id, cn, en]) => `<button role="tab" id="tooltab-${id}" aria-controls="toolpanel-${id}" data-tab="${id}" title="${en}">${cn}<small>${en}</small></button>`).join("")}<span class="toolbar-focus" id="tabFocusState">点击 TAB 后直接输入数字</span></div>${tabs.map(([id]) => `<div class="tool-panel" role="tabpanel" aria-labelledby="tooltab-${id}" id="toolpanel-${id}"></div>`).join("")}<div class="tool-context"><span id="toolSelection">选择音符</span><span>↑↓ 选弦 · ←→ 选音 · 数字输入品位 · Shift+点选范围</span></div>`;
  const panel = (id) => host.querySelector("#toolpanel-" + id);
  function btn(group, label, symbol, action, title = label, key = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tool-button";
    b.title = title;
    b.setAttribute("aria-label", label);
    if (key) b.dataset.mark = key;
    const glyph = document.createElement("span");
    glyph.className = "tool-symbol";
    glyph.textContent = symbol;
    const small = document.createElement("small");
    small.textContent = label;
    b.append(glyph, small);
    b.onclick = () => {
      action();
      focus();
    };
    panel(group).append(b);
    return b;
  }
  const exec = (fn) => {
    const s = state();
    hooks.run(() => fn(s.model, s.mi, s.ni, s.selectedString));
  };
  const pair = (tag) => {
    const s = state(),
      start = s.rangeStart ?? s.model.notes.indexOf(s.model.event(s.mi, s.ni)),
      end =
        s.rangeStart == null
          ? null
          : s.model.notes.indexOf(s.model.event(s.mi, s.ni));
    const a = s.model.notes[Math.min(start, end ?? start)],
      b = end == null ? null : Math.max(start, end);
    hooks.run(() => s.model.pair(a.mi, a.ni, tag, b, s.selectedString));
  };
  const mark = (group, label, symbol, tag) =>
    btn(
      group,
      label,
      symbol,
      () => exec((m, a, b, string) => m.toggleMark(a, b, tag, string)),
      label,
      tag,
    );
  for (const [i, [type, label, short]] of values.entries()) {
    const b = btn(
      "notes",
      label,
      "",
      () =>
        exec((m, a, b) =>
          m.editDuration(a, b, type, state().model.event(a, b).dots, mode()),
        ),
      `${label} · Alt+${i + 1}`,
    );
    b.dataset.duration = type;
    b.querySelector(".tool-symbol").innerHTML = rhythmIcon(type);
    b.querySelector("small").textContent = short;
  }
  btn(
    "notes",
    "附点",
    "·",
    () => exec((m, a, b) => m.toggleDots(a, b, mode())),
    "附点 / 双附点 / 无附点 · .",
    "dots",
  );
  btn(
    "notes",
    "休止",
    "𝄽",
    () => exec((m, a, b) => m.toggleRest(a, b)),
    "整个音位（包括和弦）与休止符切换 · R",
    "rest",
  );
  btn(
    "notes",
    "删当前音",
    "⌫",
    () => exec((m, a, b, string) => m.removeTone(a, b, string)),
    "只删除当前弦的音；其他和弦音保留 · Delete",
  );
  btn(
    "notes",
    "延音线",
    "⌒",
    () => exec((m, a, b, string) => m.toggleTie(a, b, string)),
    "连接相邻同弦同品音 · T",
    "tie",
  );
  btn(
    "notes",
    "连奏线",
    "⁀",
    () => pair("slur"),
    "连接选中范围，或当前与下一音 · S",
    "slur",
  );
  btn(
    "notes",
    "三连音",
    "⌜3⌝",
    () =>
      exec((m, a, b) => {
        const n = m.triplet(a, b, mode());
        hooks.position(a, n);
      }),
    "将当前音拆成等时长三连音；再次点击取消 · Alt+T",
    "tuplet",
  );
  btn(
    "notes",
    "拆为两音",
    "÷2",
    () => exec((m, a, b) => m.split(a, b)),
    "将当前音位（包括和弦）均分为两个音位，保持总时长",
  );
  const modeLabel = document.createElement("label");
  modeLabel.className = "tool-field";
  modeLabel.innerHTML =
    '更改时值<select id="durationMode" aria-label="更改时值模式"><option value="replace">替换后续音符</option><option value="protect">保护后续音符</option></select>';
  panel("notes").append(modeLabel);
  btn(
    "tab",
    "闷音 X",
    "×",
    () => exec((m, a, b, string) => m.toggleDead(a, b, string)),
    "闷音 / Dead note · X",
    "dead",
  );
  mark("tab", "幽灵音", "(●)", "ghost");
  btn(
    "tab",
    "击弦",
    "H",
    () => pair("hammer-on"),
    "同弦低品 → 高品 · H",
    "hammer-on",
  );
  btn(
    "tab",
    "勾弦",
    "P",
    () => pair("pull-off"),
    "同弦高品 → 低品 · P",
    "pull-off",
  );
  btn(
    "tab",
    "滑音",
    "╱",
    () => pair("slide"),
    "连接选中范围或下一音 · /",
    "slide",
  );
  for (const [label, symbol, tag] of [
    ["掌根制音", "P.M.", "palm"],
    ["持续发音", "L.R.", "let-ring"],
    ["泛音", "◇", "harmonic"],
    ["点弦", "T", "tap"],
    ["击弦音色", "S", "slap"],
    ["勾弦音色", "P", "pop"],
    ["上拨", "∨", "up-bow"],
    ["下拨", "⊓", "down-bow"],
  ])
    mark("tab", label, symbol, tag);
  const bend = document.createElement("div");
  bend.className = "tool-fields";
  bend.innerHTML =
    '<label class="tool-field">推弦音程<select id="bendAmount"><option value="1">半音</option><option value="2" selected>全音</option><option value="3">小三度</option><option value="4">大三度</option><option value="0.5">1/4 音</option></select></label><label class="tool-field">方式<select id="bendKind"><option value="bend">推弦</option><option value="prebend">预推弦</option><option value="release">回落</option><option value="bend-release">推弦 + 回落</option><option value="none">移除推弦</option></select></label>';
  panel("tab").append(bend);
  btn(
    "tab",
    "应用推弦",
    "↗",
    () =>
      exec((m, a, b, string) =>
        m.setBend(
          a,
          b,
          Number(host.querySelector("#bendAmount").value),
          host.querySelector("#bendKind").value,
          string,
        ),
      ),
    "写入所选音符的推弦标记",
    "bend",
  );
  for (const [label, symbol, tag] of [
    ["断奏", "•", "staccato"],
    ["保持音", "—", "tenuto"],
    ["重音", ">", "accent"],
    ["强重音", "^", "strong-accent"],
    ["延长", "𝄐", "fermata"],
  ])
    mark("articulations", label, symbol, tag);
  btn("articulations", "连奏线", "⁀", () => pair("slur"), "连奏线 · S", "slur");
  for (const [label, symbol, tag] of [
    ["颤音", "tr", "trill-mark"],
    ["震音", "≋", "tremolo"],
    ["波音", "𝆝", "mordent"],
    ["上波音", "𝆝̸", "inverted-mordent"],
    ["回音", "∽", "turn"],
    ["逆回音", "∽̸", "inverted-turn"],
    ["揉弦", "≈", "smear"],
  ])
    mark("ornaments", label, symbol, tag);
  for (const d of [
    "ppp",
    "pp",
    "p",
    "mp",
    "mf",
    "f",
    "ff",
    "fff",
    "sfz",
    "rfz",
    "fp",
    "pf",
  ]) {
    const b = btn("dynamics", d, d, () =>
      exec((m, a, b) => m.setDynamic(a, b, d)),
    );
    b.dataset.dynamic = d;
    b.classList.add("dynamic-button");
  }
  for (const [label, symbol, kind] of [
    ["渐强", "<", "crescendo"],
    ["渐弱", ">", "diminuendo"],
  ])
    btn(
      "dynamics",
      label,
      symbol,
      () => {
        const s = state(),
          current = s.model.notes.indexOf(s.model.event(s.mi, s.ni)),
          begin = Math.min(s.rangeStart ?? current, current),
          end = s.rangeStart == null ? null : Math.max(s.rangeStart, current),
          e = s.model.notes[begin];
        hooks.run(() => s.model.hairpin(e.mi, e.ni, kind, end));
      },
      "先 Shift 选择范围，或连接当前与下一音",
    );
  btn("dynamics", "清除力度", "⌫", () =>
    exec((m, a, b) => m.setDynamic(a, b, "")),
  );
  btn("measures", "前插小节", "＋←", () =>
    hooks.structure((m, a) => m.insertMeasure(a), -1),
  );
  btn(
    "measures",
    "后插小节",
    "→＋",
    () => hooks.structure((m, a) => m.insertMeasure(a + 1), 1),
    "在当前小节后插入 · Alt+Enter",
  );
  btn(
    "measures",
    "删除小节",
    "−",
    () => hooks.structure((m, a) => m.removeMeasure(a)),
    "删除当前小节，可撤销 · Ctrl+Backspace",
  );
  const time = document.createElement("div");
  time.className = "tool-fields";
  time.innerHTML =
    '<label class="tool-field">拍号<span class="fraction-input"><input type="number" id="timeBeats" aria-label="拍号分子" min="1" max="32" value="4"><span>/</span><select id="timeUnit" aria-label="拍号分母"><option>1</option><option>2</option><option selected>4</option><option>8</option><option>16</option></select></span></label><label class="tool-field">应用范围<select id="timeScope"><option value="current">仅当前小节</option><option value="following">直到下一拍号</option></select></label><label class="trim-label"><input id="trimTime" type="checkbox">截去超出内容（可撤销）</label>';
  panel("measures").append(time);
  btn("measures", "应用拍号", "𝄴", () =>
    hooks.structure((m, a) =>
      m.setTimeSignature(
        a,
        Number(host.querySelector("#timeBeats").value),
        Number(host.querySelector("#timeUnit").value),
        host.querySelector("#timeScope").value,
        host.querySelector("#trimTime").checked,
      ),
    ),
  );
  const tempo = document.createElement("label");
  tempo.className = "tool-field";
  tempo.innerHTML =
    '速度 BPM<input id="tempoValue" type="number" min="20" max="300" value="120">';
  panel("measures").append(tempo);
  btn("measures", "写入速度", "♩=", () =>
    exec((m, a) =>
      m.setTempo(a, Number(host.querySelector("#tempoValue").value)),
    ),
  );
  const text = document.createElement("div");
  text.className = "tone-fields";
  text.innerHTML =
    '<label class="tool-field">演奏 / 音色文字<input id="toneText" maxlength="200" placeholder="如 Fingerstyle、Pick、sul ponticello" list="tonePresets"></label><datalist id="tonePresets"><option value="Fingerstyle"><option value="Pick"><option value="Slap"><option value="sul ponticello"><option value="sul tasto"><option value="pizz."><option value="distortion"><option value="clean"></datalist><span class="muted small">文字标记会显示在谱面并写入 MusicXML。</span>';
  panel("text").append(text);
  btn("text", "写入文字", "Aa", () =>
    exec((m, a, b) => m.setText(a, b, host.querySelector("#toneText").value)),
  );
  btn("text", "移除文字", "⌫", () => exec((m, a, b) => m.setText(a, b, "")));
  function switchTab(id) {
    active = id;
    for (const [x] of tabs) {
      host.querySelector("#toolpanel-" + x).hidden = x !== id;
      host
        .querySelector("#tooltab-" + x)
        .setAttribute("aria-selected", String(x === id));
    }
    focus();
  }
  for (const b of host.querySelectorAll("[data-tab]"))
    b.onclick = () => switchTab(b.dataset.tab);
  switchTab(active);
  bindTranslations(host);
  return {
    mode,
    switchTab,
    refresh() {
      const s = state();
      if (!s.model) return;
      const e = s.model.event(s.mi, s.ni);
      if (!e) return;
      const tone = s.model.tone(s.mi, s.ni, s.selectedString),
        marks = s.model.marks(s.mi, s.ni, s.selectedString),
        m = s.model.measures[s.mi];
      for (const b of host.querySelectorAll(".tool-button")) {
        b.disabled = !s.model.editable;
        const mark = b.dataset.mark;
        const enabled =
          mark === "dots"
            ? e.dots > 0
            : mark === "rest"
              ? e.rest
              : mark === "tie"
                ? tone?.tieStart
                : mark === "dead"
                  ? tone?.dead
                  : mark === "tuplet"
                    ? e.tuplet
                    : marks.tags.has(mark);
        const selected = b.dataset.duration
          ? b.dataset.duration === e.type
          : b.dataset.dynamic
            ? b.dataset.dynamic === marks.dynamic
            : enabled;
        b.setAttribute("aria-pressed", String(!!selected));
      }
      host.querySelector("#timeBeats").value = m.beats;
      host.querySelector("#timeUnit").value = m.unit;
      host.querySelector("#tempoValue").value =
        s.model.tempoMap.findLast((t) => t.q <= m.q)?.bpm ?? s.model.tempo;
      host.querySelector("#toolSelection").textContent =
        tr`第 ${s.mi + 1} 小节 · 第 ${s.ni + 1} 音位 · ${s.selectedString} 弦${e.tones.length > 1 ? tr` · ${e.tones.length} 音和弦` : ""}${!tone && !e.rest ? tr(" · 输入数字添加音") : ""}${s.rangeStart != null ? tr(" · 已选范围") : ""}${e.tuplet ? tr(" · 三连音") : ""}${e.dots ? " · " + (e.dots === 2 ? tr("双附点") : tr("附点")) : ""}`;
    },
  };
}
