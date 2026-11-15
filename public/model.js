export const PRESETS = {
  bass4: ["E1", "A1", "D2", "G2"],
  bass5: ["B0", "E1", "A1", "D2", "G2"],
  guitar6: ["E2", "A2", "D3", "G3", "B3", "E4"],
};
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const order = [
  "grace",
  "cue",
  "chord",
  "pitch",
  "unpitched",
  "rest",
  "duration",
  "tie",
  "instrument",
  "footnote",
  "level",
  "voice",
  "type",
  "dot",
  "accidental",
  "time-modification",
  "stem",
  "notehead",
  "staff",
  "beam",
  "notations",
  "lyric",
  "play",
  "listen",
];
const kids = (e) =>
  Array.from(e?.childNodes || []).filter((n) => n.nodeType === 1);
const all = (e, tag) => Array.from(e?.getElementsByTagName(tag) || []);
const child = (e, tag) =>
  kids(e).find((n) => n.localName === tag || n.nodeName === tag);
const txt = (e, tag, fallback = "") => child(e, tag)?.textContent ?? fallback;
const remove = (e, tag) =>
  kids(e)
    .filter((n) => n.nodeName === tag)
    .forEach((n) => e.removeChild(n));
function add(e, tag, value) {
  const n = e.ownerDocument.createElement(tag);
  if (value !== undefined) n.textContent = String(value);
  if (e.nodeName === "note") {
    const rank = order.indexOf(tag);
    const before = kids(e).find((c) => order.indexOf(c.nodeName) > rank);
    e.insertBefore(n, before || null);
  } else e.appendChild(n);
  return n;
}
function set(e, tag, value) {
  const n = child(e, tag) || add(e, tag);
  n.textContent = String(value);
  return n;
}
export function pitchNumber(name) {
  const m = /^([A-Ga-g])([#b]?)([0-8])$/.exec(name.trim());
  if (!m) throw Error("调弦格式如 E1、F#1、Bb0");
  return (
    { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()] +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) +
    (Number(m[3]) + 1) * 12
  );
}
export function pitchName(n) {
  return names[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
function writePitch(n, midi) {
  remove(n, "rest");
  remove(n, "unpitched");
  let p = child(n, "pitch") || add(n, "pitch");
  while (p.firstChild) p.removeChild(p.firstChild);
  const name = pitchName(midi);
  add(p, "step", name[0]);
  if (name[1] === "#") add(p, "alter", 1);
  add(p, "octave", Math.floor(midi / 12) - 1);
  remove(n, "accidental");
}
function writeTab(n, string, fret) {
  const no = child(n, "notations") || add(n, "notations");
  const te = child(no, "technical") || add(no, "technical");
  set(te, "string", string);
  set(te, "fret", fret);
}
function setTie(n, type, on) {
  for (const el of kids(n).filter(
    (c) => c.nodeName === "tie" && c.getAttribute("type") === type,
  ))
    n.removeChild(el);
  const no = child(n, "notations");
  if (no)
    for (const e of kids(no).filter(
      (c) => c.nodeName === "tied" && c.getAttribute("type") === type,
    ))
      no.removeChild(e);
  if (on) {
    add(n, "tie").setAttribute("type", type);
    add(no || add(n, "notations"), "tied").setAttribute("type", type);
  }
}
const durations = [
  [4, "whole", 0],
  [3, "half", 1],
  [2, "half", 0],
  [1.5, "quarter", 1],
  [1, "quarter", 0],
  [0.75, "eighth", 1],
  [0.5, "eighth", 0],
  [0.375, "16th", 1],
  [0.25, "16th", 0],
  [0.1875, "32nd", 1],
  [0.125, "32nd", 0],
  [0.0625, "64th", 0],
];
function setDurationNode(n, q) {
  const info = durations.find((d) => Math.abs(d[0] - q) < 0.00001);
  if (!info) throw Error("原型暂不支持这个时值");
  set(n, "duration", Math.round(q * 480));
  set(n, "type", info[1]);
  remove(n, "dot");
  if (info[2]) add(n, "dot");
  remove(n, "beam");
}
function restNodes(doc, q) {
  const result = [];
  for (const d of durations) {
    while (q >= d[0] - 0.000001) {
      const n = doc.createElement("note");
      add(n, "rest");
      add(n, "voice", "1");
      setDurationNode(n, d[0]);
      result.push(n);
      q -= d[0];
    }
  }
  if (q > 0.00001) throw Error("余下时值无法表示");
  return result;
}

export class ScoreDocument {
  constructor(xml) {
    this.doc = new DOMParser().parseFromString(xml, "application/xml");
    if (all(this.doc, "parsererror").length) throw Error("MusicXML 无法解析");
    this.refresh();
  }
  refresh() {
    const root = this.doc.documentElement;
    if (root.localName !== "score-partwise")
      throw Error("请选择 partwise MusicXML");
    this.parts = kids(root).filter((n) => n.nodeName === "part");
    this.part = this.parts[0];
    if (!this.part) throw Error("乐谱中没有声部");
    this.title = all(root, "work-title")[0]?.textContent || "未命名乐谱";
    this.tempo = Number(
      all(root, "sound")
        .find((n) => n.hasAttribute("tempo"))
        ?.getAttribute("tempo") ||
        all(root, "per-minute")[0]?.textContent ||
        120,
    );
    const tuning = all(all(this.part, "staff-details")[0], "staff-tuning")
      .slice(0, 14)
      .sort(
        (a, b) =>
          Number(a.getAttribute("line")) - Number(b.getAttribute("line")),
      );
    this.tuning = tuning.map(
      (n) =>
        ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[txt(n, "tuning-step")] +
        Number(txt(n, "tuning-alter", "0")) +
        12 * (Number(txt(n, "tuning-octave")) + 1),
    );
    this.editable =
      this.parts.length === 1 &&
      [4, 5, 6].includes(this.tuning.length) &&
      !all(this.part, "backup").length &&
      !all(this.part, "forward").length &&
      !all(this.part, "grace").length &&
      !all(this.part, "repeat").length &&
      !all(this.part, "sound").some(
        (s) => s.hasAttribute("dacapo") || s.hasAttribute("dalsegno"),
      ) &&
      new Set(all(this.part, "voice").map((n) => n.textContent)).size <= 1;
    this.measures = [];
    this.notes = [];
    let div = 1,
      q = 0,
      beats = 4,
      unit = 4;
    for (const [mi, m] of kids(this.part)
      .filter((n) => n.nodeName === "measure")
      .entries()) {
      const at = child(m, "attributes");
      div = Number(txt(at, "divisions", div));
      const tim = child(at, "time");
      if (tim) {
        beats = Number(txt(tim, "beats", 4));
        unit = Number(txt(tim, "beat-type", 4));
      }
      const measure = {
        el: m,
        index: mi,
        q,
        length: (beats * 4) / unit,
        beats,
        unit,
        div,
        notes: [],
      };
      let offset = 0;
      for (const n of kids(m).filter((n) => n.nodeName === "note")) {
        const isChord = !!child(n, "chord"),
          previous = measure.notes.at(-1);
        const ni = isChord && previous ? previous.ni : measure.notes.length;
        const p = child(n, "pitch"),
          te = all(n, "technical")[0];
        const midi = p
          ? { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[txt(p, "step")] +
            Number(txt(p, "alter", 0)) +
            12 * (Number(txt(p, "octave")) + 1)
          : null;
        const event = {
          el: n,
          mi,
          ni,
          q: isChord && previous ? previous.q : q + offset,
          duration: Number(txt(n, "duration", 0)) / div,
          rest: !!child(n, "rest"),
          midi,
          string: Number(txt(te, "string", 1)),
          fret: Number(txt(te, "fret", 0)),
          dead: txt(n, "notehead") === "x",
          type: txt(n, "type", "quarter"),
          dots: kids(n).filter((x) => x.nodeName === "dot").length,
          tuplet: !!child(n, "time-modification"),
          actualNotes: Number(
            txt(child(n, "time-modification"), "actual-notes", 1),
          ),
          normalNotes: Number(
            txt(child(n, "time-modification"), "normal-notes", 1),
          ),
          tieStart: kids(n).some(
            (e) => e.nodeName === "tie" && e.getAttribute("type") === "start",
          ),
          tieStop: kids(n).some(
            (e) => e.nodeName === "tie" && e.getAttribute("type") === "stop",
          ),
        };
        if (isChord && previous) {
          if (
            previous.rest ||
            event.rest ||
            Math.abs(previous.duration - event.duration) > 1e-6 ||
            previous.type !== event.type ||
            previous.dots !== event.dots ||
            previous.actualNotes !== event.actualNotes ||
            previous.normalNotes !== event.normalNotes ||
            previous.tones.some((t) => t.string === event.string)
          )
            this.editable = false;
          previous.tones.push(event);
        } else {
          if (isChord) this.editable = false;
          const beat = { ...event, tones: [event] };
          measure.notes.push(beat);
          this.notes.push(beat);
          offset += event.duration;
        }
      }
      measure.actualLength = offset;
      this.measures.push(measure);
      q += measure.length;
    }
    this.totalQ = q;
  }
  serialize() {
    return new XMLSerializer().serializeToString(this.doc);
  }
  requireEdit() {
    if (!this.editable)
      throw Error(
        "当前编辑单声部、无复杂反复的4–6弦谱。复杂谱可查看与原样导出。",
      );
  }
  event(mi, ni) {
    return this.measures[mi]?.notes[ni];
  }
  tone(mi, ni, string = null) {
    const e = this.event(mi, ni);
    return string == null
      ? e?.tones[0]
      : e?.tones.find((t) => !t.rest && t.string === string);
  }
  requireTone(mi, ni, string = null) {
    const tone = this.tone(mi, ni, string);
    if (!tone || tone.rest) throw Error("当前弦没有音符，请先输入品位");
    return tone;
  }
  adjacentTone(event, direction) {
    const index = this.notes.indexOf(this.event(event.mi, event.ni));
    return this.notes[index + direction]?.tones.find(
      (t) => !t.rest && t.string === event.string,
    );
  }
  group(event) {
    const tone = event.tones?.[0] || event;
    const result = [tone];
    let next;
    while (
      result[0].tieStop &&
      (next = this.adjacentTone(result[0], -1))?.tieStart &&
      next.midi === tone.midi
    )
      result.unshift(next);
    while (
      result.at(-1).tieStart &&
      (next = this.adjacentTone(result.at(-1), 1))?.tieStop &&
      next.midi === tone.midi
    )
      result.push(next);
    return result;
  }
  setFret(mi, ni, string, fret) {
    this.requireEdit();
    if (
      !Number.isInteger(string) ||
      string < 1 ||
      string > this.tuning.length ||
      !Number.isInteger(fret) ||
      fret < 0 ||
      fret > 36
    )
      throw Error("弦号或品位超出范围（0–36品）");
    const e = this.event(mi, ni);
    if (!e) throw Error("请选择音符");
    const midi = this.tuning[this.tuning.length - string] + fret;
    let tone = this.tone(mi, ni, string);
    if (!tone && !e.rest) {
      const n = e.el.cloneNode(true);
      for (const tag of [
        "notations",
        "tie",
        "notehead",
        "accidental",
        "play",
        "lyric",
        "beam",
      ])
        remove(n, tag);
      add(n, "chord");
      writePitch(n, midi);
      writeTab(n, string, fret);
      e.el.parentNode.insertBefore(n, e.tones.at(-1).el.nextSibling);
      this.refresh();
      return;
    }
    tone ||= e.tones[0];
    for (const x of this.group(tone)) {
      writePitch(x.el, midi);
      writeTab(x.el, string, fret);
    }
    this.refresh();
  }
  toggleRest(mi, ni) {
    this.requireEdit();
    const e = this.event(mi, ni);
    if (e.rest) {
      this.setFret(mi, ni, this.tuning.length, 0);
      return;
    }
    for (const tone of e.tones) this.disconnectTies(tone);
    for (const tone of e.tones.slice(1))
      tone.el.parentNode.removeChild(tone.el);
    for (const tag of [
      "pitch",
      "notehead",
      "accidental",
      "notations",
      "tie",
      "play",
    ])
      remove(e.el, tag);
    add(e.el, "rest");
    this.refresh();
  }
  disconnectTies(tone) {
    const previous = this.adjacentTone(tone, -1),
      next = this.adjacentTone(tone, 1);
    if (tone.tieStop && previous?.midi === tone.midi)
      setTie(previous.el, "start", false);
    if (tone.tieStart && next?.midi === tone.midi)
      setTie(next.el, "stop", false);
    setTie(tone.el, "start", false);
    setTie(tone.el, "stop", false);
  }
  removeTone(mi, ni, string) {
    this.requireEdit();
    const beat = this.event(mi, ni),
      tone = this.tone(mi, ni, string);
    if (!tone) return;
    if (beat.tones.length === 1) return this.toggleRest(mi, ni);
    this.disconnectTies(tone);
    if (tone.el === beat.el) {
      const promoted = beat.tones[1].el;
      remove(promoted, "chord");
      // Group brackets and beat-level marks must survive removal of the first tone.
      for (const mark of kids(child(tone.el, "notations")).filter((n) =>
        ["tuplet", "dynamics", "fermata"].includes(n.nodeName),
      )) {
        const no = child(promoted, "notations") || add(promoted, "notations");
        if (!child(no, mark.nodeName)) no.appendChild(mark.cloneNode(true));
      }
    }
    tone.el.parentNode.removeChild(tone.el);
    this.refresh();
  }
  toggleDead(mi, ni, string = null) {
    this.requireEdit();
    const e = this.requireTone(mi, ni, string);
    if (e.rest) throw Error("休止符不能设为闷音");
    if (e.tieStart || e.tieStop) throw Error("请先取消这个音的延音连接");
    remove(e.el, "notehead");
    if (!e.dead) add(e.el, "notehead", "x");
    this.refresh();
  }
  toggleTie(mi, ni, string = null) {
    this.requireEdit();
    const e = this.requireTone(mi, ni, string),
      next = this.adjacentTone(e, 1);
    if (e.tieStart) {
      setTie(e.el, "start", false);
      if (next) setTie(next.el, "stop", false);
    } else {
      if (
        !next ||
        e.rest ||
        next.rest ||
        e.dead ||
        next.dead ||
        e.midi !== next.midi ||
        e.string !== next.string ||
        e.fret !== next.fret
      )
        throw Error("延音线需要相邻的同弦、同品音符");
      setTie(e.el, "start", true);
      setTie(next.el, "stop", true);
    }
    this.refresh();
  }
  normalizeDivisions() {
    for (const m of this.measures) {
      const at =
        child(m.el, "attributes") ||
        m.el.insertBefore(
          this.doc.createElement("attributes"),
          m.el.firstChild,
        );
      const dv =
        child(at, "divisions") ||
        at.insertBefore(this.doc.createElement("divisions"), at.firstChild);
      dv.textContent = "480";
      for (const offset of all(m.el, "offset"))
        offset.textContent = String(
          Math.round((Number(offset.textContent) * 480) / m.div),
        );
      for (const e of m.notes.flatMap((b) => b.tones))
        set(e.el, "duration", Math.round(e.duration * 480));
    }
    this.refresh();
  }
  setDuration(mi, ni, duration) {
    this.requireEdit();
    if (this.event(mi, ni).tuplet) throw Error("请使用工具栏修改连音组时值");
    this.normalizeDivisions();
    const m = this.measures[mi],
      e = m.notes[ni];
    if (e.tones.some((t) => t.tieStart || t.tieStop))
      throw Error("请先取消延音连接，再更改时值");
    const diff = duration - e.duration;
    if (diff > 0) {
      let available = 0;
      const rests = [];
      for (
        let j = ni + 1;
        j < m.notes.length && m.notes[j].rest && available < diff;
        j++
      ) {
        available += m.notes[j].duration;
        rests.push(m.notes[j]);
      }
      if (available + 1e-6 < diff)
        throw Error("后方没有足够休止符；不会覆盖已有音符");
      const before = rests.length
        ? rests.at(-1).el.nextSibling
        : e.tones.at(-1).el.nextSibling;
      for (const r of rests) m.el.removeChild(r.el);
      for (const r of restNodes(this.doc, available - diff))
        m.el.insertBefore(r, before);
    } else if (diff < 0) {
      const before = e.tones.at(-1).el.nextSibling;
      for (const r of restNodes(this.doc, -diff)) m.el.insertBefore(r, before);
    }
    for (const tone of e.tones) setDurationNode(tone.el, duration);
    this.refresh();
  }
  split(mi, ni) {
    this.requireEdit();
    this.normalizeDivisions();
    const e = this.event(mi, ni);
    if (e.tones.some((t) => t.tieStart || t.tieStop))
      throw Error("请先取消延音连接，再拆分");
    if (e.duration < 0.25) throw Error("当前原型拆分最小到三十二分音符");
    const before = e.tones.at(-1).el.nextSibling;
    for (const t of e.tones) {
      const clone = t.el.cloneNode(true);
      setDurationNode(t.el, e.duration / 2);
      setDurationNode(clone, e.duration / 2);
      e.el.parentNode.insertBefore(clone, before);
    }
    this.refresh();
  }
  appendMeasure() {
    this.requireEdit();
    const m = this.doc.createElement("measure");
    m.setAttribute("number", this.measures.length + 1);
    this.normalizeDivisions();
    const last = this.measures.at(-1);
    for (const r of restNodes(this.doc, last.length)) m.appendChild(r);
    const barlines = all(last.el, "barline");
    for (const b of barlines)
      if (txt(b, "bar-style") === "light-heavy") last.el.removeChild(b);
    this.part.appendChild(m);
    this.refresh();
  }
  setTuning(values, mode = "fret") {
    this.requireEdit();
    const tuning = values.map(pitchNumber);
    if (![4, 5, 6].includes(tuning.length)) throw Error("请选择4、5或6弦");
    const changes = [],
      assigned = new Map();
    for (const beat of this.notes.filter((n) => !n.rest)) {
      const choices = beat.tones.map((e) => {
        if (mode !== "pitch") {
          if (e.string > tuning.length)
            throw Error("已有音符位于将被移除的弦上；请选择保留音高");
          return [{ string: e.string, fret: e.fret }];
        }
        const previous = this.adjacentTone(e, -1),
          fixed =
            e.tieStop && previous?.tieStart && previous.midi === e.midi
              ? assigned.get(previous.el)
              : null;
        return tuning
          .map((open, i) => ({
            string: tuning.length - i,
            fret: e.midi - open,
          }))
          .filter(
            (x) =>
              x.fret >= 0 &&
              x.fret <= 36 &&
              (!fixed || x.string === fixed.string),
          )
          .sort(
            (a, b) =>
              (a.string === e.string ? -100 : 0) +
              Math.abs(a.fret - e.fret) -
              ((b.string === e.string ? -100 : 0) + Math.abs(b.fret - e.fret)),
          );
      });
      const result = [],
        used = new Set();
      const assign = (i) => {
        if (i === choices.length) return true;
        for (const c of choices[i])
          if (!used.has(c.string)) {
            result[i] = c;
            used.add(c.string);
            if (assign(i + 1)) return true;
            used.delete(c.string);
          }
        return false;
      };
      if (!assign(0))
        throw Error(
          "新调弦无法把和弦的所有音放在不同弦上，请保留品位或使用更多/更低的弦",
        );
      beat.tones.forEach((e, i) => {
        const c = result[i];
        changes.push([e, c.string, c.fret]);
        assigned.set(e.el, c);
      });
    }
    const at = child(this.measures[0].el, "attributes");
    const details = child(at, "staff-details") || add(at, "staff-details");
    remove(details, "staff-tuning");
    set(details, "staff-lines", tuning.length);
    tuning.forEach((midi, i) => {
      const t = add(details, "staff-tuning");
      t.setAttribute("line", i + 1);
      const name = pitchName(midi);
      add(t, "tuning-step", name[0]);
      add(t, "tuning-alter", name[1] === "#" ? 1 : 0);
      add(t, "tuning-octave", Math.floor(midi / 12) - 1);
    });
    for (const [e, string, fret] of changes) {
      writePitch(e.el, tuning[tuning.length - string] + fret);
      writeTab(e.el, string, fret);
    }
    this.refresh();
  }
}

export function validateAnchors(points) {
  if (!Array.isArray(points)) throw Error("同步点必须是列表");
  const p = [...points].sort((a, b) => a.q - b.q);
  for (let i = 0; i < p.length; i++) {
    if (
      !Number.isFinite(p[i].q) ||
      !Number.isFinite(p[i].seconds) ||
      p[i].q < 0 ||
      p[i].seconds < 0
    )
      throw Error("同步点必须是非负数");
    if (i && (p[i].q <= p[i - 1].q || p[i].seconds <= p[i - 1].seconds))
      throw Error("同步点的乐谱位置和录音时间都必须递增");
  }
  return p;
}
function interpolate(x, points, from, to) {
  if (points.length < 2)
    throw Error("旧版线性映射需要两个点；请使用录音时间映射");
  let i = points.findIndex((p) => p[from] > x);
  if (i < 0) i = points.length - 1;
  else if (i === 0) i = 1;
  const a = points[i - 1],
    b = points[i];
  return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}
export const qToTime = (q, anchors) => interpolate(q, anchors, "q", "seconds");
export const timeToQ = (t, anchors) => interpolate(t, anchors, "seconds", "q");
export const xml = {
  kids,
  all,
  child,
  txt,
  remove,
  add,
  set,
  restNodes,
  setDurationNode,
  setTie,
};
