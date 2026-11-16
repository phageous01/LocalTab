import { t as tr } from "./i18n.js";
import { ScoreDocument, NOTE_VALUES } from "./editor-model.js";
import { xml, pitchName } from "./model.js";

const { kids, all, child, txt, add, set, remove, setTie } = xml;
const FORMAT = "localtab-notes";
const LIMIT = 2_000_000;
const PAIRS = ["slur", "slide", "glissando", "hammer-on", "pull-off", "tuplet"];
const ticks = (q) => Math.round(q * 480);
const detach = (n) => n.parentNode?.removeChild(n);
const technical = (n) => all(n, "technical")[0];
const isTie = (n, type) =>
  kids(n).some((e) => e.nodeName === "tie" && e.getAttribute("type") === type);
const sounding = (n) => !child(n, "rest") && txt(n, "notehead") !== "x";
const sameTone = (a, b) =>
  a &&
  b &&
  sounding(a) &&
  sounding(b) &&
  txt(technical(a), "string") === txt(technical(b), "string") &&
  txt(technical(a), "fret") === txt(technical(b), "fret");

// Keep only connections whose two endpoints survive. Never connect a pasted
// fragment to unrelated surrounding notes just because their pitches match.
function cleanConnections(groups, nextNumber = null) {
  for (const tag of PAIRS) {
    const pending = new Map(),
      keep = new Set();
    for (const group of groups)
      for (const note of group)
        for (const mark of all(note, tag)) {
          const key = mark.getAttribute("number") || "1",
            type = mark.getAttribute("type");
          if (type === "start") pending.set(key, mark);
          else if (type === "stop" && pending.has(key)) {
            const start = pending.get(key);
            keep.add(start);
            keep.add(mark);
            pending.delete(key);
            if (nextNumber) {
              const number = String(nextNumber());
              start.setAttribute("number", number);
              mark.setAttribute("number", number);
            }
          }
        }
    for (const group of groups)
      for (const note of group)
        for (const mark of all(note, tag)) if (!keep.has(mark)) detach(mark);
  }
  groups.forEach((group, i) =>
    group.forEach((note) => {
      for (const [type, offset, other] of [
        ["start", 1, "stop"],
        ["stop", -1, "start"],
      ]) {
        if (!isTie(note, type)) continue;
        const match = groups[i + offset]?.find(
          (n) => sameTone(note, n) && isTie(n, other),
        );
        if (!match) setTie(note, type, false);
      }
    }),
  );
}

function normalizedNote(tone) {
  const n = tone.el.cloneNode(true);
  const stripComments = (node) => {
    for (const c of Array.from(node.childNodes || [])) {
      if (c.nodeType === 8 || c.nodeType === 7) node.removeChild(c);
      else stripComments(c);
    }
  };
  stripComments(n);
  set(n, "duration", ticks(tone.duration));
  set(n, "voice", 1);
  for (const tag of ["beam", "staff", "instrument"]) remove(n, tag);
  for (const attr of [
    "id",
    "default-x",
    "default-y",
    "relative-x",
    "relative-y",
  ])
    n.removeAttribute(attr);
  child(n, "rest")?.removeAttribute("measure");
  return n;
}

export function copyNotes(model, start, end = start) {
  model.requireEdit();
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    Math.min(start, end) < 0 ||
    Math.max(start, end) >= model.notes.length
  )
    throw Error(tr("请选择要复制的音符"));
  const selected = model.notes.slice(
    Math.min(start, end),
    Math.max(start, end) + 1,
  );
  const groups = selected.map((b) => b.tones.map(normalizedNote));
  cleanConnections(groups);
  const serializer = new XMLSerializer();
  const result = JSON.stringify({
    format: FORMAT,
    version: 1,
    tuning: model.tuning,
    xml: groups
      .flat()
      .map((n) => serializer.serializeToString(n))
      .join(""),
  });
  if (result.length > LIMIT) throw Error(tr("选区过大，请分段复制"));
  return result;
}

