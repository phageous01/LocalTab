import { t as tr } from "./i18n.js";
import {
  ScoreDocument as BasicScoreDocument,
  xml,
  validateAnchors,
  pitchNumber,
} from "./model.js";
const {
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
} = xml;
export const NOTE_VALUES = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
};
const ensure = (e, tag) => child(e, tag) || add(e, tag);
const notations = (n) => ensure(n, "notations");
const technical = (n) => ensure(notations(n), "technical");
function removeTuplet(n) {
  remove(n, "time-modification");
  const no = child(n, "notations");
  if (no) remove(no, "tuplet");
}
function clearConnections(n) {
  remove(n, "tie");
  const no = child(n, "notations");
  if (!no) return;
  for (const tag of ["slur", "slide", "glissando"]) remove(no, tag);
  for (const tied of kids(no).filter(
    (x) => x.nodeName === "tied" && x.getAttribute("type") !== "let-ring",
  ))
    no.removeChild(tied);
  const te = child(no, "technical");
  if (te) for (const tag of ["hammer-on", "pull-off"]) remove(te, tag);
}
function writeRhythm(n, type, dots = 0, actual = 1, normal = 1) {
  if (!(type in NOTE_VALUES) || ![0, 1, 2].includes(dots))
    throw Error(tr("无效时值"));
  const q = (NOTE_VALUES[type] * (2 - 2 ** -dots) * normal) / actual;
  if (Math.abs(q * 480 - Math.round(q * 480)) > 1e-6)
    throw Error(tr("该时值超出当前精度"));
  set(n, "duration", Math.round(q * 480));
  set(n, "type", type);
  remove(n, "dot");
  for (let i = 0; i < dots; i++) add(n, "dot");
  remove(n, "beam");
  remove(n, "time-modification");
  if (actual !== normal) {
    const tm = add(n, "time-modification");
    add(tm, "actual-notes", actual);
    add(tm, "normal-notes", normal);
    add(tm, "normal-type", type);
  }
  return q;
}
function copyBeat(beat, edit) {
  return beat.tones.map((tone, i) => {
    const n = tone.el.cloneNode(true);
    clearConnections(n);
    edit(n, i);
    return n;
  });
}
export function playbackEvents(model) {
  // Grace groups borrow a short portion of the following beat for the basic
  // oscillator preview. Written beat positions and recording sync never change.
  const timing = new Map();
  for (let i = 0; i < model.notes.length; i++) {
    if (!model.notes[i].grace) continue;
    const group = [];
    while (model.notes[i]?.grace) group.push(model.notes[i++]);
    const main = model.notes[i];
    if (!main) break;
    const total = Math.min(main.duration / 4, group.length / 8);
    group.forEach((beat, j) => timing.set(beat, { q: main.q + total * j / group.length, duration: total / group.length }));
    timing.set(main, { q: main.q + total, shorten: total });
  }
  return model.notes.flatMap((beat) =>
    beat.tones
      .filter((t) => !t.rest && !t.tieStop)
      .map((tone) => ({
        ...tone,
        q: timing.get(beat)?.q ?? tone.q,
        duration: timing.get(beat)?.duration ?? (model.group(tone).reduce((sum, n) => sum + n.duration, 0) - (timing.get(beat)?.shorten || 0)),
        voices: beat.tones.length,
      })),
  ).filter((event) => event.duration > 0).sort((a, b) => a.q - b.q);
}

