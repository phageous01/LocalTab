import { PRESETS, pitchName, validateAnchors } from "./model.js";
import {
  ScoreDocument,
  applyDisplaySettings,
  remapAnchors,
  playbackEvents,
} from "./editor-model.js";
import { createToolbar } from "./toolbar.js";
import {
  RecordingTimeMap,
  SyncDraft,
  SYNC_ALGORITHM,
  formatTimestamp,
  parseTimestamp,
  locationToQ,
  qToLocation,
} from "./sync.js";
const $ = (id) => document.getElementById(id);
let token = "",
  projectId = "",
  revision = "",
  project,
  model,
  api,
  renderedScore,
  mi = 0,
  ni = 0,
  systemStart = 1;
let seq = 0,
  savedSeq = 0,
  saveTimer,
  savingPromise = null,
  undoStack = [],
  redoStack = [],
  renderTimer,
  toastTimer;
let recordingId = "synth",
  playing = false,
  cursorQ = 0,
  rate = 1,
  audioContext,
  synthTimer,
  synthEpoch = 0,
  synthQ = 0,
  synthIndex = 0,
  synthEvents = [],
  synthNodes = [];
let peaks = [],
  dragAnchor = -1,
  dragPreview = null,
  waveEpoch = 0,
  keyDigits = "",
  keyTime = 0;
const audio = $("audio");
let toolbar,
  selectedString = 1,
  rangeStart = null,
  pointerInfo = null,
  followedBar = -1,
  followScrollLeft = null,
  syncDraft = null,
  syncCache = null,
  dragStartX = 0,
  dragMoved = false,
  audioImportBusy = false;