export function readNotes(text) {
  if (typeof text !== "string" || text.length > LIMIT)
    throw Error(tr("剪贴板片段过大或无效"));
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error(tr("请先在 LocalTab 中复制一段音符"));
  }
  if (
    data?.format !== FORMAT ||
    data.version !== 1 ||
    typeof data.xml !== "string" ||
    !Array.isArray(data.tuning) ||
    ![4, 5, 6].includes(data.tuning.length) ||
    data.tuning.some((n) => !Number.isInteger(n) || n < 12 || n > 119) ||
    /<!|<\?/.test(data.xml)
  )
    throw Error(tr("不是受支持的 LocalTab 音符片段"));
  const fragment = new DOMParser().parseFromString(
    `<fragment>${data.xml}</fragment>`,
    "application/xml",
  );
  if (
    all(fragment, "parsererror").length ||
    !kids(fragment.documentElement).length ||
    kids(fragment.documentElement).some((n) => n.nodeName !== "note")
  )
    throw Error(tr("音符片段无法解析"));
  const noteChildren = new Set(
    "chord pitch rest duration tie voice type dot accidental time-modification stem notehead notations lyric play".split(
      " ",
    ),
  );
  for (const note of kids(fragment.documentElement)) {
    if (kids(note).some((n) => !noteChildren.has(n.nodeName)))
      throw Error(tr("片段包含不支持的音符结构"));
    for (const n of [note, ...all(note, "*")])
      for (const attr of Array.from(n.attributes || []))
        if (
          /^(on|src$|href$|source$)/i.test(attr.name) ||
          (attr.name.includes(":") &&
            !["xml:lang", "xml:space"].includes(attr.name))
        )
          throw Error(tr("音符片段属性无效"));
  }
  const tuning = data.tuning
    .map((midi, i) => {
      const name = pitchName(midi);
      return `<staff-tuning line="${i + 1}"><tuning-step>${name[0]}</tuning-step>${name[1] === "#" ? "<tuning-alter>1</tuning-alter>" : ""}<tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave></staff-tuning>`;
    })
    .join("");
  const model = new ScoreDocument(
    `<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>480</divisions><staff-details>${tuning}</staff-details></attributes>${data.xml}</measure></part></score-partwise>`,
  );
  model.requireEdit();
  if (!model.notes.length || model.notes.length > 10000)
    throw Error(tr("音符片段长度无效"));
  for (const beat of model.notes)
    for (const tone of beat.tones) {
      const duration =
        (NOTE_VALUES[tone.type] * (2 - 2 ** -tone.dots) * tone.normalNotes) /
        tone.actualNotes;
      if (
        !Number.isInteger(ticks(tone.duration)) ||
        tone.duration <= 0 ||
        tone.duration > 128 ||
        Math.abs(tone.duration * 480 - ticks(tone.duration)) > 1e-6 ||
        !Number.isFinite(duration) ||
        Math.abs(duration - tone.duration) > 1e-6 ||
        tone.dots > 2 ||
        (tone.tuplet && (tone.actualNotes !== 3 || tone.normalNotes !== 2)) ||
        (!tone.rest &&
          (!Number.isInteger(tone.string) ||
            tone.string < 1 ||
            tone.string > data.tuning.length ||
            !Number.isInteger(tone.fret) ||
            tone.fret < 0 ||
            tone.fret > 36 ||
            !Number.isFinite(tone.midi)))
      )
        throw Error(tr("音符片段的时值、弦号或品位无效"));
    }
  return model;
}

// A paste may end inside a note, or cross a bar line. Express the resulting
// durations as ordinary/dotted/triplet notes instead of changing bar lengths.
function rhythmChunks(length, preferredTuplet = false) {
  const choices = [];
  for (const triplet of preferredTuplet ? [true, false] : [false, true])
    for (const [type, q] of Object.entries(NOTE_VALUES))
      for (const dots of [0, 1, 2]) {
        const value = q * (2 - 2 ** -dots) * (triplet ? 2 / 3 : 1) * 480;
        if (
          Number.isInteger(value) &&
          value <= length &&
          !choices.some((c) => c.ticks === value)
        )
          choices.push({ ticks: value, type, dots, triplet });
      }
  const exact = choices.find((c) => c.ticks === length);
  if (exact) return [exact];
  if (length > 61440 || length % 5)
    throw Error(tr("粘贴边界的时值无法表示，请对齐完整音位或连音组"));
  const count = new Float64Array(length + 1).fill(Infinity),
    previous = new Map();
  count[0] = 0;
  for (let t = 5; t <= length; t += 5)
    for (const c of choices)
      if (t >= c.ticks && count[t - c.ticks] + 1 < count[t]) {
        count[t] = count[t - c.ticks] + 1;
        previous.set(t, c);
      }
  if (!Number.isFinite(count[length]))
    throw Error(tr("粘贴边界的时值无法表示，请对齐完整音位或连音组"));
  const result = [];
  for (let t = length; t > 0; ) {
    const c = previous.get(t);
    result.push(c);
    t -= c.ticks;
  }
  return result;
}