export class ScoreDocument extends BasicScoreDocument {
  addGrace(mi, ni, string) {
    this.requireEdit();
    const tone = this.requireTone(mi, ni, string), n = tone.el.cloneNode(true);
    for (const tag of ["grace", "chord", "duration", "tie", "notations", "play", "lyric", "beam", "dot", "time-modification"])
      remove(n, tag);
    add(n, "grace").setAttribute("slash", "yes");
    set(n, "type", "eighth");
    set(technical(n), "string", tone.string);
    set(technical(n), "fret", tone.fret);
    const beat = this.event(mi, ni);
    beat.el.parentNode.insertBefore(n, beat.el);
    this.refresh();
    return ni;
  }
  toggleGraceSlash(mi, ni) {
    this.requireEdit();
    const beat = this.event(mi, ni);
    if (!beat.grace) throw Error(tr("请先选择一个倚音"));
    for (const tone of beat.tones) child(tone.el, "grace").setAttribute("slash", beat.graceSlash ? "no" : "yes");
    this.refresh();
  }
  toggleOpenSlide(mi, ni, tag, string) {
    this.requireEdit();
    if (!["scoop", "plop", "doit", "falloff"].includes(tag)) throw Error(tr("无效滑音方向"));
    const tone = this.requireTone(mi, ni, string), arts = ensure(notations(tone.el), "articulations");
    const had = !!child(arts, tag), entry = ["scoop", "plop"].includes(tag);
    for (const other of entry ? ["scoop", "plop"] : ["doit", "falloff"]) remove(arts, other);
    if (!had) {
      // An open end and a specified slide endpoint are mutually exclusive.
      this.disconnectSlides(tone, entry ? "stop" : "start");
      const mark = add(arts, tag);
      mark.setAttribute("line-shape", "straight");
      mark.setAttribute("line-type", "solid");
    }
    this.refresh();
  }
  disconnectSlides(tone, type) {
    const tones = this.notes.flatMap((b) => b.tones), index = tones.findIndex((t) => t.el === tone.el);
    for (const tag of ["slide", "glissando"])
      for (const mark of all(tone.el, tag).filter((n) => n.getAttribute("type") === type)) {
        const candidates = type === "start" ? tones.slice(index + 1) : tones.slice(0, index).reverse();
        const number = mark.getAttribute("number") || "1";
        for (const other of candidates) {
          const end = all(other.el, tag).find((n) => n.getAttribute("type") === (type === "start" ? "stop" : "start") && (n.getAttribute("number") || "1") === number);
          if (end) { end.parentNode.removeChild(end); break; }
        }
        mark.parentNode.removeChild(mark);
      }
  }
  refresh() {
    super.refresh();
    this.tempoMap = [{ q: 0, bpm: 120, seconds: 0 }];
    // Tempo belongs to the score: first-part/conductor markings take precedence.
    // Selecting another instrument must not change MP3 synchronization.
    for (const part of [...this.parts].reverse()) {
      let div = 1, q = 0, beats = 4, unit = 4;
      for (const el of kids(part).filter((node) => node.nodeName === "measure")) {
        const at = child(el, "attributes"), time = child(at, "time");
        div = Number(txt(at, "divisions", div));
        if (time) { beats = Number(txt(time, "beats", beats)); unit = Number(txt(time, "beat-type", unit)); }
        const m = { el, div, q };
      let offset = 0;
      for (const node of kids(m.el)) {
        if (node.nodeName === "backup") offset -= Number(txt(node, "duration", 0)) / m.div;
        if (node.nodeName === "forward") offset += Number(txt(node, "duration", 0)) / m.div;
        if (node.nodeName === "note" && !child(node, "chord"))
          offset += Number(txt(node, "duration", 0)) / m.div;
        if (node.nodeName === "direction" || node.nodeName === "sound") {
          const metronome = all(node, "metronome")[0];
          const value = Number(
            (node.nodeName === "sound" ? node.getAttribute("tempo") : null) ||
              all(node, "sound")
                .find((n) => n.hasAttribute("tempo"))
                ?.getAttribute("tempo") ||
              (metronome
                ? Number(txt(metronome, "per-minute", 0)) *
                  (NOTE_VALUES[txt(metronome, "beat-unit", "quarter")] || 1) *
                  (all(metronome, "beat-unit-dot").length ? 1.5 : 1)
                : 0),
          );
          if (value > 0) {
            const q = m.q + offset + Number(txt(node, "offset", 0)) / m.div;
            this.tempoMap.push({ q, bpm: value, seconds: 0 });
          }
        }
      }
        q += beats * 4 / unit;
      }
    }
    this.tempoMap.sort((a, b) => a.q - b.q);
    this.tempoMap = this.tempoMap.filter(
      (s, i, a) => i === a.length - 1 || s.q !== a[i + 1].q,
    );
    for (let i = 1; i < this.tempoMap.length; i++) {
      const a = this.tempoMap[i - 1],
        b = this.tempoMap[i];
      b.seconds = a.seconds + ((b.q - a.q) * 60) / a.bpm;
    }
    this.tempo = this.tempoMap[0].bpm;
  }
  qToSeconds(q) {
    const s = this.tempoMap.findLast((s) => s.q <= q) || this.tempoMap[0];
    return s.seconds + ((q - s.q) * 60) / s.bpm;
  }
  secondsToQ(t) {
    const s = this.tempoMap.findLast((s) => s.seconds <= t) || this.tempoMap[0];
    return s.q + ((t - s.seconds) * s.bpm) / 60;
  }
  // Global bar/meter/tempo changes affect every part or none of them.
  applyToParts(method, args) {
    if (this.parts.length === 1 || this.singlePartOperation) return false;
    const before = this.serialize(), active = this.activePartId;
    this.singlePartOperation = true;
    try {
      for (const { id } of this.partInfos) {
        this.selectPart(id);
        this[method](...args);
      }
    } catch (error) {
      this.doc = new DOMParser().parseFromString(before, "application/xml");
      throw Error(tr`无法对全谱应用此修改（${this.partInfos[this.partIndex].name}）：${error.message}`);
    } finally {
      this.singlePartOperation = false;
      this.activePartId = active;
      this.refresh();
    }
    return true;
  }
  appendMeasure() { this.insertMeasure(this.measures.length); }
  addPart(name, tuning) {
    const pitches = tuning.map(pitchNumber);
    if (![4, 5, 6].includes(pitches.length) || !name.trim())
      throw Error(tr("请输入乐器名称，并选择 4、5 或 6 弦调弦"));
    const idBase = "P", ids = new Set(this.partInfos.map((p) => p.id));
    let number = 1;
    while (ids.has(idBase + number)) number++;
    const id = idBase + number, root = this.doc.documentElement;
    const definition = add(child(root, "part-list"), "score-part");
    definition.setAttribute("id", id);
    add(definition, "part-name", name.trim());
    const part = add(root, "part");
    part.setAttribute("id", id);
    for (const [index, source] of this.measures.entries()) {
      const measure = add(part, "measure");
      measure.setAttribute("number", index + 1);
      const attributes = add(measure, "attributes");
      add(attributes, "divisions", 480);
      const time = add(attributes, "time");
      add(time, "beats", source.beats); add(time, "beat-type", source.unit);
      if (index === 0) {
        const clef = add(attributes, "clef");
        add(clef, "sign", pitches.length === 6 ? "G" : "F");
        add(clef, "line", pitches.length === 6 ? 2 : 4);
        add(clef, "clef-octave-change", -1);
        const details = add(attributes, "staff-details");
        add(details, "staff-lines", pitches.length);
        tuning.forEach((pitch, i) => {
          const match = pitch.match(/^([A-Ga-g])([#b]?)([0-8])$/);
          const tune = add(details, "staff-tuning"); tune.setAttribute("line", i + 1);
          add(tune, "tuning-step", match[1].toUpperCase());
          add(tune, "tuning-alter", match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
          add(tune, "tuning-octave", match[3]);
        });
      }
      for (const rest of restNodes(this.doc, source.length)) measure.appendChild(rest);
    }
    this.activePartId = id;
    this.refresh();
    return id;
  }
  toggleRest(mi, ni) {
    const e = this.event(mi, ni),
      saved = [
        {
          el: e.el,
          tuplets: all(e.el, "tuplet").map((n) => n.cloneNode(true)),
        },
      ];
    if (!e.rest) this.disconnect(e);
    super.toggleRest(mi, ni);
    for (const { el, tuplets } of saved)
      if (tuplets.length && !all(el, "tuplet").length)
        for (const t of tuplets) notations(el).appendChild(t);
    this.refresh();
  }
  removeTone(mi, ni, string) {
    const tone = this.tone(mi, ni, string);
    if (!tone) return;
    this.requireEdit();
    this.disconnect(tone);
    super.removeTone(mi, ni, string);
  }
  split(mi, ni) {
    const e = this.event(mi, ni);
    if (e.grace) throw Error(tr("倚音不占小节时值；可再次添加倚音"));
    if (e.tuplet) throw Error(tr("请先取消三连音组再拆分"));
    if (e.duration < 0.125) throw Error(tr("最小拆分到六十四分音符"));
    const copies = [0, 1].flatMap(() =>
      copyBeat(e, (c) => setDurationNode(c, e.duration / 2)),
    );
    this.replaceSpan(mi, ni, e.duration, copies, e.duration);
  }
  marks(mi, ni, string = null) {
    const beat = this.event(mi, ni),
      tone = this.tone(mi, ni, string);
    if (!tone)
      return {
        tags: new Set(),
        dynamic:
          kids(child(child(beat.el, "notations"), "dynamics"))[0]?.nodeName ||
          "",
        bend: 2,
      };
    const n = tone.el,
      no = child(n, "notations"),
      te = child(no, "technical"),
      head = child(n, "notehead");
    const tags = new Set(
      all(no, "articulations")
        .flatMap(kids)
        .map((n) => n.nodeName),
    );
    for (const t of ["slur", "slide", "hammer-on", "pull-off"])
      if (all(n, t).some((x) => x.getAttribute("type") === "start"))
        tags.add(t);
    for (const t of ["bend", "harmonic", "tap", "smear", "up-bow", "down-bow"])
      if (all(n, t).length) tags.add(t);
    for (const t of [
      "trill-mark",
      "turn",
      "inverted-turn",
      "mordent",
      "inverted-mordent",
      "tremolo",
    ])
      if (all(n, t).length) tags.add(t);
    if (all(n, "fermata").length) tags.add("fermata");
    if (txt(child(n, "play"), "mute") === "palm") tags.add("palm");
    if (all(n, "tied").some((x) => x.getAttribute("type") === "let-ring"))
      tags.add("let-ring");
    if (head?.getAttribute("parentheses") === "yes") tags.add("ghost");
    for (const tag of all(te, "other-technical")) tags.add(tag.textContent);
    return {
      tags,
      dynamic:
        kids(child(child(beat.el, "notations"), "dynamics"))[0]?.nodeName || "",
      bend: Number(txt(all(te, "bend")[0], "bend-alter", 2)),
    };
  }
  // Replace a time span without changing the measure's total duration.
  replaceSpan(mi, ni, oldSpan, newNodes, newSpan, mode = "replace") {
    this.requireEdit();
    this.normalizeDivisions();
    const m = this.measures[mi],
      start = m.notes[ni];
    const span = Math.max(oldSpan, newSpan);
    if (start.q - m.q + span > m.length + 1e-6)
      throw Error(tr("时值超出本小节，请先插入小节或选择较短时值"));
    let covered = 0;
    const consumed = [];
    for (let i = ni; i < m.notes.length && covered < span - 1e-6; i++) {
      const n = m.notes[i];
      if (mode === "protect" && covered >= oldSpan - 1e-6 && !n.rest)
        throw Error(tr("保护模式不会覆盖后续音符；可切换为替换模式"));
      consumed.push(n);
      covered += n.duration;
    }
    if (covered < span - 1e-6) throw Error(tr("小节内时值不足"));
    const remaining = restNodes(this.doc, covered - newSpan);
    // Sever connections touching replaced notes, including the outside endpoint.
    for (const n of consumed) this.disconnect(n);
    const before = consumed.at(-1).tones.at(-1).el.nextSibling;
    for (const n of consumed.flatMap((b) => b.tones)) m.el.removeChild(n.el);
    for (const n of [...newNodes, ...remaining]) m.el.insertBefore(n, before);
    this.refresh();
  }
  disconnect(event) {
    if (event.tones) {
      for (const t of event.tones) this.disconnect(t);
      return;
    }
    this.disconnectTies(event);
    const tones = this.notes.flatMap((b) => b.tones);
    for (const tag of ["slur", "slide", "glissando", "hammer-on", "pull-off"])
      for (const marker of all(event.el, tag)) {
        const type = marker.getAttribute("type"),
          number = marker.getAttribute("number") || "1";
        const candidates =
          type === "start"
            ? tones.slice(tones.findIndex((n) => n.el === event.el) + 1)
            : tones.slice(0, tones.findIndex((n) => n.el === event.el)).reverse();
        for (const e of candidates) {
          const match = all(e.el, tag).find(
            (x) =>
              (x.getAttribute("number") || "1") === number &&
              (x.getAttribute("type") !== "start") === (type === "start"),
          );
          if (match) {
            match.parentNode.removeChild(match);
            break;
          }
        }
      }
    clearConnections(event.el);
  }
  editDuration(mi, ni, type, dots = 0, mode = "replace") {
    const e = this.event(mi, ni);
    if (e.grace) {
      this.requireEdit();
      for (const tone of e.tones) { writeRhythm(tone.el, type, dots); remove(tone.el, "duration"); }
      this.refresh();
      return;
    }
    if (e.tuplet) throw Error(tr("三连音内部请先取消三连音，再修改时值"));
    let q;
    const copies = copyBeat(e, (n) => {
      removeTuplet(n);
      q = writeRhythm(n, type, dots);
    });
    this.replaceSpan(mi, ni, e.duration, copies, q, mode);
  }
  toggleDots(mi, ni, mode = "replace") {
    const e = this.event(mi, ni);
    this.editDuration(mi, ni, e.type, (e.dots + 1) % 3, mode);
  }
  triplet(mi, ni, mode = "replace") {
    this.requireEdit();
    if (this.event(mi, ni).grace) throw Error(tr("倚音不占小节时值；可再次添加倚音"));
    this.normalizeDivisions();
    const e = this.event(mi, ni);
    if (e.tuplet) {
      const notes = this.measures[mi].notes;
      let begin = ni;
      while (
        begin > 0 &&
        notes[begin - 1].tuplet &&
        !all(notes[begin].el, "tuplet").some(
          (x) => x.getAttribute("type") === "start",
        )
      )
        begin--;
      const group = notes.slice(begin, begin + e.actualNotes);
      if (group.length !== 3 || group.some((n) => !n.tuplet))
        throw Error(tr("当前只支持取消完整的三连音组"));
      const copies = group.flatMap((n) =>
        copyBeat(n, (c) => {
          removeTuplet(c);
          writeRhythm(c, n.type, n.dots);
        }),
      );
      this.replaceSpan(
        mi,
        begin,
        group.reduce((s, n) => s + n.duration, 0),
        copies,
        group.reduce((s, n) => s + NOTE_VALUES[n.type] * (2 - 2 ** -n.dots), 0),
        mode,
      );
      return begin;
    }
    const type = Object.keys(NOTE_VALUES).find(
      (t) => Math.abs(NOTE_VALUES[t] - e.duration / 2) < 1e-6,
    );
    if (!type || e.dots)
      throw Error(tr("请先选择不带附点的音符；将其拆成占用相同时长的三个音"));
    const copies = [0, 1, 2].flatMap((i) =>
      copyBeat(e, (n, toneIndex) => {
        removeTuplet(n);
        writeRhythm(n, type, 0, 3, 2);
        if (i !== 1 && toneIndex === 0) {
          const mark = add(notations(n), "tuplet");
          mark.setAttribute("type", i === 0 ? "start" : "stop");
          mark.setAttribute("number", "1");
        }
      }),
    );
    this.replaceSpan(mi, ni, e.duration, copies, e.duration, mode);
    return ni;
  }
  pair(mi, ni, tag, endIndex = null, string = null) {
    this.requireEdit();
    const e = this.requireTone(mi, ni, string),
      index = this.notes.indexOf(this.event(mi, ni)),
      nextBeat = this.notes[endIndex ?? index + 1],
      next =
        nextBeat?.tones.find((t) => t.string === e.string) ||
        (tag === "slur" ? nextBeat?.tones[0] : null);
    if (!next || (endIndex ?? index + 1) <= index || e.rest || next.rest)
      throw Error(tr("请选两个先后相邻的音符，或用 Shift 选择终点"));
    if (
      ["hammer-on", "pull-off", "slide"].includes(tag) &&
      e.string !== next.string
    )
      throw Error(tr("击勾与滑音需要同一根弦上的两个音符"));
    if (tag === "hammer-on" && next.fret <= e.fret)
      throw Error(tr("击弦终点品位应高于起点"));
    if (tag === "pull-off" && next.fret >= e.fret)
      throw Error(tr("勾弦终点品位应低于起点"));
    const tech = ["hammer-on", "pull-off"].includes(tag),
      origin = tech ? technical(e.el) : notations(e.el),
      destination = tech ? technical(next.el) : notations(next.el);
    const existing = all(e.el, tag).find(
      (n) => n.getAttribute("type") === "start",
    );
    if (existing) {
      const number = existing.getAttribute("number") || "1";
      existing.parentNode.removeChild(existing);
      for (const n of this.notes.slice(index + 1).flatMap((b) => b.tones)) {
        const stop = all(n.el, tag).find(
          (x) =>
            x.getAttribute("type") === "stop" &&
            (x.getAttribute("number") || "1") === number,
        );
        if (stop) {
          stop.parentNode.removeChild(stop);
          break;
        }
      }
    } else {
      if (tag === "slide") {
        for (const name of ["doit", "falloff"]) remove(child(child(e.el, "notations"), "articulations"), name);
        for (const name of ["scoop", "plop"]) remove(child(child(next.el, "notations"), "articulations"), name);
      }
      const used = new Set(
        all(this.part, tag).map((x) => x.getAttribute("number")),
      );
      let number = 1;
      while (used.has(String(number))) number++;
      for (const [parent, type] of [
        [origin, "start"],
        [destination, "stop"],
      ]) {
        const mark = add(
          parent,
          tag,
          tech ? (tag === "hammer-on" ? "H" : "P") : undefined,
        );
        mark.setAttribute("type", type);
        mark.setAttribute("number", number);
      }
    }
    this.refresh();
  }
  toggleMark(mi, ni, tag, string = null) {
    this.requireEdit();
    const e =
        this.event(mi, ni).rest &&
        ["fermata", "breath-mark", "caesura"].includes(tag)
          ? this.event(mi, ni)
          : this.requireTone(mi, ni, string),
      n = e.el;
    if (e.rest && !["fermata", "breath-mark", "caesura"].includes(tag))
      throw Error(tr("请先在 TAB 上写入一个音符"));
    if (tag === "ghost") {
      let h = child(n, "notehead");
      if (h?.getAttribute("parentheses") === "yes") {
        h.removeAttribute("parentheses");
      } else {
        h = h || add(n, "notehead", "normal");
        h.setAttribute("parentheses", "yes");
      }
    } else if (tag === "palm") {
      const p = ensure(n, "play");
      if (txt(p, "mute") === "palm") remove(p, "mute");
      else set(p, "mute", "palm");
    } else if (tag === "let-ring") {
      const p = notations(n),
        old = kids(p).find(
          (x) => x.nodeName === "tied" && x.getAttribute("type") === "let-ring",
        );
      if (old) p.removeChild(old);
      else add(p, "tied").setAttribute("type", "let-ring");
    } else if (["slap", "pop"].includes(tag)) {
      const p = technical(n),
        old = kids(p).find(
          (x) => x.nodeName === "other-technical" && x.textContent === tag,
        );
      if (old) p.removeChild(old);
      else add(p, "other-technical", tag);
    } else {
      const articulation = [
        "staccato",
        "staccatissimo",
        "tenuto",
        "detached-legato",
        "accent",
        "strong-accent",
        "breath-mark",
        "caesura",
      ].includes(tag);
      const ornament = [
        "trill-mark",
        "turn",
        "inverted-turn",
        "mordent",
        "inverted-mordent",
        "tremolo",
      ].includes(tag);
      const p = articulation
        ? ensure(notations(n), "articulations")
        : ornament
          ? ensure(notations(n), "ornaments")
          : tag === "fermata"
            ? notations(n)
            : technical(n);
      if (child(p, tag)) remove(p, tag);
      else {
        const mark = add(
          p,
          tag,
          tag === "fermata" ? "normal" : tag === "tremolo" ? "3" : undefined,
        );
        if (tag === "harmonic") add(mark, "natural");
        if (tag === "tremolo") mark.setAttribute("type", "single");
      }
    }
    this.refresh();
  }
  setBend(mi, ni, amount = 2, kind = "bend", string = null) {
    this.requireEdit();
    const e = this.requireTone(mi, ni, string);
    if (e.rest) throw Error(tr("休止符不能推弦"));
    if (![0.5, 1, 2, 3, 4].includes(amount)) throw Error(tr("请选择推弦音程"));
    const t = technical(e.el);
    remove(t, "bend");
    if (kind !== "none") {
      const b = add(t, "bend");
      add(b, "bend-alter", amount);
      if (kind === "prebend") add(b, "pre-bend");
      if (kind === "release") add(b, "release");
      if (kind === "bend-release") {
        const r = add(t, "bend");
        add(r, "bend-alter", amount);
        add(r, "release");
      }
    }
    this.refresh();
  }
  setDynamic(mi, ni, value) {
    this.requireEdit();
    const no = notations(this.event(mi, ni).el);
    remove(no, "dynamics");
    if (value) {
      if (
        ![
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
        ].includes(value)
      )
        throw Error(tr("无效力度"));
      add(add(no, "dynamics"), value);
    }
    this.refresh();
  }
  setText(mi, ni, text) {
    this.requireEdit();
    const e = this.event(mi, ni);
    let previous = e.el.previousSibling;
    while (previous && previous.nodeType !== 1)
      previous = previous.previousSibling;
    if (
      previous?.nodeName === "direction" &&
      previous.getAttribute("id") === "localtab-text"
    )
      previous.parentNode.removeChild(previous);
    if (text.trim()) {
      const d = this.doc.createElement("direction");
      d.setAttribute("placement", "above");
      d.setAttribute("id", "localtab-text");
      add(add(d, "direction-type"), "words", text.trim().slice(0, 200));
      e.el.parentNode.insertBefore(d, e.el);
    }
    this.refresh();
  }
  hairpin(mi, ni, type, endIndex = null) {
    this.requireEdit();
    const e = this.event(mi, ni),
      idx = this.notes.indexOf(e),
      next = this.notes[endIndex ?? idx + 1];
    if (!next || next.q <= e.q) throw Error(tr("渐强/渐弱需要起点和终点"));
    const used = all(this.part, "wedge").map((x) =>
      Number(x.getAttribute("number") || 1),
    );
    const num = Math.max(0, ...used) + 1;
    for (const [event, kind] of [
      [e, type],
      [next, "stop"],
    ]) {
      const d = this.doc.createElement("direction");
      d.setAttribute("placement", "below");
      const w = add(add(d, "direction-type"), "wedge");
      w.setAttribute("type", kind);
      w.setAttribute("number", num);
      event.el.parentNode.insertBefore(d, event.el);
    }
    this.refresh();
  }
  setTempo(mi, bpm) {
    if (this.applyToParts("setTempo", [mi, bpm])) return;
    this.requireEdit();
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)
      throw Error(tr("速度范围为 20–300 BPM"));
    const m = this.measures[mi];
    for (const sound of kids(m.el).filter(
      (x) => x.nodeName === "sound" && x.hasAttribute("tempo"),
    ))
      sound.removeAttribute("tempo");
    for (const d of kids(m.el).filter(
      (x) => x.nodeName === "direction" && all(x, "metronome").length,
    ))
      m.el.removeChild(d);
    const d = this.doc.createElement("direction"),
      metro = add(add(d, "direction-type"), "metronome");
    add(metro, "beat-unit", "quarter");
    add(metro, "per-minute", bpm);
    add(d, "sound").setAttribute("tempo", bpm);
    const first = m.notes[0]?.el;
    m.el.insertBefore(d, first || null);
    this.refresh();
  }
  insertMeasure(index) {
    if (this.applyToParts("insertMeasure", [index])) return;
    this.requireEdit();
    this.normalizeDivisions();
    const reference = this.measures[Math.min(index, this.measures.length - 1)];
    const m = this.doc.createElement("measure");
    if (index === 0) {
      const original = child(reference.el, "attributes");
      if (original) m.appendChild(original.cloneNode(true));
    }
    const at = child(m, "attributes") || add(m, "attributes");
    set(at, "divisions", 480);
    const time = ensure(at, "time");
    set(time, "beats", reference.beats);
    set(time, "beat-type", reference.unit);
    for (const r of restNodes(this.doc, reference.length)) m.appendChild(r);
    this.part.insertBefore(m, this.measures[index]?.el || null);
    this.renumber();
    this.refresh();
  }
  removeMeasure(index) {
    if (this.applyToParts("removeMeasure", [index])) return;
    this.requireEdit();
    if (this.measures.length <= 1) throw Error(tr("至少保留一个小节"));
    const m = this.measures[index],
      next = this.measures[index + 1];
    for (const n of m.notes) this.disconnect(n);
    const attributes = child(m.el, "attributes");
    if (attributes && next) {
      let at = child(next.el, "attributes");
      if (!at) {
        at = this.doc.createElement("attributes");
        next.el.insertBefore(at, next.el.firstChild);
      }
      for (const a of kids(attributes))
        if (!child(at, a.nodeName)) at.appendChild(a.cloneNode(true));
    }
    this.part.removeChild(m.el);
    this.renumber();
    this.refresh();
  }
  renumber() {
    kids(this.part)
      .filter((n) => n.nodeName === "measure")
      .forEach((m, i) => m.setAttribute("number", i + 1));
  }
  setTimeSignature(mi, beats, unit, scope = "current", trim = false) {
    if (this.applyToParts("setTimeSignature", [mi, beats, unit, scope, trim])) return;
    this.requireEdit();
    if (
      !Number.isInteger(beats) ||
      beats < 1 ||
      beats > 32 ||
      ![1, 2, 4, 8, 16].includes(unit)
    )
      throw Error(tr("拍号分子 1–32，分母 1/2/4/8/16"));
    this.normalizeDivisions();
    const old = this.measures[mi],
      next = this.measures[mi + 1],
      length = (beats * 4) / unit,
      targets = [old];
    if (scope === "following")
      for (let i = mi + 1; i < this.measures.length; i++) {
        if (child(child(this.measures[i].el, "attributes"), "time")) break;
        targets.push(this.measures[i]);
      }
    for (const m of targets) {
      if (length > m.actualLength) {
        for (const r of restNodes(this.doc, length - m.actualLength))
          m.el.insertBefore(r, child(m.el, "barline") || null);
      } else if (length < m.actualLength) {
        const affected = m.notes.filter(
          (e) => e.q - m.q + e.duration > length + 1e-6 || (e.grace && e.q - m.q >= length - 1e-6),
        );
        if (!trim && affected.some((e) => !e.rest))
          throw Error(tr("缩短拍号会截去音符；勾选“截去超出内容”或先整理小节"));
        for (const e of affected) {
          const keep = Math.max(0, length - (e.q - m.q));
          if (e.tuplet) throw Error(tr("新拍号会截断三连音组，请先调整该组"));
          const chunks = restNodes(this.doc, keep);
          this.disconnect(e);
          for (const r of chunks) {
            if (!e.rest) {
              for (const c of copyBeat(e, (c) => {
                set(c, "duration", txt(r, "duration"));
                set(c, "type", txt(r, "type"));
                remove(c, "dot");
                for (const dot of all(r, "dot")) add(c, "dot");
              }))
                m.el.insertBefore(c, e.el);
            } else m.el.insertBefore(r, e.el);
          }
          for (const t of e.tones) m.el.removeChild(t.el);
        }
      }
    }
    const at =
      child(old.el, "attributes") ||
      old.el.insertBefore(
        this.doc.createElement("attributes"),
        old.el.firstChild,
      );
    let time = child(at, "time");
    if (!time) {
      time = this.doc.createElement("time");
      at.insertBefore(
        time,
        child(at, "clef") || child(at, "staff-details") || null,
      );
    }
    set(time, "beats", beats);
    set(time, "beat-type", unit);
    if (
      scope === "current" &&
      next &&
      !child(child(next.el, "attributes"), "time")
    ) {
      const a =
        child(next.el, "attributes") ||
        next.el.insertBefore(
          this.doc.createElement("attributes"),
          next.el.firstChild,
        );
      const t = add(a, "time");
      add(t, "beats", next.beats);
      add(t, "beat-type", next.unit);
    }
    this.refresh();
  }
}

export function applyDisplaySettings(score, model) {
  score.stylesheet.tabConfig.rests = { isVisible: true, staffPlacement: 0 };
  score.stylesheet.tabConfig.timeSignature = {
    isVisible: true,
    staffPlacement: 0,
  };
  for (const track of score.tracks)
    for (const staff of track.staves) {
      staff.showStandardNotation = true;
      staff.showTablature = !staff.isPercussion && staff.tuning.length > 0;
    }
  // Standard MusicXML other-technical retains these labels in exported files.
  const activePart = model.activePartId;
  for (const part of model.partInfos) {
    model.selectPart(part.id);
    if (!model.editable) continue;
    for (const e of model.notes) {
    const beat = score.tracks[part.index]?.staves[0]?.bars[e.mi]?.voices[0]?.beats[e.ni];
    if (!beat) continue;
    // The importer otherwise normalizes all grace display values to an eighth.
    if (e.grace) { beat.duration = 4 / NOTE_VALUES[e.type]; beat.dots = e.dots; }
    const marks = e.tones.map((t) => model.marks(e.mi, e.ni, t.string).tags);
    beat.slap = marks.some((tags) => tags.has("slap"));
    beat.pop = marks.some((tags) => tags.has("pop"));
    // alphaTab's MusicXML importer ignores these standard articulations.
    // Map to its native guitar slide glyphs for both editor and PDF rendering.
    for (const tone of e.tones) {
      const note = beat.notes.find((n) => n.string === model.tuning.length - tone.string + 1);
      if (!note) continue;
      const tags = model.marks(e.mi, e.ni, tone.string).tags;
      if (tags.has("scoop")) note.slideInType = 1;
      else if (tags.has("plop")) note.slideInType = 2;
      if (tags.has("doit")) note.slideOutType = 3;
      else if (tags.has("falloff")) note.slideOutType = 4;
    }
    }
  }
  model.selectPart(activePart);
}
export function remapAnchors(anchors, previous, current, oldTotal, newTotal) {
  const byElement = new Map(current.map((m) => [m.el, m]));
  return validateAnchors(
    anchors.flatMap((a) => {
      if (Math.abs(a.q - oldTotal) < 1e-6) return [{ ...a, q: newTotal }];
      const old = previous.findLast((m) => m.q <= a.q),
        next = old && byElement.get(old.el);
      if (!next) return [];
      const offset = a.q - old.q;
      if (offset >= next.length) return [];
      return [{ ...a, q: next.q + offset }];
    }),
  );
}