const horizontalLayout = () => $("scoreLayout").value === "horizontal";
function focusEditor() {
  $("scoreViewport").focus({ preventScroll: true });
  $("tabFocusState").textContent = "TAB 键盘编辑已启用";
  $("editToolbar").classList.add("keyboard-active");
}
function pairShortcut(tag) {
  const i = model.notes.indexOf(model.event(mi, ni)),
    begin = Math.min(rangeStart ?? i, i),
    end = rangeStart == null ? null : Math.max(rangeStart, i),
    a = model.notes[begin];
  model.pair(a.mi, a.ni, tag, end, selectedString);
}
const recording = () => project?.recordings.find((r) => r.id === recordingId);
const clone = (x) => JSON.parse(JSON.stringify(x));
const clampQ = (q) => Math.max(0, Math.min(model.totalQ, q));
function recordingMap() {
  const r = recording();
  if (
    !syncCache ||
    syncCache.recording !== r ||
    syncCache.anchors !== r?.anchors ||
    syncCache.tempoMap !== model.tempoMap
  ) {
    syncCache = {
      recording: r,
      anchors: r?.anchors,
      tempoMap: model.tempoMap,
      map: new RecordingTimeMap(model, r?.anchors || []),
    };
  }
  return syncCache.map;
}
function alignAudioCursor() {
  if (!recording()) return;
  cursorQ = clampQ(recordingMap().toQ(audio.currentTime));
  selectAtQ(cursorQ);
  drawWave();
}
function mutateSync(fn, allowDraft = false) {
  const changed = mutate(
    () => {
      fn();
      recording().syncAlgorithm = SYNC_ALGORITHM;
    },
    { render: false, sync: allowDraft },
  );
  if (changed) alignAudioCursor();
  return changed;
}
function toast(text, error = false) {
  $("toast").textContent = text;
  $("toast").style.background = error ? "#83483d" : "#203b3af2";
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 6500 : 3200,
  );
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Local-Token": token,
      ...options.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `请求失败 ${r.status}`);
  return data;
}
function fmt(t, ms = false) {
  t = Math.max(0, t || 0);
  return `${Math.floor(t / 60)}:${(ms ? (t % 60).toFixed(3) : String(Math.floor(t % 60))).padStart(ms ? 6 : 2, "0")}`;
}
function saveStatus(text, failed = false) {
  $("saveState").textContent = text;
  $("saveState").style.color = failed ? "#b04c3f" : "";
}
function dirty() {
  seq++;
  saveStatus("待保存…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => flushSave().catch((e) => toast(e.message, true)),
    700,
  );
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (savingPromise) {
    await savingPromise;
    return flushSave();
  }
  if (savedSeq === seq || !model) return;
  const captureSeq = seq,
    id = projectId,
    xml = model.serialize(),
    config = clone(project);
  saveStatus("保存中…");
  savingPromise = request(`/api/project/${id}`, {
    method: "PUT",
    body: JSON.stringify({ xml, project: config, revision }),
  })
    .then((r) => {
      if (projectId === id) {
        revision = r.revision;
        savedSeq = captureSeq;
        saveStatus(savedSeq === seq ? "已保存到本机" : "待保存…");
      }
    })
    .catch((e) => {
      saveStatus("保存失败 · 请导出备份", true);
      throw e;
    })
    .finally(() => (savingPromise = null));
  await savingPromise;
  if (savedSeq !== seq) return flushSave();
}
function snapshot() {
  return {
    xml: model.serialize(),
    project: clone(project),
    mi,
    ni,
    selectedString,
    rangeStart,
    recordingId,
  };
}
function mutate(fn, { render = true, sync = false } = {}) {
  if (!model) return;
  if (syncDraft && !sync) {
    toast("请先保存或取消当前同步点，再修改乐谱或其他同步点。");
    return false;
  }
  pause();
  const before = snapshot();
  try {
    fn();
    undoStack.push(before);
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    model.refresh();
    mi = Math.min(mi, model.measures.length - 1);
    ni = Math.min(ni, model.measures[mi].notes.length - 1);
    dirty();
    updateUI();
    if (render) renderScore();
    else drawWave();
    return true;
  } catch (e) {
    model = new ScoreDocument(before.xml);
    project = before.project;
    mi = before.mi;
    ni = before.ni;
    selectedString = before.selectedString;
    rangeStart = before.rangeStart;
    toast(e.message, true);
    updateUI();
    return false;
  }
}
function history(back) {
  if (syncDraft) {
    toast("请先保存或取消当前同步点，再撤销。");
    return;
  }
  const src = back ? undoStack : redoStack,
    dst = back ? redoStack : undoStack;
  if (!src.length) return;
  pause();
  const oldAnchors = JSON.stringify(recording()?.anchors);
  dst.push(snapshot());
  const s = src.pop();
  model = new ScoreDocument(s.xml);
  project = s.project;
  mi = s.mi;
  ni = s.ni;
  selectedString = s.selectedString ?? 1;
  rangeStart = s.rangeStart ?? null;
  dirty();
  updateUI();
  renderScore();
  if (recordingId !== "synth" && !recording()) {
    switchRecording(
      s.recordingId || project.recordings[0]?.id || "synth",
      cursorQ,
    ).catch((e) => toast(e.message, true));
  } else if (oldAnchors !== JSON.stringify(recording()?.anchors))
    alignAudioCursor();
}
async function listProjects() {
  const items = await request("/api/projects");
  $("projectSelect").replaceChildren(
    ...items.map((p) => new Option(p.title, p.id)),
  );
  if (projectId) $("projectSelect").value = projectId;
  return items;
}
async function loadProject(id) {
  await flushSave();
  pause();
  const data = await request(`/api/project/${id}`);
  projectId = id;
  revision = data.revision;
  project = data.project;
  for (const r of project.recordings) r.anchors ??= [];
  model = new ScoreDocument(data.xml);
  mi = 0;
  ni = 0;
  selectedString = model.event(0, 0).rest
    ? model.tuning.length
    : model.event(0, 0).string;
  rangeStart = null;
  cursorQ = 0;
  followedBar = -1;
  followScrollLeft = null;
  $("scoreViewport").scrollTo({ left: 0, top: 0, behavior: "instant" });
  seq = 0;
  savedSeq = 0;
  undoStack = [];
  redoStack = [];
  saveStatus("已保存到本机");
  document.title = project.title + " · Local Tab Studio";
  $("projectSelect").value = id;
  updateUI();
  await switchRecording(project.recordings[0]?.id || "synth", 0);
  renderScore();
  if (!model.editable)
    toast(
      "此谱含复杂结构，当前版本提供查看及原样导出；请使用单声部 TAB 进行编辑。",
      true,
    );
}
function updateUI() {
  if (!model) return;
  $("scoreTitle").textContent = project.title;
  $("scoreMeta").textContent =
    `${model.tuning.length} 弦 · ${model.measures.length} 小节 · ${model.measures[0].beats}/${model.measures[0].unit} · ♩ = ${model.tempo}`;
  $("barCount").textContent = model.measures.length;
  $("tuning").value = model.tuning.map(pitchName).join(" ");
  $("preset").value =
    model.tuning.length === 6
      ? "guitar6"
      : model.tuning.length === 4
        ? "bass4"
        : "bass5";
  $("barNav").replaceChildren(
    ...model.measures.map((m, i) => {
      const b = document.createElement("button");
      b.textContent = i + 1;
      b.title = `第 ${i + 1} 小节`;
      b.className =
        i === mi
          ? "current"
          : i >= systemStart - 1 && i < systemStart + 3
            ? "in-view"
            : "";
      b.onclick = () => select(i, 0, true);
      return b;
    }),
  );
  $("recording").replaceChildren(
    new Option("合成音（预览）", "synth"),
    ...project.recordings.map((r) => new Option(r.name, r.id)),
  );
  $("recording").value = recordingId;
  $("copyFrom").replaceChildren(
    ...project.recordings
      .filter((r) => r.id !== recordingId)
      .map((r) => new Option(r.name, r.id)),
  );
  $("noteString").replaceChildren(
    ...[...model.tuning]
      .reverse()
      .map((pitch, i) => new Option(`${i + 1}弦 · ${pitchName(pitch)}`, i + 1)),
  );
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  for (const id of [
    "applyTuning",
    "addBar",
    "applyNote",
    "setDuration",
    "splitNote",
    "restNote",
    "deadNote",
    "tieNote",
  ])
    $(id).disabled = !model.editable;
  updateSelection();
  updateSync();
}
function updateSelection() {
  const m = model.measures[mi],
    e = m.notes[ni];
  if (!e) return;
  const tone = model.tone(mi, ni, selectedString);
  $("measureLabel").textContent = `第 ${mi + 1} 小节`;
  $("measureCheck").textContent =
    `${Number(m.actualLength.toFixed(3))} / ${m.length} 拍`;
  $("selectionLabel").textContent =
    `第 ${mi + 1} 小节 · 第 ${ni + 1} 音位${e.tones.length > 1 ? ` · ${e.tones.length} 音和弦` : ""}${e.rest ? " · 休止符" : tone ? ` · ${tone.string}弦 ${tone.dead ? "X" : tone.fret + "品"} · ${pitchName(tone.midi)}` : ` · ${selectedString}弦未填音，输入数字添加`}`;
  $("noteStrip").replaceChildren(
    ...m.notes.map((n, i) => {
      const b = document.createElement("button");
      b.className = i === ni ? "selected" : "";
      b.setAttribute(
        "aria-label",
        `第 ${i + 1} 音位 ${n.rest ? "休止符" : n.tones.map((t) => `${t.string}弦${t.fret}品`).join("、")}`,
      );
      const s = document.createElement("small");
      s.textContent = `${Number(n.duration.toFixed(3))} 拍${n.tieStop ? " ⌒" : ""}`;
      b.append(
        document.createTextNode(
          n.rest
            ? "休止"
            : n.tones
                .map((t) => `${t.string}弦·${t.dead ? "X" : t.fret}`)
                .join(" / "),
        ),
        s,
      );
      b.onclick = (event) => select(mi, i, true, event.shiftKey);
      return b;
    }),
  );
  $("noteString").value = e.string;
  selectedString = Math.max(1, Math.min(selectedString, model.tuning.length));
  $("noteString").value = selectedString;
  $("noteFret").value = tone?.fret ?? 0;
  $("noteDuration").value = String(e.duration);
  $("deadNote").classList.toggle("active", !!tone?.dead);
  $("tieNote").classList.toggle("active", !!tone?.tieStart);
  $("restNote").classList.toggle("active", e.rest);
  for (const [i, b] of [...$("barNav").children].entries())
    b.className =
      i === mi
        ? "current"
        : i >= systemStart - 1 && i < systemStart + 3
          ? "in-view"
          : "";
  $("systemLabel").textContent = horizontalLayout()
    ? `第 ${mi + 1} / ${model.measures.length} 小节`
    : `${systemStart} — ${Math.min(systemStart + 3, model.measures.length)}`;
  $("prevSystem").disabled = horizontalLayout() ? mi === 0 : systemStart === 1;
  $("nextSystem").disabled = horizontalLayout()
    ? mi === model.measures.length - 1
    : systemStart + 3 >= model.measures.length;
  $("prevSystem").setAttribute(
    "aria-label",
    horizontalLayout() ? "上一小节" : "上一组小节",
  );
  $("nextSystem").setAttribute(
    "aria-label",
    horizontalLayout() ? "下一小节" : "下一组小节",
  );
  moveCursor();
  toolbar?.refresh();
}
function select(measure, note, seek = false, extend = false) {
  if (!model.measures[measure]) return;
  if (syncDraft && seek && !$("syncBeatDetails").open) note = 0;
  if (extend) {
    if (rangeStart == null)
      rangeStart = model.notes.indexOf(model.event(mi, ni));
  } else rangeStart = null;
  keyDigits = "";
  keyTime = 0;
  mi = measure;
  ni = Math.min(note, model.measures[mi].notes.length - 1);
  const event = model.event(mi, ni);
  selectedString = Math.max(1, Math.min(selectedString, model.tuning.length));
  const start = horizontalLayout() ? mi + 1 : Math.floor(mi / 4) * 4 + 1;
  systemStart = start;
  updateSelection();
  revealSelection(playing && !seek);
  if (seek) {
    if (syncDraft) {
      syncDraft.selectLocation(
        model,
        mi + 1,
        $("syncBeatDetails").open
          ? 1 + model.event(mi, ni).q - model.measures[mi].q
          : 1,
      );
      fillSyncLocation();
      return;
    }
    seekQ(model.event(mi, ni).q);
    focusEditor();
  }
}
function selectAtQ(q) {
  q = Math.max(0, Math.min(q, model.totalQ - 0.00001));
  let m = model.measures.findLast((m) => m.q <= q) || model.measures[0];
  let i = m.notes.findLastIndex((n) => n.q <= q + 0.00001);
  if (playing && !m.notes[Math.max(0, i)]?.rest)
    selectedString = m.notes[Math.max(0, i)].string;
  if (m.index !== mi || i !== ni) select(m.index, Math.max(0, i), false);
  else moveCursor();
}
function renderScore() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    try {
      systemStart = horizontalLayout() ? mi + 1 : Math.floor(mi / 4) * 4 + 1;
      // Render the whole score: alphaTab 1.9 can fail on ties that start
      // outside a cropped bar range. Scroll the full layout instead of cropping.
      renderedScore = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
        new TextEncoder().encode(model.serialize()),
        api.settings,
      );
      applyDisplaySettings(renderedScore, model);
      if (horizontalLayout())
        renderedScore.stylesheet.scoreConfig.barNumber =
          alphaTab.model.BarNumberDisplay.AllBars;
      api.renderScore(renderedScore, [0]);
      updateSelection();
    } catch (e) {
      toast("排版失败：" + e.message, true);
    }
  }, 70);
}
function moveCursor() {
  if (!renderedScore || !api?.boundsLookup) return;
  const beat =
    renderedScore.tracks[0]?.staves[0]?.bars[mi]?.voices[0]?.beats[ni];
  if (!beat) return;
  const layout = tabLayout(beat),
    b = layout?.bounds;
  if (!b) {
    $("scoreCursor").hidden = true;
    return;
  }
  const area = b.barBounds.masterBarBounds.visualBounds,
    canvas = api.canvasElement.element.getBoundingClientRect(),
    viewport = $("scoreViewport").getBoundingClientRect();
  const el = $("scoreCursor");
  el.hidden = false;
  el.style.left = `${canvas.left - viewport.left + $("scoreViewport").scrollLeft + b.onNotesX - 3}px`;
  el.style.top = `${canvas.top - viewport.top + $("scoreViewport").scrollTop + layout.top + (selectedString - 1) * layout.gap - 9}px`;
  el.style.height = "19px";
  el.style.width = "23px";
  el.setAttribute("aria-label", `第 ${selectedString} 弦输入位置`);
  return {
    barLeft:
      canvas.left - viewport.left + $("scoreViewport").scrollLeft + area.x,
    noteLeft: Number.parseFloat(el.style.left),
  };
}
function tabLayout(beat) {
  const copies = api.boundsLookup?.findBeats(beat) || [];
  const bounds = copies.reduce(
    (best, b) => (!best || b.visualBounds.y > best.visualBounds.y ? b : best),
    null,
  );
  if (!bounds) return null;
  const scale = api.settings.display.scale,
    metrics = api.settings.display.resources.engravingSettings,
    gap = metrics.tabLineSpacing * scale;
  const sample = bounds.notes?.[0],
    count = model.tuning.length;
  const top = sample
    ? sample.noteHeadBounds.y +
      sample.noteHeadBounds.h / 2 -
      (count - sample.note.string) * gap
    : bounds.barBounds.visualBounds.y -
      (metrics.staffLineThickness * scale) / 2;
  return { bounds, top, gap };
}
function structuralEdit(fn, position = 0) {
  let removed = 0;
  const changed = mutate(() => {
    const previous = model.measures.map((m) => ({
        el: m.el,
        q: m.q,
        length: m.length,
      })),
      oldTotal = model.totalQ,
      oldMi = mi;
    fn(model, mi);
    model.refresh();
    for (const recording of project.recordings) {
      const next = remapAnchors(
        recording.anchors,
        previous,
        model.measures,
        oldTotal,
        model.totalQ,
      );
      removed += recording.anchors.length - next.length;
      recording.anchors = next;
    }
    mi = Math.min(model.measures.length - 1, oldMi + (position === 1 ? 1 : 0));
    ni = 0;
    rangeStart = null;
    cursorQ = model.measures[mi].q;
  });
  if (changed && removed)
    toast(`已移除位于删去位置的 ${removed} 个同步点；其他节点跟随原小节移动。`);
  focusEditor();
}
function revealSelection(smooth = false) {
  const position = moveCursor();
  const cursor = $("scoreCursor"),
    viewport = $("scoreViewport");
  if (cursor.hidden || !position) return;
  // Assigning scrollTop, even to zero, cancels an in-flight smooth scroll.
  // Reset it only when needed, before starting the horizontal animation.
  if (horizontalLayout() && viewport.scrollTop !== 0) viewport.scrollTop = 0;
  const width = viewport.clientWidth,
    margin = Math.min(120, width * 0.15);
  let left =
    playing && followScrollLeft != null
      ? followScrollLeft
      : viewport.scrollLeft;
  // Advance once per measure, keeping a little of the preceding measure visible.
  // During the measure, only move again if a particularly wide bar needs it.
  if (horizontalLayout() && ((playing && followedBar !== mi) || syncDraft))
    left = position.barLeft - margin;
  if (position.noteLeft < left + 16) left = position.noteLeft - margin;
  else if (position.noteLeft + 32 > left + width - 24)
    left = position.noteLeft - width * 0.65;
  left = Math.max(0, Math.min(left, viewport.scrollWidth - width));
  const newTarget =
    followScrollLeft == null || Math.abs(left - followScrollLeft) > 1;
  if ((!playing || newTarget) && Math.abs(left - viewport.scrollLeft) > 1)
    viewport.scrollTo({
      left,
      behavior:
        smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "smooth"
          : "instant",
    });
  followedBar = mi;
  followScrollLeft = playing ? left : null;
  if (horizontalLayout()) return;
  const top = Number.parseFloat(cursor.style.top),
    bottom = top + Number.parseFloat(cursor.style.height);
  if (
    top < viewport.scrollTop ||
    bottom > viewport.scrollTop + viewport.clientHeight
  )
    viewport.scrollTop = Math.max(0, top - 18);
}
function currentQ() {
  if (!playing) return cursorQ;
  const r = recording();
  return r
    ? clampQ(recordingMap().toQ(audio.currentTime))
    : Math.min(
        model.totalQ,
        model.secondsToQ(
          model.qToSeconds(synthQ) +
            (audioContext.currentTime - synthEpoch) * rate,
        ),
      );
}
function currentSeconds() {
  return recording() ? audio.currentTime : model.qToSeconds(currentQ());
}
function durationSeconds() {
  return recording()
    ? Number.isFinite(audio.duration)
      ? audio.duration
      : recording().durationSeconds ||
        Math.max(1, recordingMap().toTime(model.totalQ))
    : model.qToSeconds(model.totalQ);
}
function seekQ(q) {
  if (syncDraft) return;
  const resumeSynth = playing && !recording();
  if (resumeSynth) pause();
  cursorQ = Math.max(0, Math.min(model.totalQ, q));
  if (recording()) {
    const t = recordingMap().toTime(cursorQ);
    audio.currentTime = Math.max(0, Math.min(durationSeconds(), t));
  } else if (resumeSynth) play();
  drawWave();
}
function getContext() {
  return (audioContext ||= new AudioContext());
}
function prepareSynth() {
  synthEvents = playbackEvents(model);
}
function scheduleSynth() {
  const ctx = getContext(),
    nowQ = model.secondsToQ(
      model.qToSeconds(synthQ) + (ctx.currentTime - synthEpoch) * rate,
    ),
    horizon = model.secondsToQ(model.qToSeconds(nowQ) + 0.16 * rate);
  while (
    synthIndex < synthEvents.length &&
    synthEvents[synthIndex].q < horizon
  ) {
    const e = synthEvents[synthIndex++];
    if (e.q + e.duration <= nowQ) continue;
    const t = Math.max(
      ctx.currentTime,
      synthEpoch + (model.qToSeconds(e.q) - model.qToSeconds(synthQ)) / rate,
    );
    const duration = Math.max(
      0.035,
      (model.qToSeconds(e.q + e.duration) -
        model.qToSeconds(Math.max(e.q, nowQ))) /
        rate,
    );
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = e.dead ? "square" : "triangle";
    osc.frequency.value = e.dead ? 90 : 440 * 2 ** ((e.midi - 69) / 12);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(
      (e.dead ? 0.025 : 0.13) / Math.sqrt(e.voices),
      t + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      t + Math.min(duration, e.dead ? 0.07 : duration),
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    synthNodes.push(osc);
    osc.onended = () => {
      synthNodes = synthNodes.filter((n) => n !== osc);
      osc.disconnect();
      gain.disconnect();
    };
  }
}
async function play() {
  try {
    if (syncDraft) {
      toast("请先保存或取消同步点，录音时间已固定。");
      return;
    }
    followedBar = -1;
    followScrollLeft = null;
    if (recording()) {
      if (audio.ended || audio.currentTime >= durationSeconds() - 0.001)
        audio.currentTime = 0;
      alignAudioCursor();
    } else if (cursorQ >= model.totalQ - 0.001) seekQ(0);
    if (recording()) {
      audio.playbackRate = rate;
      audio.preservesPitch = $("preservePitch").checked;
      await audio.play();
      playing = true;
    } else {
      await getContext().resume();
      prepareSynth();
      synthQ = cursorQ;
      synthEpoch = audioContext.currentTime;
      synthIndex = 0;
      playing = true;
      scheduleSynth();
      synthTimer = setInterval(scheduleSynth, 35);
    }
    $("play").textContent = "Ⅱ";
    $("play").setAttribute("aria-label", "暂停");
    revealSelection(true);
  } catch (e) {
    toast("无法播放：" + e.message, true);
  }
}
function pause() {
  if (playing) cursorQ = currentQ();
  playing = false;
  followedBar = -1;
  followScrollLeft = null;
  audio.pause();
  clearInterval(synthTimer);
  for (const node of synthNodes) {
    try {
      node.stop();
    } catch {}
  }
  synthNodes = [];
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "播放");
}
async function switchRecording(id, q = currentQ()) {
  pause();
  recordingId = id;
  cursorQ = q;
  peaks = [];
  const r = recording();
  const epoch = ++waveEpoch;
  if (r) {
    audio.src = `/library/${projectId}/${r.file}`;
    audio.load();
    audio.onloadedmetadata = () => {
      if (epoch !== waveEpoch) return;
      audio.currentTime = Math.max(
        0,
        Math.min(audio.duration, recordingMap().toTime(q)),
      );
      alignAudioCursor();
      updateSync();
      drawWave();
    };
    loadWave(audio.src, epoch);
  } else {
    audio.removeAttribute("src");
    audio.load();
  }
  $("recording").value = id;
  updateSync();
  drawWave();
}
async function loadWave(url, epoch) {
  try {
    const data = await (await fetch(url)).arrayBuffer(),
      buffer = await getContext().decodeAudioData(data),
      channel = buffer.getChannelData(0),
      count = 900,
      step = Math.max(1, Math.floor(channel.length / count)),
      out = [];
    for (let i = 0; i < count; i++) {
      let peak = 0;
      for (
        let j = i * step;
        j < Math.min((i + 1) * step, channel.length);
        j += 8
      )
        peak = Math.max(peak, Math.abs(channel[j]));
      out.push(peak);
    }
    if (epoch === waveEpoch) {
      peaks = out;
      drawWave();
    }
  } catch (e) {
    if (epoch === waveEpoch) toast("波形预览未生成，仍可尝试播放音频。");
  }
}
function setRate(value, normalize = true) {
  const was = playing;
  pause();
  rate = Math.round(Math.max(0.5, Math.min(1, Number(value) || 1)) * 100) / 100;
  if (normalize) $("speed").value = rate.toFixed(2);
  audio.playbackRate = rate;
  if (was) play();
}
function qLocation(q) {
  return qToLocation(model, q);
}
function locationQ(measure, beat) {
  return locationToQ(model, measure, beat);
}
function updateSync() {
  const r = recording();
  $("anchorCount").textContent = r ? `· ${r.anchors.length}` : "";
  $("toggleSync").disabled = !r;
  for (const id of ["addAnchor", "quickSync"])
    $(id).disabled = !r || audio.readyState < 1 || audioImportBusy;
  $("trackNote").textContent = r
    ? !r.anchors.length
      ? "尚未校准 · 按乐谱速度预估，请添加第一个同步点"
      : r.anchors.length === 1
        ? "1 个同步点 · 已校准时间偏移，其余按乐谱速度推进"
        : `${r.anchors.length} 个同步点 · 按乐谱速度变化分段校准`
    : "按乐谱速度合成播放 · 无需录音文件";
  $("trackNote").title = r?.note || "";
  if (!r) {
    $("syncPanel").hidden = true;
    $("anchorRows").replaceChildren();
    return;
  }
  $("copyFrom").replaceChildren(
    ...project.recordings
      .filter((x) => x.id !== r.id)
      .map((x) => new Option(x.name, x.id)),
  );
  $("anchorRows").replaceChildren(
    ...r.anchors.map((a, i) => {
      const row = document.createElement("div");
      row.className = "anchor-row";
      const loc = qLocation(a.q);
      const labels = ["小节", "拍位", "录音秒"];
      const values = [loc.measure, loc.beat, a.seconds];
      const inputs = values.map((v, j) => {
        const label = document.createElement("label");
        label.append(labels[j]);
        const input = document.createElement("input");
        input.type = "number";
        input.value = j === 2 ? v.toFixed(3) : v;
        input.min = j === 2 ? "0" : "1";
        input.step = j === 0 ? "1" : j === 1 ? "0.25" : "0.001";
        input.setAttribute("aria-label", `同步点 ${i + 1} ${labels[j]}`);
        label.append(input);
        row.append(label);
        return input;
      });
      const apply = document.createElement("button");
      apply.textContent = "应用";
      apply.setAttribute("aria-label", `应用同步点 ${i + 1}`);
      apply.onclick = () => {
        try {
          const next = clone(r.anchors);
          next[i] = {
            q: locationQ(Number(inputs[0].value), Number(inputs[1].value)),
            seconds: Number(inputs[2].value),
          };
          validateAnchors(next);
          const valid = new SyncDraft(
            recordingId,
            next[i].seconds,
            next[i].q,
            i,
          ).save(r.anchors, model.totalQ, durationSeconds());
          mutateSync(() => (recording().anchors = valid));
        } catch (e) {
          toast(e.message, true);
          updateSync();
        }
      };
      const del = document.createElement("button");
      del.textContent = "移除";
      del.setAttribute("aria-label", `移除同步点 ${i + 1}`);
      del.onclick = () =>
        mutateSync(
          () =>
            (recording().anchors = validateAnchors(
              r.anchors.filter((_, j) => j !== i),
            )),
        );
      const edit = document.createElement("button");
      edit.textContent = "编辑";
      edit.setAttribute("aria-label", `编辑同步点 ${i + 1}`);
      edit.onclick = () => openSyncPoint(i);
      row.append(edit, apply, del);
      return row;
    }),
  );
  if (!r.anchors.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent =
      "还没有校准点。听到明确的小节起点时暂停，再点“添加同步点”。";
    $("anchorRows").append(empty);
  }
}
function syncLocks() {
  for (const id of [
    "projectSelect",
    "newScore",
    "importScore",
    "recording",
    "addAudio",
    "play",
  ])
    $(id).disabled = !!syncDraft || audioImportBusy;
}
function fillSyncLocation() {
  if (!syncDraft) return;
  const loc = qLocation(syncDraft.q);
  $("syncMeasure").value = loc.measure;
  $("syncBeat").value = Number(loc.beat.toFixed(6));
  updateSyncDraftHint();
}
function updateSyncDraftHint() {
  const duplicate = recording().anchors.findIndex(
    (a) => Math.abs(a.q - syncDraft.q) < 1e-6,
  );
  const replacing = syncDraft.editIndex == null && duplicate >= 0;
  $("syncSave").textContent =
    replacing || syncDraft.editIndex != null ? "更新同步点" : "保存同步点";
  $("syncDraftHint").textContent = replacing
    ? "该位置已有同步点，保存将更新它的时间。"
    : syncDraft.q === model.totalQ
      ? "目标：乐谱结束位置。"
      : `目标：第 ${$("syncMeasure").value} 小节，第 ${$("syncBeat").value} 拍。`;
  $("syncError").hidden = true;
}
function openSyncPoint(index = null) {
  const r = recording();
  if (!r || audio.readyState < 1 || !Number.isFinite(audio.duration))
    return toast("请先添加 MP3，并等待录音载入。");
  if (syncDraft) {
    $("syncMeasure").focus();
    return;
  }
  pause();
  const point =
    index == null
      ? { q: model.measures[mi].q, seconds: audio.currentTime }
      : r.anchors[index];
  if (index != null)
    audio.currentTime = Math.min(audio.duration, point.seconds);
  syncDraft = new SyncDraft(recordingId, point.seconds, point.q, index);
  $("syncTitle").textContent = index == null ? "添加同步点" : "编辑同步点";
  $("syncRecording").textContent = r.name;
  $("syncTime").value = formatTimestamp(point.seconds);
  $("syncMeasure").max = model.measures.length + 1;
  $("syncBeatDetails").open = Math.abs(qLocation(point.q).beat - 1) > 1e-6;
  $("syncRemove").hidden = index == null;
  fillSyncLocation();
  $("syncPopover").hidden = false;
  syncLocks();
  revealSelection();
  $("syncMeasure").focus({ preventScroll: true });
  $("syncMeasure").select();
}
function closeSyncPoint() {
  syncDraft = null;
  $("syncPopover").hidden = true;
  syncLocks();
  alignAudioCursor();
}
function previewSyncLocation() {
  if (!syncDraft) return;
  try {
    syncDraft.selectLocation(
      model,
      Number($("syncMeasure").value),
      Number($("syncBeat").value),
    );
    const m = Math.min(
      Number($("syncMeasure").value) - 1,
      model.measures.length - 1,
    );
    const n = Math.max(
      0,
      model.measures[m].notes.findLastIndex((e) => e.q <= syncDraft.q),
    );
    select(m, n, false);
    updateSyncDraftHint();
  } catch (e) {
    $("syncError").textContent = e.message;
    $("syncError").hidden = false;
  }
}
function drawWave() {
  if (!model) return;
  const canvas = $("waveform"),
    ratio = devicePixelRatio || 1,
    w = canvas.clientWidth,
    h = 86;
  if (!w) return;
  if (canvas.width !== Math.round(w * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = h * ratio;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const duration = durationSeconds(),
    t = currentSeconds(),
    left = 10,
    right = w - 10;
  ctx.fillStyle = "#f0f5ee";
  ctx.fillRect(left, 10, right - left, 60);
  ctx.fillStyle = "#91b5a2";
  if (peaks.length) {
    const max = Math.max(...peaks, 0.1);
    for (let i = 0; i < peaks.length; i++) {
      const x = left + (i / peaks.length) * (right - left),
        v = (peaks[i] / max) * 25;
      ctx.fillStyle =
        x < left + (t / duration) * (right - left) ? "#437f6b" : "#a7c3b2";
      ctx.fillRect(
        x,
        40 - v,
        Math.max(1, ((right - left) / peaks.length) * 0.55),
        Math.max(1, v * 2),
      );
    }
  } else {
    ctx.fillStyle = "#c3d5c5";
    for (let i = 0; i < 80; i++)
      ctx.fillRect(left + (i / 80) * (right - left), 39, 2, 2);
  }
  const r = recording();
  if (r) {
    const points = dragPreview || r.anchors;
    points.forEach((a, i) => {
      const x = left + (a.seconds / duration) * (right - left);
      ctx.strokeStyle = "#c28e3a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, 69);
      ctx.stroke();
      ctx.fillStyle = "#c28e3a";
      ctx.beginPath();
      ctx.arc(x, 10, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "9px Segoe UI";
      ctx.textAlign = i === points.length - 1 ? "right" : "left";
      ctx.fillText(
        a.q >= model.totalQ ? "END" : String(qLocation(a.q).measure),
        x + 3,
        82,
      );
    });
  }
  const x = left + Math.max(0, Math.min(1, t / duration)) * (right - left);
  ctx.strokeStyle = "#164e42";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 17);
  ctx.lineTo(x, 65);
  ctx.stroke();
  $("elapsed").textContent = fmt(t, true);
  $("totalTime").textContent = fmt(duration);
}
function frame() {
  if (playing && model) {
    cursorQ = currentQ();
    selectAtQ(cursorQ);
    if (!recording() && cursorQ >= model.totalQ - 0.0001) pause();
  }
  if (model) drawWave();
  requestAnimationFrame(frame);
}

function setup() {
  api = new alphaTab.AlphaTabApi($("score"), {
    core: {
      engine: "svg",
      useWorkers: false,
      enableLazyLoading: false,
      includeNoteBounds: true,
      fontDirectory: "/vendor/package/dist/font/",
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Horizontal,
      startBar: 1,
      barCount: -1,
      barsPerRow: 4,
      scale: 0.85,
    },
    notation: {
      rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
      rhythmHeight: 25,
    },
    player: { playerMode: alphaTab.PlayerMode.Disabled },
  });
  $("scoreViewport").addEventListener(
    "pointerdown",
    (e) => {
      pointerInfo = { y: e.clientY, shift: e.shiftKey };
      focusEditor();
    },
    true,
  );
  api.beatMouseDown.on((beat) => {
    select(beat.voice.bar.index, beat.index, true, !!pointerInfo?.shift);
    const layout = tabLayout(beat);
    if (layout && pointerInfo) {
      const y =
          pointerInfo.y - api.canvasElement.element.getBoundingClientRect().top,
        row = Math.round((y - layout.top) / layout.gap);
      if (row >= 0 && row < model.tuning.length) selectedString = row + 1;
    }
    updateSelection();
    focusEditor();
  });
  api.noteMouseDown.on((note) => {
    selectedString = model.tuning.length - note.string + 1;
    updateSelection();
    focusEditor();
  });
  api.postRenderFinished.on(() => {
    followedBar = -1;
    followScrollLeft = null;
    revealSelection(false);
  });
  api.error.on((e) => toast("排版引擎：" + e.message, true));
  toolbar = createToolbar($("editToolbar"), {
    state: () => ({ model, mi, ni, selectedString, rangeStart }),
    run: mutate,
    focus: focusEditor,
    structure: structuralEdit,
    position: (m, n) => {
      mi = m;
      ni = n;
    },
  });
  $("scoreViewport").addEventListener("focus", () => {
    $("tabFocusState").textContent = "TAB 键盘编辑已启用";
    $("editToolbar").classList.add("keyboard-active");
  });
  $("scoreViewport").addEventListener("blur", () => {
    $("tabFocusState").textContent = "点击 TAB 后直接输入数字";
    $("editToolbar").classList.remove("keyboard-active");
  });
  $("insertBeforeBar").onclick = () =>
    structuralEdit((m, a) => m.insertMeasure(a), -1);
  $("insertAfterBar").onclick = () =>
    structuralEdit((m, a) => m.insertMeasure(a + 1), 1);
  $("removeBar").onclick = () => structuralEdit((m, a) => m.removeMeasure(a));
  $("scoreLayout").onchange = () => {
    pause();
    const viewport = $("scoreViewport");
    viewport.dataset.layout = $("scoreLayout").value;
    viewport.scrollTo({ left: 0, top: 0, behavior: "instant" });
    api.settings.display.layoutMode = horizontalLayout()
      ? alphaTab.LayoutMode.Horizontal
      : alphaTab.LayoutMode.Page;
    api.updateSettings();
    renderScore();
  };
  $("projectSelect").onchange = (e) =>
    loadProject(e.target.value).catch((e) => toast(e.message, true));
  $("saveButton").onclick = () =>
    flushSave()
      .then(() => toast("已保存到本地谱库"))
      .catch((e) => toast(e.message, true));
  $("play").onclick = () => (playing ? pause() : play());
  $("toStart").onclick = () => {
    pause();
    select(0, 0, true);
  };
  $("recording").onchange = (e) => switchRecording(e.target.value);
  $("speed").oninput = (e) => {
    const v = Number(e.target.value);
    if (v >= 0.5 && v <= 1) setRate(v, false);
  };
  $("speed").onchange = (e) => setRate(e.target.value);
  $("slower").onclick = () => setRate(rate - 0.01);
  $("faster").onclick = () => setRate(rate + 0.01);
  $("preservePitch").onchange = (e) =>
    (audio.preservesPitch = e.target.checked);
  audio.onended = () => {
    pause();
    alignAudioCursor();
  };
  audio.onerror = () => {
    if (recording())
      toast("无法加载音频。若从 Git LFS 克隆，请先下载音频实体。", true);
  };
  $("prevSystem").onclick = () =>
    select(Math.max(0, horizontalLayout() ? mi - 1 : systemStart - 5), 0, true);
  $("nextSystem").onclick = () =>
    select(
      Math.min(
        model.measures.length - 1,
        horizontalLayout() ? mi + 1 : systemStart + 3,
      ),
      0,
      true,
    );
  $("undo").onclick = () => history(true);
  $("redo").onclick = () => history(false);
  $("preset").onchange = (e) =>
    ($("tuning").value = PRESETS[e.target.value].join(" "));
  $("applyTuning").onclick = () =>
    mutate(() =>
      model.setTuning(
        $("tuning")
          .value.trim()
          .split(/[\s,]+/),
        $("tuningMode").value,
      ),
    );
  $("applyNote").onclick = () =>
    mutate(() =>
      model.setFret(
        mi,
        ni,
        Number($("noteString").value),
        Number($("noteFret").value),
      ),
    );
  $("noteString").onchange = (e) => {
    selectedString = Number(e.target.value);
    updateSelection();
  };
  $("restNote").onclick = () => mutate(() => model.toggleRest(mi, ni));
  $("deadNote").onclick = () =>
    mutate(() => model.toggleDead(mi, ni, selectedString));
  $("tieNote").onclick = () =>
    mutate(() => model.toggleTie(mi, ni, selectedString));
  $("splitNote").onclick = () => mutate(() => model.split(mi, ni));
  $("setDuration").onclick = () =>
    mutate(() => model.setDuration(mi, ni, Number($("noteDuration").value)));
  $("addBar").onclick = () =>
    structuralEdit((m) => m.insertMeasure(m.measures.length));
  $("toggleSync").onclick = () =>
    ($("syncPanel").hidden = !$("syncPanel").hidden);
  $("addAnchor").onclick = () => openSyncPoint();
  $("quickSync").onclick = () => openSyncPoint();
  $("syncCancel").onclick = closeSyncPoint;
  $("syncClose").onclick = closeSyncPoint;
  $("syncMeasure").oninput = previewSyncLocation;
  $("syncBeat").oninput = previewSyncLocation;
  $("syncForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!syncDraft || recordingId !== syncDraft.recordingId) return;
    try {
      syncDraft.selectLocation(
        model,
        Number($("syncMeasure").value),
        Number($("syncBeat").value),
      );
      syncDraft.seconds = parseTimestamp($("syncTime").value);
      const next = syncDraft.save(
        recording().anchors,
        model.totalQ,
        audio.duration,
      );
      const seconds = syncDraft.seconds;
      if (
        !mutateSync(() => {
          recording().anchors = next;
        }, true)
      )
        return;
      audio.currentTime = seconds;
      closeSyncPoint();
      await flushSave();
      toast("同步点已保存到本机");
    } catch (error) {
      $("syncError").textContent = error.message;
      $("syncError").hidden = false;
      toast(error.message, true);
    }
  };
  $("syncRemove").onclick = async () => {
    if (!syncDraft || syncDraft.editIndex == null) return;
    const index = syncDraft.editIndex;
    if (
      mutateSync(() => {
        recording().anchors = recording().anchors.filter((_, i) => i !== index);
      }, true)
    ) {
      closeSyncPoint();
      try {
        await flushSave();
        toast("已移除同步点，可撤销");
      } catch (e) {
        toast(e.message, true);
      }
    }
  };
  $("copyAnchors").onclick = () =>
    mutateSync(() => {
      const from = project.recordings.find((r) => r.id === $("copyFrom").value);
      if (!from) throw Error("没有其他录音可复制");
      recording().anchors = clone(from.anchors);
    });
  $("shiftAnchors").onclick = () =>
    mutateSync(() => {
      const offset = Number($("shiftMs").value) / 1000;
      recording().anchors = validateAnchors(
        recording().anchors.map((a) => ({
          ...a,
          seconds: a.seconds + offset,
        })),
      );
    });
  const canvas = $("waveform");
  canvas.onpointerdown = (e) => {
    if (syncDraft) {
      toast("同步点时间已固定；保存或取消后可跳转录音。");
      return;
    }
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      duration = durationSeconds(),
      r = recording();
    dragAnchor = r
      ? r.anchors.findIndex(
          (a) =>
            Math.abs(10 + (a.seconds / duration) * (rect.width - 20) - x) < 8 &&
            e.clientY - rect.top < 24,
        )
      : -1;
    if (dragAnchor >= 0) {
      pause();
      dragStartX = e.clientX;
      dragMoved = false;
      dragPreview = clone(r.anchors);
      canvas.setPointerCapture(e.pointerId);
    } else {
      const t =
        Math.max(0, Math.min(1, (x - 10) / (rect.width - 20))) * duration;
      if (r) {
        audio.currentTime = t;
        cursorQ = clampQ(recordingMap().toQ(t));
      } else {
        cursorQ = model.secondsToQ(t);
        seekQ(cursorQ);
      }
      selectAtQ(cursorQ);
    }
  };
  canvas.onpointermove = (e) => {
    if (dragAnchor < 0) return;
    if (Math.abs(e.clientX - dragStartX) >= 3) dragMoved = true;
    if (!dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    dragPreview[dragAnchor].seconds =
      Math.round(
        Math.max(
          0,
          Math.min(1, (e.clientX - rect.left - 10) / (rect.width - 20)),
        ) *
          durationSeconds() *
          1000,
      ) / 1000;
    drawWave();
  };
  canvas.onpointerup = () => {
    if (dragAnchor < 0) return;
    const next = dragPreview,
      index = dragAnchor;
    dragAnchor = -1;
    dragPreview = null;
    if (!dragMoved) {
      openSyncPoint(index);
      return;
    }
    mutateSync(() => (recording().anchors = validateAnchors(next)));
  };
  canvas.onpointercancel = () => {
    dragAnchor = -1;
    dragPreview = null;
    drawWave();
  };
  $("exportXml").onclick = () => {
    const data = new Blob([model.serialize()], {
        type: "application/vnd.recordare.musicxml+xml",
      }),
      url = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = url;
    a.download = project.title + ".musicxml";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("printScore").onclick = async () => {
    pause();
    const popup = window.open("about:blank", "local-tab-print");
    try {
      await flushSave();
      const url = "/print.html?project=" + encodeURIComponent(projectId);
      if (popup) popup.location.href = url;
      else location.href = url;
    } catch (e) {
      popup?.close();
      toast(e.message, true);
    }
  };
  $("importScore").onclick = () => $("scoreFile").click();
  $("scoreFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await flushSave();
      const bytes = new Uint8Array(await f.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const result = await request("/api/import", {
        method: "POST",
        body: JSON.stringify({ name: f.name, data: btoa(binary) }),
      });
      await listProjects();
      await loadProject(result.id);
      toast("乐谱已导入本地谱库");
    } catch (e) {
      toast(e.message, true);
    }
    e.target.value = "";
  };
  $("addAudio").onclick = () => $("audioFile").click();
  $("audioFile").onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || audioImportBusy) return;
    pause();
    audioImportBusy = true;
    syncLocks();
    const added = [];
    let savedCount = 0,
      failure = "";
    try {
      await flushSave();
      for (const f of files) {
        if (f.size > 80_000_000) throw Error(`${f.name} 超过单文件 80 MB 限制`);
        const objectUrl = URL.createObjectURL(f),
          temp = new Audio();
        try {
          await new Promise((resolve, reject) => {
            temp.onloadedmetadata = resolve;
            temp.onerror = () => reject(Error(`无法读取 ${f.name}`));
            temp.src = objectUrl;
            temp.load();
          });
          if (!Number.isFinite(temp.duration) || temp.duration <= 0)
            throw Error(`${f.name} 的音频时长不可用`);
          const result = await request(
            `/api/audio/${projectId}?name=${encodeURIComponent(f.name)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: await f.arrayBuffer(),
            },
          );
          // Plain HTTP on a LAN does not expose crypto.randomUUID in browsers.
          const id = result.id ?? result.file;
          if (
            !mutate(
              () =>
                project.recordings.push({
                  id,
                  name: result.name,
                  file: result.file,
                  durationSeconds: temp.duration,
                  syncAlgorithm: SYNC_ALGORITHM,
                  anchors: [],
                }),
              { render: false },
            )
          )
            throw Error(`未能添加 ${f.name}`);
          added.push(id);
          await flushSave();
          savedCount++;
        } finally {
          temp.removeAttribute("src");
          temp.load();
          URL.revokeObjectURL(objectUrl);
        }
      }
    } catch (e) {
      failure = e.message;
    } finally {
      if (added.length) {
        await switchRecording(added[0], 0);
        $("syncPanel").hidden = false;
      }
      audioImportBusy = false;
      syncLocks();
      updateSync();
      toast(
        failure
          ? `已保存 ${savedCount} 份录音。${failure}；已停止后续导入。`
          : `${savedCount} 份录音已保存；切换音频来源，分别添加同步点。`,
        !!failure,
      );
    }
    e.target.value = "";
  };
  $("newScore").onclick = () => $("newDialog").showModal();
  $("cancelNew").onclick = () => $("newDialog").close();
  $("newForm").onsubmit = async (e) => {
    e.preventDefault();
    if ($("createScore").disabled) return;
    $("createScore").disabled = true;
    try {
      await flushSave();
      const result = await request("/api/new", {
        method: "POST",
        body: JSON.stringify({
          title: $("newTitle").value,
          tuning: PRESETS[$("newPreset").value],
          bars: Number($("newBars").value),
          tempo: Number($("newTempo").value),
          beats: Number($("newBeats").value),
          unit: Number($("newUnit").value),
        }),
      });
      $("newDialog").close();
      await listProjects();
      await loadProject(result.id);
    } catch (e) {
      toast(e.message, true);
    } finally {
      $("createScore").disabled = false;
    }
  };
  document.addEventListener("keydown", (e) => {
    if (!model) return;
    const field = e.target.closest(
      'input,select,textarea,[contenteditable="true"]',
    );
    if (syncDraft) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSyncPoint();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        $("syncForm").requestSubmit();
      } else if (!field) {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          const m = Math.max(
            0,
            Math.min(
              model.measures.length - 1,
              mi + (e.key === "ArrowLeft" ? -1 : 1),
            ),
          );
          select(m, 0, true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          $("syncForm").requestSubmit();
        } else if (e.code === "Space" || e.key === " ") e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flushSave().catch((e) => toast(e.message, true));
      return;
    }
    if (field || $("newDialog").open) return;
    if (e.ctrlKey || e.metaKey) {
      if (
        e.key.toLowerCase() === "z" &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)
      ) {
        e.preventDefault();
        history(!e.shiftKey);
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        structuralEdit((m, a) => m.removeMeasure(a));
      }
      return;
    }
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
      $("newDialog").open
    )
      return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      playing ? pause() : play();
      return;
    }
    if (!e.target.closest("#scoreViewport,#editToolbar,#noteStrip")) return;
    if (e.altKey) {
      if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const type = [
          "whole",
          "half",
          "quarter",
          "eighth",
          "16th",
          "32nd",
          "64th",
        ][Number(e.key) - 1];
        mutate(() =>
          model.editDuration(
            mi,
            ni,
            type,
            model.event(mi, ni).dots,
            toolbar.mode(),
          ),
        );
      }
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        mutate(() => {
          ni = model.triplet(mi, ni, toolbar.mode());
        });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        structuralEdit((m, a) => m.insertMeasure(a + 1), 1);
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Enter") {
      e.preventDefault();
      const index =
          model.notes.indexOf(model.event(mi, ni)) +
          (e.key === "ArrowLeft" ? -1 : 1),
        n = model.notes[index];
      if (n) select(n.mi, n.ni, true, e.shiftKey);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      selectedString = Math.max(
        1,
        Math.min(
          model.tuning.length,
          selectedString + (e.key === "ArrowUp" ? -1 : 1),
        ),
      );
      keyDigits = "";
      keyTime = 0;
      updateSelection();
      return;
    }
    if (e.key === "Escape") {
      rangeStart = null;
      keyDigits = "";
      keyTime = 0;
      updateSelection();
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const now = Date.now();
      keyDigits = now - keyTime < 700 ? keyDigits + e.key : e.key;
      keyTime = now;
      if (Number(keyDigits) > 36) keyDigits = e.key;
      mutate(() => model.setFret(mi, ni, selectedString, Number(keyDigits)));
      return;
    }
    const shortcuts = {
      ".": () => model.toggleDots(mi, ni, toolbar.mode()),
      t: () => model.toggleTie(mi, ni, selectedString),
      x: () => model.toggleDead(mi, ni, selectedString),
      r: () => model.toggleRest(mi, ni),
      s: () => pairShortcut("slur"),
      h: () => pairShortcut("hammer-on"),
      p: () => pairShortcut("pull-off"),
      "/": () => pairShortcut("slide"),
    };
    const action = shortcuts[e.key.toLowerCase()];
    if (action) {
      e.preventDefault();
      mutate(action);
    }
    if (["Delete", "Backspace"].includes(e.key)) {
      e.preventDefault();
      if (model.tone(mi, ni, selectedString))
        mutate(() => model.removeTone(mi, ni, selectedString));
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (seq !== savedSeq) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  new ResizeObserver(() => {
    drawWave();
    moveCursor();
  }).observe($("scoreViewport"));
  requestAnimationFrame(frame);
}
try {
  token = (await request("/api/session")).token;
  setup();
  const projects = await listProjects();
  if (projects.length) await loadProject(projects[0].id);
  else $("newDialog").showModal();
} catch (e) {
  saveStatus("打开失败", true);
  toast(e.message, true);
  console.error(e);
}
