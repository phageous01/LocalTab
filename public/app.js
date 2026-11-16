import { t as tr, bindTranslations, getLanguage, setLanguage, onLanguageChange, retranslate, translateError } from "./i18n.js";
import { PRESETS, pitchName, validateAnchors } from "./model.js";
import {
  ScoreDocument,
  applyDisplaySettings,
  remapAnchors,
  playbackEvents,
} from "./editor-model.js";
import { createToolbar } from "./toolbar.js";
import { setupPublishing } from "./publish.js";
import { copyNotes, pasteNotes } from "./clipboard.js";
import { playheadX, followScrollPosition } from "./playhead.js";
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
bindTranslations(document);
$("languageSelect").value = getLanguage();
$("languageSelect").onchange = (event) => setLanguage(event.target.value);
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
let visiblePartIds = [];
let smoothScrollPosition = null, smoothScrollTime = 0;
let noteClipboard = "",
  dragSelection = null,
  buttonCopy = null;
const horizontalLayout = () => $("scoreLayout").value === "horizontal";
function focusEditor() {
  $("scoreViewport").focus({ preventScroll: true });
  $("tabFocusState").textContent = tr("TAB 键盘编辑已启用");
  $("editToolbar").classList.add("keyboard-active");
}
function pairShortcut(tag) {
  const i = model.notes.indexOf(model.event(mi, ni)),
    begin = Math.min(rangeStart ?? i, i),
    end = rangeStart == null ? null : Math.max(rangeStart, i),
    a = model.notes[begin];
  model.pair(a.mi, a.ni, tag, end, selectedString);
}
function selectedRange() {
  const current = model.notes.indexOf(model.event(mi, ni));
  const anchor = Math.min(
    model.notes.length - 1,
    Math.max(0, rangeStart ?? current),
  );
  return { first: Math.min(anchor, current), last: Math.max(anchor, current) };
}
function copySelectedNotes() {
  if (!model || syncDraft) return null;
  pause();
  try {
    const { first, last } = selectedRange();
    noteClipboard = copyNotes(model, first, last);
    $("pasteNotes").disabled = !model.editable;
    toast(tr`已复制 ${last - first + 1} 个音位（含全部和弦音）`);
    return noteClipboard;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
function pasteSelectedNotes(text) {
  if (!model) return;
  let result;
  const changed = mutate(() => {
    const { first } = selectedRange(),
      oldTotal = model.totalQ;
    result = pasteNotes(model, first, text);
    if (model.totalQ !== oldTotal) {
      for (const r of project.recordings)
        r.anchors = r.anchors.map((a) =>
          Math.abs(a.q - oldTotal) < 1e-6 ? { ...a, q: model.totalQ } : a,
        );
    }
    rangeStart = result.first;
    const last = model.notes[result.last];
    mi = last.mi;
    ni = last.ni;
    cursorQ = model.notes[result.first].q;
  });
  if (changed) {
    seekQ(cursorQ);
    toast(
      tr`已粘贴 ${result.count} 个音位${result.addedBars ? tr`，补充 ${result.addedBars} 个小节` : ""} · Ctrl/Cmd+Z 撤销`,
    );
  }
  focusEditor();
}
function clipboardScope(target) {
  if (!(target instanceof Element)) target = document.activeElement;
  return (
    model &&
    !syncDraft &&
    !$("newDialog").open &&
    !$("publishDialog").open &&
    !$("partDialog").open &&
    !target.closest('input,select,textarea,[contenteditable="true"]') &&
    target.closest("#scoreViewport,#editToolbar,#copyNotes,#pasteNotes")
  );
}
function drawSelection() {
  const layer = $("scoreSelection");
  layer.replaceChildren();
  layer.hidden =
    rangeStart == null || !model || !renderedScore || !api?.boundsLookup;
  if (layer.hidden) return;
  const { first, last } = selectedRange(),
    boxes = new Map();
  for (const event of model.notes.slice(first, last + 1)) {
    const beat =
      renderedScore.tracks[model.partIndex]?.staves[0]?.bars[event.mi]?.voices[0]?.beats[
        event.ni
      ];
    if (!beat) continue;
    for (const b of api.boundsLookup.findBeats(beat) || []) {
      const r = b.visualBounds,
        key = event.mi;
      const box = boxes.get(key) || {
        left: Infinity,
        top: Infinity,
        right: -Infinity,
        bottom: -Infinity,
      };
      box.left = Math.min(box.left, r.x);
      box.top = Math.min(box.top, r.y);
      box.right = Math.max(box.right, r.x + r.w);
      box.bottom = Math.max(box.bottom, r.y + r.h);
      boxes.set(key, box);
    }
  }
  const canvas = api.canvasElement.element.getBoundingClientRect(),
    viewport = $("scoreViewport"),
    rect = viewport.getBoundingClientRect();
  for (const box of boxes.values()) {
    const highlight = document.createElement("div");
    highlight.className = "score-selection-rect";
    highlight.style.left = `${canvas.left - rect.left + viewport.scrollLeft + box.left}px`;
    highlight.style.top = `${canvas.top - rect.top + viewport.scrollTop + box.top - 3}px`;
    highlight.style.width = `${Math.max(8, box.right - box.left)}px`;
    highlight.style.height = `${Math.max(20, box.bottom - box.top + 6)}px`;
    layer.append(highlight);
  }
}
function updateDragSelection() {
  if (!dragSelection?.active || !api?.boundsLookup) return;
  const viewport = $("scoreViewport"),
    rect = viewport.getBoundingClientRect(),
    d = dragSelection;
  // Continue selecting past the viewport edge while the mouse is held down.
  const edge = 32;
  if (d.x < rect.left + edge)
    viewport.scrollLeft -= Math.min(18, (rect.left + edge - d.x) / 3);
  else if (d.x > rect.right - edge)
    viewport.scrollLeft += Math.min(18, (d.x - rect.right + edge) / 3);
  if (!horizontalLayout()) {
    if (d.y < rect.top + edge) viewport.scrollTop -= 12;
    else if (d.y > rect.bottom - edge) viewport.scrollTop += 12;
  }
  const canvas = api.canvasElement.element.getBoundingClientRect();
  const x =
    Math.max(rect.left + 4, Math.min(rect.right - 4, d.x)) - canvas.left;
  const y = Math.max(rect.top + 4, Math.min(rect.bottom - 4, d.y)) - canvas.top;
  const beat =
    api.boundsLookup.getBeatAtPos(x, y) ||
    (horizontalLayout()
      ? api.boundsLookup.getBeatAtPos(x, d.originY - canvas.top)
      : null);
  if (!beat || beat.voice.bar.staff.track.index !== model.partIndex) return;
  rangeStart = d.anchor;
  if (mi !== beat.voice.bar.index || ni !== beat.index)
    select(beat.voice.bar.index, beat.index, false, true);
  else drawSelection();
}
function finishDragSelection() {
  const active = dragSelection?.active;
  dragSelection = null;
  $("scoreViewport").classList.remove("selecting");
  if (active && model) {
    seekQ(model.event(mi, ni).q);
    focusEditor();
  }
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
  if (!r.ok) throw Error(translateError(data.error) || tr`请求失败 ${r.status}`);
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
  saveStatus(tr("待保存…"));
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
  saveStatus(tr("保存中…"));
  savingPromise = request(`/api/project/${id}`, {
    method: "PUT",
    body: JSON.stringify({ xml, project: config, revision }),
  })
    .then((r) => {
      if (projectId === id) {
        revision = r.revision;
        savedSeq = captureSeq;
        saveStatus(savedSeq === seq ? tr("已保存到本机") : tr("待保存…"));
      }
    })
    .catch((e) => {
      saveStatus(tr("保存失败 · 请导出备份"), true);
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
    activePartId: model.activePartId,
    visiblePartIds: [...visiblePartIds],
  };
}
function mutate(fn, { render = true, sync = false } = {}) {
  if (!model) return;
  if (syncDraft && !sync) {
    toast(tr("请先保存或取消当前同步点，再修改乐谱或其他同步点。"));
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
    model = new ScoreDocument(before.xml, before.activePartId);
    project = before.project;
    visiblePartIds = before.visiblePartIds;
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
    toast(tr("请先保存或取消当前同步点，再撤销。"));
    return;
  }
  const src = back ? undoStack : redoStack,
    dst = back ? redoStack : undoStack;
  if (!src.length) return;
  pause();
  const oldAnchors = JSON.stringify(recording()?.anchors);
  dst.push(snapshot());
  const s = src.pop();
  model = new ScoreDocument(s.xml, s.activePartId);
  project = s.project;
  visiblePartIds = s.visiblePartIds;
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
  restorePartView();
  mi = 0;
  ni = 0;
  selectedString = model.event(0, 0).rest
    ? model.tuning.length
    : model.event(0, 0).string;
  rangeStart = null;
  dragSelection = null;
  cursorQ = 0;
  followedBar = -1;
  followScrollLeft = null;
  $("scoreViewport").scrollTo({ left: 0, top: 0, behavior: "instant" });
  seq = 0;
  savedSeq = 0;
  undoStack = [];
  redoStack = [];
  saveStatus(tr("已保存到本机"));
  document.title = project.title + " · Local Tab Studio";
  $("projectSelect").value = id;
  updateUI();
  await switchRecording(project.recordings[0]?.id || "synth", 0);
  renderScore();
  if (!model.editable)
    toast(
      tr("此谱含复杂结构，当前版本提供查看及原样导出；请使用单声部 TAB 进行编辑。"),
      true,
    );
}
function visibleTrackIndices() {
  return model.partInfos.filter((part) => visiblePartIds.includes(part.id)).map((part) => part.index);
}
function savePartView() {
  try {
    localStorage.setItem("localtab.parts." + projectId, JSON.stringify({
      active: model.activePartId, visible: visiblePartIds,
    }));
  } catch { /* View preferences do not affect score data. */ }
}
function restorePartView() {
  visiblePartIds = model.partInfos.map((part) => part.id);
  try {
    const view = JSON.parse(localStorage.getItem("localtab.parts." + projectId));
    if (model.partInfos.some((part) => part.id === view?.active)) model.selectPart(view.active);
    if (Array.isArray(view?.visible)) visiblePartIds = view.visible.filter((id) =>
      model.partInfos.some((part) => part.id === id));
  } catch { /* Start with all instruments visible. */ }
  if (!visiblePartIds.includes(model.activePartId)) visiblePartIds.push(model.activePartId);
}
function updatePartControls() {
  visiblePartIds = visiblePartIds.filter((id) => model.partInfos.some((part) => part.id === id));
  if (!visiblePartIds.includes(model.activePartId)) visiblePartIds.push(model.activePartId);
  $("activePart").replaceChildren(...model.partInfos.map((part) => new Option(part.name, part.id)));
  $("activePart").value = model.activePartId;
  $("partVisibility").replaceChildren(...model.partInfos.map((part) => {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox";
    input.checked = visiblePartIds.includes(part.id);
    input.setAttribute("aria-label", tr`显示 ${part.name}`);
    input.onchange = () => {
      if (syncDraft) { input.checked = !input.checked; return; }
      if (input.checked) visiblePartIds.push(part.id);
      else {
        if (visiblePartIds.length === 1) {
          input.checked = true;
          return toast(tr("至少显示一个乐器"));
        }
        visiblePartIds = visiblePartIds.filter((id) => id !== part.id);
        if (part.id === model.activePartId) switchPart(visiblePartIds[0], false);
      }
      savePartView();
      renderScore();
    };
    label.append(input, document.createTextNode(part.name));
    return label;
  }));
  $("partEditHint").textContent = model.editable
    ? tr("在当前乐器上记谱；小节、拍号与速度对全谱生效。")
    : tr("此乐器可查看；当前编辑器支持单声部的 4–6 弦 TAB。其他声部完整保留。") ;
}
function switchPart(id, render = true) {
  if (id === model.activePartId) return;
  if (syncDraft) return;
  const q = currentQ();
  if (playing && !recording()) pause();
  model.selectPart(id);
  rangeStart = null;
  dragSelection = null;
  keyDigits = "";
  mi = Math.min(mi, model.measures.length - 1);
  ni = 0;
  selectedString = Math.max(1, model.tuning.length);
  cursorQ = q;
  if (!visiblePartIds.includes(id)) visiblePartIds.push(id);
  updateUI();
  selectAtQ(q);
  savePartView();
  if (render) renderScore();
}
function setupParts() {
  $("activePart").onchange = (event) => switchPart(event.target.value);
  $("showAllParts").onclick = () => {
    visiblePartIds = model.partInfos.map((part) => part.id);
    updatePartControls(); savePartView(); renderScore();
  };
  $("showActivePart").onclick = () => {
    visiblePartIds = [model.activePartId];
    updatePartControls(); savePartView(); renderScore();
  };
  $("addPart").onclick = () => {
    if (syncDraft) return;
    pause();
    $("partName").value = "";
    $("partDialog").showModal();
  };
  $("cancelPart").onclick = () => $("partDialog").close();
  $("partForm").onsubmit = (event) => {
    event.preventDefault();
    if (mutate(() => {
      model.addPart($("partName").value, PRESETS[$("partPreset").value]);
      visiblePartIds.push(model.activePartId);
      mi = ni = 0;
      selectedString = model.tuning.length;
      rangeStart = null;
    })) {
      savePartView();
      $("partDialog").close();
    }
  };
}
function updateUI() {
  if (!model) return;
  updatePartControls();
  $("scoreTitle").textContent = project.title;
  $("scoreMeta").textContent =
    tr`${model.partInfos[model.partIndex].name} · ${model.measures.length} 小节 · ${model.measures[0].beats}/${model.measures[0].unit} · ♩ = ${model.tempo}` +
    (model.parts.length > 1 ? tr` · ${model.parts.length} 个乐器` : "");
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
      b.title = tr`第 ${i + 1} 小节`;
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
    new Option(tr("当前乐器合成预览"), "synth"),
    ...project.recordings.map((r) => new Option(r.name, r.id)),
  );
  $("recording").value = recordingId;
  $("copyFrom").replaceChildren(
    ...project.recordings
      .filter((r) => r.id !== recordingId)
      .map((r) => new Option(r.name, r.id)),
  );
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  for (const id of ["applyTuning", "addBar"]) $(id).disabled = !model.editable;
  for (const id of ["preset", "tuning", "tuningMode", "insertBeforeBar", "insertAfterBar", "removeBar"])
    $(id).disabled = !model.editable;
  updateSelection();
  updateSync();
}
function updateSelection() {
  const m = model.measures[mi],
    e = m.notes[ni];
  if (!e) return;
  selectedString = Math.max(1, Math.min(selectedString, model.tuning.length));
  const tone = model.tone(mi, ni, selectedString);
  $("selectionLabel").textContent =
    tr`第 ${mi + 1} 小节 · 第 ${ni + 1} 音位${e.tones.length > 1 ? tr` · ${e.tones.length} 音和弦` : ""}${e.rest ? tr(" · 休止符") : tone ? tr` · ${tone.string}弦 ${tone.dead ? "X" : tone.fret + tr("品")} · ${pitchName(tone.midi)}` : tr` · ${selectedString}弦未填音，输入数字添加`}`;
  for (const [i, b] of [...$("barNav").children].entries())
    b.className =
      i === mi
        ? "current"
        : i >= systemStart - 1 && i < systemStart + 3
          ? "in-view"
          : "";
  $("systemLabel").textContent = horizontalLayout()
    ? tr`第 ${mi + 1} / ${model.measures.length} 小节`
    : `${systemStart} — ${Math.min(systemStart + 3, model.measures.length)}`;
  $("prevSystem").disabled = horizontalLayout() ? mi === 0 : systemStart === 1;
  $("nextSystem").disabled = horizontalLayout()
    ? mi === model.measures.length - 1
    : systemStart + 3 >= model.measures.length;
  $("prevSystem").setAttribute(
    "aria-label",
    horizontalLayout() ? tr("上一小节") : tr("上一组小节"),
  );
  $("nextSystem").setAttribute(
    "aria-label",
    horizontalLayout() ? tr("下一小节") : tr("下一组小节"),
  );
  const range = selectedRange();
  $("selectionSummary").textContent =
    rangeStart == null
      ? tr("五线谱 + TAB")
      : tr`已选 ${range.last - range.first + 1} 个音位 · 第 ${model.notes[range.first].mi + 1}–${model.notes[range.last].mi + 1} 小节`;
  $("copyNotes").disabled = !model.editable || !!syncDraft;
  $("pasteNotes").disabled = !model.editable || !!syncDraft || !noteClipboard;
  moveCursor();
  drawSelection();
  toolbar?.refresh();
  if (!model.editable)
    $("selectionLabel").textContent = tr`第 ${mi + 1} 小节 · ${model.partInfos[model.partIndex].name} · 查看模式`;
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
  if (!dragSelection?.active) revealSelection(playing && !seek);
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
  if (playing && m.notes[Math.max(0, i)] && !m.notes[Math.max(0, i)].rest)
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
      api.renderScore(renderedScore, visibleTrackIndices());
      updateSelection();
    } catch (e) {
      toast(tr("排版失败：") + e.message, true);
    }
  }, 70);
}
function moveCursor() {
  if (!renderedScore || !api?.boundsLookup) return;
  const bar = renderedScore.tracks[model.partIndex]?.staves[0]?.bars[mi];
  const beats = bar?.voices[0]?.beats || [];
  const beat = model.editable ? beats[ni] :
    beats.findLast((beat) => beat.playbackStart / 960 <= cursorQ - model.measures[mi].q) || beats[0];
  if (!beat) { $("scoreCursor").hidden = true; return; }
  const layout = tabLayout(beat),
    b = layout?.bounds;
  if (!b) {
    $("scoreCursor").hidden = true;
    return;
  }
  const area = b.barBounds.masterBarBounds.visualBounds,
    canvas = api.canvasElement.element.getBoundingClientRect(),
    viewport = $("scoreViewport").getBoundingClientRect();
  const el = $("scoreCursor"),
    cursorScale = api.settings.display.scale / 0.85;
  const smooth = playing && $("playheadMode").value === "smooth";
  let noteX = b.onNotesX;
  if (smooth) {
    const measure = model.measures[mi];
    const points = beats.flatMap((beat) => {
      const box = tabLayout(beat)?.bounds;
      return box ? [{ q: measure.q + beat.playbackStart / 960, x: box.onNotesX }] : [];
    }).filter((point, i, all) => i === 0 || point.q > all[i - 1].q);
    const nextBeat = renderedScore.tracks[model.partIndex]?.staves[0]?.bars[mi + 1]?.voices[0]?.beats[0];
    const next = nextBeat && tabLayout(nextBeat)?.bounds;
    const endX = next && Math.abs(next.barBounds.masterBarBounds.visualBounds.y - area.y) < 1
      ? next.onNotesX : b.barBounds.visualBounds.x + b.barBounds.visualBounds.w;
    if (!points.length || points.at(-1).q < measure.q + measure.length)
      points.push({ q: measure.q + measure.length, x: endX });
    noteX = playheadX(cursorQ, points) ?? noteX;
  }
  const line = smooth || !model.tuning.length;
  el.classList.toggle("playback-line", line);
  el.hidden = false;
  el.style.left = `${canvas.left - viewport.left + $("scoreViewport").scrollLeft + noteX - (line ? 1 : 3 * cursorScale)}px`;
  el.style.top = `${canvas.top - viewport.top + $("scoreViewport").scrollTop + (line ? area.y : layout.top + (selectedString - 1) * layout.gap - 9 * cursorScale)}px`;
  el.style.height = `${line ? area.h : 19 * cursorScale}px`;
  el.style.width = `${line ? 2 : 23 * cursorScale}px`;
  el.setAttribute("aria-label", line ? tr("播放位置") : tr`第 ${selectedString} 弦输入位置`);
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
  const top = sample && model.tuning.length
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
    toast(tr`已移除位于删去位置的 ${removed} 个同步点；其他节点跟随原小节移动。`);
  focusEditor();
}
function revealSelection(smooth = false) {
  const position = moveCursor();
  const cursor = $("scoreCursor"),
    viewport = $("scoreViewport");
  if (cursor.hidden || !position) return;
  if (horizontalLayout() && playing && $("playheadMode").value === "smooth") {
    const now = performance.now();
    if (smoothScrollPosition == null || Math.abs(viewport.scrollLeft - smoothScrollPosition) > 2) {
      smoothScrollPosition = viewport.scrollLeft;
      smoothScrollTime = now;
    }
    const target = Math.max(0, Math.min(
      position.noteLeft - viewport.clientWidth * 0.3,
      viewport.scrollWidth - viewport.clientWidth,
    ));
    smoothScrollPosition = followScrollPosition(smoothScrollPosition, target, (now - smoothScrollTime) / 1000);
    smoothScrollTime = now;
    viewport.scrollTo({ left: smoothScrollPosition, behavior: "instant" });
    return;
  }
  smoothScrollPosition = null;
  smoothScrollTime = 0;
  // Assigning scrollTop, even to zero, cancels an in-flight smooth scroll.
  // Reset it only when needed, before starting the horizontal animation.
  if (horizontalLayout() && visiblePartIds.length === 1 && viewport.scrollTop !== 0) viewport.scrollTop = 0;
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
  if (horizontalLayout() && (playing || visiblePartIds.length === 1)) return;
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
  synthEvents = playbackEvents(model).filter((event) => Number.isFinite(event.midi));
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
      toast(tr("请先保存或取消同步点，录音时间已固定。"));
      return;
    }
    followedBar = -1;
    followScrollLeft = null;
    smoothScrollPosition = null;
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
    $("play").setAttribute("aria-label", tr("暂停"));
    revealSelection(true);
  } catch (e) {
    toast(tr("无法播放：") + e.message, true);
  }
}
function pause() {
  if (playing) cursorQ = currentQ();
  playing = false;
  smoothScrollPosition = null;
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
  $("play").setAttribute("aria-label", tr("播放"));
  if (model) moveCursor();
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
    if (epoch === waveEpoch) toast(tr("波形预览未生成，仍可尝试播放音频。"));
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
      ? tr("尚未校准 · 按乐谱速度预估，请添加第一个同步点")
      : r.anchors.length === 1
        ? tr("1 个同步点 · 已校准时间偏移，其余按乐谱速度推进")
        : tr`${r.anchors.length} 个同步点 · 按乐谱速度变化分段校准`
    : tr("按乐谱速度合成播放 · 无需录音文件");
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
      const labels = [tr("小节"), tr("拍位"), tr("录音秒")];
      const values = [loc.measure, loc.beat, a.seconds];
      const inputs = values.map((v, j) => {
        const label = document.createElement("label");
        label.append(labels[j]);
        const input = document.createElement("input");
        input.type = "number";
        input.value = j === 2 ? v.toFixed(3) : v;
        input.min = j === 2 ? "0" : "1";
        input.step = j === 0 ? "1" : j === 1 ? "0.25" : "0.001";
        input.setAttribute("aria-label", tr`同步点 ${i + 1} ${labels[j]}`);
        label.append(input);
        row.append(label);
        return input;
      });
      const apply = document.createElement("button");
      apply.textContent = tr("应用");
      apply.setAttribute("aria-label", tr`应用同步点 ${i + 1}`);
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
      del.textContent = tr("移除");
      del.setAttribute("aria-label", tr`移除同步点 ${i + 1}`);
      del.onclick = () =>
        mutateSync(
          () =>
            (recording().anchors = validateAnchors(
              r.anchors.filter((_, j) => j !== i),
            )),
        );
      const edit = document.createElement("button");
      edit.textContent = tr("编辑");
      edit.setAttribute("aria-label", tr`编辑同步点 ${i + 1}`);
      edit.onclick = () => openSyncPoint(i);
      row.append(edit, apply, del);
      return row;
    }),
  );
  if (!r.anchors.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent =
      tr("还没有校准点。听到明确的小节起点时暂停，再点“添加同步点”。");
    $("anchorRows").append(empty);
  }
}
function syncLocks() {
  for (const id of [
    "projectSelect",
    "activePart",
    "addPart",
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
    replacing || syncDraft.editIndex != null ? tr("更新同步点") : tr("保存同步点");
  $("syncDraftHint").textContent = replacing
    ? tr("该位置已有同步点，保存将更新它的时间。")
    : syncDraft.q === model.totalQ
      ? tr("目标：乐谱结束位置。")
      : tr`目标：第 ${$("syncMeasure").value} 小节，第 ${$("syncBeat").value} 拍。`;
  $("syncError").hidden = true;
}
function openSyncPoint(index = null) {
  const r = recording();
  if (!r || audio.readyState < 1 || !Number.isFinite(audio.duration))
    return toast(tr("请先添加 MP3，并等待录音载入。"));
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
  $("syncTitle").textContent = index == null ? tr("添加同步点") : tr("编辑同步点");
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
  const duration = durationSeconds(),
    t = currentSeconds();
  $("elapsed").textContent = fmt(t, true);
  $("totalTime").textContent = fmt(duration);
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
  const left = 10,
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
}
function frame() {
  updateDragSelection();
  if (playing && model) {
    cursorQ = currentQ();
    selectAtQ(cursorQ);
    if ($("playheadMode").value === "smooth") revealSelection(true);
    if (!recording() && cursorQ >= model.totalQ - 0.0001) pause();
  }
  if (model) drawWave();
  requestAnimationFrame(frame);
}

function setupSidebar() {
  const key = "localtab.sidebarCollapsed";
  let collapsed = window.matchMedia("(max-width: 780px)").matches;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) collapsed = saved === "true";
  } catch {
    // Layout controls still work when browser storage is unavailable.
  }
  const apply = () => {
    $("librarySidebar").hidden = collapsed;
    $("workspace").classList.toggle("sidebar-collapsed", collapsed);
    $("toggleSidebar").setAttribute("aria-expanded", String(!collapsed));
    const action = collapsed ? tr("显示侧栏") : tr("隐藏侧栏");
    $("toggleSidebar").title = action;
    $("toggleSidebar").setAttribute(
      "aria-label",
      tr`${action}：本地谱库、乐器与小节导航`,
    );
  };
  $("toggleSidebar").onclick = () => {
    collapsed = !collapsed;
    apply();
    try {
      localStorage.setItem(key, String(collapsed));
    } catch {
      // Keep the current session usable without persistent preferences.
    }
  };
  apply();
  onLanguageChange(apply);
}