function joinTies(a, b) {
  a.forEach((n, i) => {
    if (sounding(n)) {
      setTie(n, "start", true);
      setTie(b[i], "stop", true);
    }
  });
}

function sliceBeat(nodes, offset, length) {
  const total = Number(txt(nodes[0], "duration"));
  if (!offset && length === total) return [nodes.map((n) => n.cloneNode(true))];
  const result = [];
  let position = offset;
  for (const rhythm of rhythmChunks(
    length,
    !!child(nodes[0], "time-modification"),
  )) {
    const group = nodes.map((node) => {
      const n = node.cloneNode(true);
      set(n, "duration", rhythm.ticks);
      set(n, "type", rhythm.type);
      remove(n, "dot");
      for (let i = 0; i < rhythm.dots; i++) add(n, "dot");
      remove(n, "time-modification");
      if (rhythm.triplet) {
        const tm = add(n, "time-modification");
        add(tm, "actual-notes", 3);
        add(tm, "normal-notes", 2);
        add(tm, "normal-type", rhythm.type);
      }
      if (position > 0) setTie(n, "stop", false);
      if (position + rhythm.ticks < total) setTie(n, "start", false);
      for (const tag of PAIRS)
        for (const mark of all(n, tag)) {
          if (
            (mark.getAttribute("type") === "start" && position > 0) ||
            (mark.getAttribute("type") === "stop" &&
              position + rhythm.ticks < total) ||
            (tag === "tuplet" && !rhythm.triplet)
          )
            detach(mark);
        }
      return n;
    });
    if (result.length) joinTies(result.at(-1), group);
    result.push(group);
    position += rhythm.ticks;
  }
  return result;
}

function rewriteMeasure(measure, groups) {
  let oldPosition = 0;
  const skeleton = [];
  for (const node of kids(measure.el)) {
    if (node.nodeName === "note") {
      if (!child(node, "chord")) oldPosition += Number(txt(node, "duration"));
    } else skeleton.push({ node, position: oldPosition });
  }
  while (measure.el.firstChild) measure.el.removeChild(measure.el.firstChild);
  let index = 0,
    position = 0;
  const appendGroup = () => {
    const group = groups[index++];
    group.forEach((n) => measure.el.appendChild(n));
    position += Number(txt(group[0], "duration"));
  };
  for (const entry of skeleton) {
    while (index < groups.length && position < entry.position) appendGroup();
    if (["direction", "sound", "harmony"].includes(entry.node.nodeName)) {
      const offset =
        entry.position + Number(txt(entry.node, "offset", 0)) - position;
      if (offset) set(entry.node, "offset", offset);
      else remove(entry.node, "offset");
    }
    measure.el.appendChild(entry.node);
  }
  while (index < groups.length) appendGroup();
}

export function pasteNotes(target, atIndex, text) {
  target.requireEdit();
  const clip = readNotes(text),
    work = new ScoreDocument(target.serialize(), target.activePartId);
  work.requireEdit();
  work.normalizeDivisions();
  if (!Number.isInteger(atIndex) || !work.notes[atIndex])
    throw Error(tr("请选择粘贴起点"));
  if (work.measures.some((m) => Math.abs(m.actualLength - m.length) > 1e-6))
    throw Error(tr("请先补齐不完整的小节，再粘贴音符"));
  const start = ticks(work.notes[atIndex].q),
    length = clip.notes.reduce((sum, b) => sum + ticks(b.duration), 0),
    end = start + length;
  const oldBars = work.measures.length;
  if (length > 480 * 128 * 200) throw Error(tr("片段过长，请分段粘贴"));
  while (ticks(work.totalQ) < end) {
    if (work.measures.length >= 2000) throw Error(tr("粘贴后小节数过多"));
    work.appendMeasure();
  }
  let nextNumber =
    Math.max(
      0,
      ...PAIRS.flatMap((tag) =>
        all(work.part, tag).map((n) => Number(n.getAttribute("number")) || 0),
      ),
    ) + 1;
  const incoming = clip.notes.map((b) =>
    b.tones.map((t) => work.doc.importNode(normalizedNote(t), true)),
  );
  cleanConnections(incoming, () => nextNumber++);
  // TAB copy keeps string/fret fingering. Recalculate pitch for the target tuning.
  for (const group of incoming)
    for (const n of group)
      if (!child(n, "rest")) {
        const string = Number(txt(technical(n), "string")),
          fret = Number(txt(technical(n), "fret"));
        if (string > work.tuning.length)
          throw Error(tr("片段包含目标乐器没有的弦，请粘贴到弦数相容的乐谱"));
        const midi = work.tuning[work.tuning.length - string] + fret,
          name = pitchName(midi),
          p = child(n, "pitch");
        if (!p) throw Error(tr("片段缺少音高"));
        while (p.firstChild) p.removeChild(p.firstChild);
        add(p, "step", name[0]);
        if (name[1] === "#") add(p, "alter", 1);
        add(p, "octave", Math.floor(midi / 12) - 1);
        remove(n, "accidental");
      }
  const original = work.notes.map((b) => ({
    q: ticks(b.q),
    duration: ticks(b.duration),
    nodes: b.tones.map((t) => t.el.cloneNode(true)),
  }));
  const events = [];
  for (const e of original) {
    if (e.q < start || e.q >= end) events.push(e);
    else if (e.q + e.duration > end) {
      let q = end;
      for (const nodes of sliceBeat(
        e.nodes,
        end - e.q,
        e.q + e.duration - end,
      )) {
        const duration = Number(txt(nodes[0], "duration"));
        events.push({ q, duration, nodes });
        q += duration;
      }
    }
  }
  let q = start;
  for (const nodes of incoming) {
    const duration = Number(txt(nodes[0], "duration"));
    events.push({ q, duration, nodes });
    q += duration;
  }
  events.sort((a, b) => a.q - b.q);
  const byBar = work.measures.map(() => []);
  let barIndex = 0;
  for (const e of events) {
    let offset = 0,
      previous = null;
    while (offset < e.duration) {
      while (
        barIndex + 1 < work.measures.length &&
        ticks(work.measures[barIndex + 1].q) <= e.q + offset
      )
        barIndex++;
      const bar = work.measures[barIndex],
        available = ticks(bar.q + bar.length) - e.q - offset;
      const span = Math.min(available, e.duration - offset);
      if (span <= 0) throw Error(tr("粘贴位置超出小节范围"));
      const pieces = sliceBeat(e.nodes, offset, span);
      if (previous) joinTies(previous, pieces[0]);
      byBar[barIndex].push(...pieces);
      previous = pieces.at(-1);
      offset += span;
    }
  }
  for (const m of work.measures) {
    if (ticks(m.q) < end && ticks(m.q + m.length) > start)
      for (const group of byBar[m.index])
        for (const n of group) remove(n, "beam");
  }
  cleanConnections(byBar.flat());
  work.measures.forEach((m, i) => rewriteMeasure(m, byBar[i]));
  work.refresh();
  if (
    !work.editable ||
    work.measures.some((m) => Math.abs(m.actualLength - m.length) > 1e-6)
  )
    throw Error(tr("粘贴无法保持小节时值，未修改乐谱"));
  target.doc = work.doc;
  target.refresh();
  const first = target.notes.findIndex((n) => ticks(n.q) === start);
  const last = target.notes.findLastIndex((n) => ticks(n.q) < end);
  return {
    first,
    last,
    count: clip.notes.length,
    addedBars: target.measures.length - oldBars,
  };
}