function setup() {
  setupSidebar();
  setupParts();
  try {
    const mode = localStorage.getItem("localtab.playheadMode");
    if (["smooth", "step"].includes(mode)) $("playheadMode").value = mode;
  } catch { /* Optional preference. */ }
  $("playheadMode").onchange = () => {
    try { localStorage.setItem("localtab.playheadMode", $("playheadMode").value); } catch {}
    smoothScrollPosition = null;
    followedBar = -1;
    followScrollLeft = null;
    moveCursor();
  };
  let newTitleEdited = false;
  $("newTitle").value = tr("新乐谱");
  $("newTitle").addEventListener("input", () => { newTitleEdited = true; });
  onLanguageChange(() => {
    // Keep pending tuning, toolbar and sync-row edits; updateUI refreshes their labels.
    const controls = [...document.querySelectorAll("input[id]:not([type=file]),select[id],textarea[id]")]
      .map((input) => ({ id: input.id, value: input.value, checked: input.checked }));
    const anchors = [...$("anchorRows").querySelectorAll("input")].map((input) => input.value);
    if (model) updateUI();
    for (const saved of controls) {
      const input = $(saved.id);
      input.value = saved.value;
      if (saved.checked !== undefined) input.checked = saved.checked;
    }
    [...$("anchorRows").querySelectorAll("input")].forEach((input, i) => { input.value = anchors[i]; });
    $("languageSelect").value = getLanguage();
    $("play").setAttribute("aria-label", playing ? tr("暂停") : tr("播放"));
    if (!newTitleEdited) $("newTitle").value = tr("新乐谱");
    $("toggleWaveform").textContent = $("waveformPanel").hidden ? tr("展开波形 ▾") : tr("收起波形 ▴");
    $("tabFocusState").textContent = $("editToolbar").classList.contains("keyboard-active")
      ? tr("TAB 键盘编辑已启用") : tr("点击 TAB 后直接输入数字");
    for (const id of ["saveState", "toast", "syncError"])
      $(id).textContent = retranslate($(id).textContent);
    if (syncDraft) {
      const errorHidden = $("syncError").hidden;
      $("syncTitle").textContent = syncDraft.editIndex == null ? tr("添加同步点") : tr("编辑同步点");
      updateSyncDraftHint();
      $("syncError").hidden = errorHidden;
    }
    if (model) drawWave();
  });
  try {
    const zoom = localStorage.getItem("localtab.scoreZoom");
    if ([...$("scoreZoom").options].some((o) => o.value === zoom))
      $("scoreZoom").value = zoom;
  } catch {
    // Use the readable default when browser storage is unavailable.
  }
  $("toggleWaveform").onclick = () => {
    const expanded = $("waveformPanel").hidden;
    $("waveformPanel").hidden = !expanded;
    $("toggleWaveform").setAttribute("aria-expanded", String(expanded));
    $("toggleWaveform").textContent = expanded ? tr("收起波形 ▴") : tr("展开波形 ▾");
    drawWave();
  };
  $("scoreZoom").onchange = () => {
    api.settings.display.scale = Number($("scoreZoom").value);
    api.updateSettings();
    if (model) renderScore();
    try {
      localStorage.setItem("localtab.scoreZoom", $("scoreZoom").value);
    } catch {
      // Zoom remains usable without persistent preferences.
    }
  };
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
      scale: Number($("scoreZoom").value),
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
      if (e.button !== 0) return;
      dragSelection = null;
      pointerInfo = {
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
        type: e.pointerType,
      };
      focusEditor();
    },
    true,
  );
  api.beatMouseDown.on((beat) => {
    pause();
    const part = model.partInfos[beat.voice.bar.staff.track.index];
    if (part && part.id !== model.activePartId) {
      if (syncDraft) return;
      switchPart(part.id, false);
    }
    const noteIndex = model.editable ? beat.index : Math.max(0,
      model.measures[beat.voice.bar.index]?.notes.findLastIndex((event) =>
        event.q <= model.measures[beat.voice.bar.index].q + beat.playbackStart / 960) ?? 0);
    select(beat.voice.bar.index, noteIndex, true, !!pointerInfo?.shift && model.editable);
    const layout = tabLayout(beat);
    if (layout && pointerInfo) {
      const y =
          pointerInfo.y - api.canvasElement.element.getBoundingClientRect().top,
        row = Math.round((y - layout.top) / layout.gap);
      if (row >= 0 && row < model.tuning.length) selectedString = row + 1;
    }
    updateSelection();
    if (model.editable && !syncDraft && pointerInfo && pointerInfo.type !== "touch") {
      dragSelection = {
        x: pointerInfo.x,
        y: pointerInfo.y,
        originX: pointerInfo.x,
        originY: pointerInfo.y,
        anchor: rangeStart ?? model.notes.indexOf(model.event(mi, ni)),
        active: false,
      };
    }
    focusEditor();
  });
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!dragSelection) return;
      if (!(e.buttons & 1)) {
        finishDragSelection();
        return;
      }
      dragSelection.x = e.clientX;
      dragSelection.y = e.clientY;
      if (
        Math.hypot(
          e.clientX - dragSelection.originX,
          e.clientY - dragSelection.originY,
        ) < 5 &&
        !dragSelection.active
      )
        return;
      dragSelection.active = true;
      rangeStart = dragSelection.anchor;
      $("scoreViewport").classList.add("selecting");
      e.preventDefault();
      updateDragSelection();
    },
    { passive: false },
  );
  window.addEventListener("pointerup", finishDragSelection);
  window.addEventListener("pointercancel", finishDragSelection);
  window.addEventListener("blur", finishDragSelection);
  document.addEventListener("copy", (e) => {
    if (!buttonCopy && !clipboardScope(e.target)) return;
    const text = buttonCopy?.text || copySelectedNotes();
    if (text && e.clipboardData) {
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      if (buttonCopy) buttonCopy.delivered = true;
    }
  });
  document.addEventListener("paste", (e) => {
    if (!clipboardScope(e.target)) return;
    e.preventDefault();
    pasteSelectedNotes(e.clipboardData?.getData("text/plain") || "");
  });
  $("copyNotes").onclick = () => {
    const text = copySelectedNotes();
    if (!text) return;
    // A selected textarea gives native copy real text on ordinary LAN HTTP.
    // Keep the in-page clipboard if OS clipboard access is blocked.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("aria-label", tr("复制乐谱片段"));
    field.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.append(field);
    field.select();
    buttonCopy = { text, delivered: false };
    try {
      document.execCommand("copy");
    } catch {}
    const copied = buttonCopy.delivered;
    buttonCopy = null;
    field.remove();
    focusEditor();
    if (!copied) {
      const fallback = () =>
        toast(tr("已复制到本页，可点粘贴；跨窗口复制请使用 Ctrl/Cmd+C"));
      if (navigator.clipboard?.writeText)
        navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    }
  };
  $("pasteNotes").onclick = () => {
    if (noteClipboard) pasteSelectedNotes(noteClipboard);
  };
  api.noteMouseDown.on((note) => {
    selectedString = model.tuning.length - note.string + 1;
    updateSelection();
    focusEditor();
  });
  api.postRenderFinished.on(() => {
    followedBar = -1;
    followScrollLeft = null;
    revealSelection(false);
    drawSelection();
  });
  api.error.on((e) => toast(tr("排版引擎：") + e.message, true));
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
    $("tabFocusState").textContent = tr("TAB 键盘编辑已启用");
    $("editToolbar").classList.add("keyboard-active");
  });
  $("scoreViewport").addEventListener("blur", () => {
    $("tabFocusState").textContent = tr("点击 TAB 后直接输入数字");
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
      .then(() => toast(tr("已保存到本地谱库")))
      .catch((e) => toast(e.message, true));
  setupPublishing({
    getProject: () => ({
      id: projectId,
      revision,
      title: project?.title || "",
    }),
    flushSave,
    request,
    pause,
    toast,
    hasDraft: () => !!syncDraft,
  });
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
      toast(tr("无法加载音频。若从 Git LFS 克隆，请先下载音频实体。"), true);
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
      toast(tr("同步点已保存到本机"));
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
        toast(tr("已移除同步点，可撤销"));
      } catch (e) {
        toast(e.message, true);
      }
    }
  };
  $("copyAnchors").onclick = () =>
    mutateSync(() => {
      const from = project.recordings.find((r) => r.id === $("copyFrom").value);
      if (!from) throw Error(tr("没有其他录音可复制"));
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
      toast(tr("同步点时间已固定；保存或取消后可跳转录音。"));
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
      const url = "/print.html?project=" + encodeURIComponent(projectId) + "&lang=" + getLanguage() + "&tracks=" + visibleTrackIndices().join(",");
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
      toast(tr("乐谱已导入本地谱库"));
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
        if (f.size > 80_000_000) throw Error(tr`${f.name} 超过单文件 80 MB 限制`);
        const objectUrl = URL.createObjectURL(f),
          temp = new Audio();
        try {
          await new Promise((resolve, reject) => {
            temp.onloadedmetadata = resolve;
            temp.onerror = () => reject(Error(tr`无法读取 ${f.name}`));
            temp.src = objectUrl;
            temp.load();
          });
          if (!Number.isFinite(temp.duration) || temp.duration <= 0)
            throw Error(tr`${f.name} 的音频时长不可用`);
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
            throw Error(tr`未能添加 ${f.name}`);
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
          ? tr`已保存 ${savedCount} 份录音。${failure}；已停止后续导入。`
          : tr`${savedCount} 份录音已保存；切换音频来源，分别添加同步点。`,
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
    if (
      $("publishDialog").open || $("partDialog").open ||
      e.target.closest("#toggleSidebar,#toggleWaveform")
    )
      return;
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
    if (!e.target.closest("#scoreViewport,#editToolbar")) return;
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
      if (e.shiftKey) pause();
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
    drawSelection();
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
  saveStatus(tr("打开失败"), true);
  toast(e.message, true);
  console.error(e);
}
