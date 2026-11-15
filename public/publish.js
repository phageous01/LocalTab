// A preview is an immutable server snapshot. Publish uses that snapshot only.
export function setupPublishing({ getProject, flushSave, request, pause, toast, hasDraft }) {
  const $ = (id) => document.getElementById(id);
  let capture = null, generation = 0, committing = false;
  const message = (text, error = false) => {
    $("publishProgress").textContent = text;
    $("publishProgress").classList.toggle("publish-error", error);
  };
  const close = () => {
    if (committing) return;
    generation++;
    $("publishDialog").close();
    $("publishPreview").removeAttribute("src");
  };
  async function prepare() {
    const run = ++generation;
    capture = null;
    $("publishConfirm").disabled = true;
    $("publishConfirm").hidden = false;
    for (const name of ["publishPreview", "publishPreviewLink", "publishResult", "publishRetry"]) $(name).hidden = true;
    try {
      message("正在保存并生成完整 PDF 预览…");
      await flushSave();
      if (run !== generation) return;
      const project = getProject();
      const status = await request(`/api/publish/status/${project.id}`);
      if (run !== generation) return;
      if (!status.ready) throw Error(status.error);
      $("publishDestination").textContent = `${project.title} → ${status.repository}`;
      const preview = await request(`/api/publish/prepare/${project.id}`, {
        method: "POST", body: JSON.stringify({ revision: project.revision }),
      });
      if (run !== generation) return;
      capture = { ...preview, projectId: project.id };
      $("publishPreview").src = preview.previewUrl + "#toolbar=0";
      $("publishPreviewLink").href = preview.previewUrl;
      $("publishPreview").hidden = $("publishPreviewLink").hidden = false;
      $("publishConfirm").disabled = false;
      message(status.lastPublished ? "预览已就绪。发布后将更新已有曲谱及 PDF。" : "预览已就绪。点击发布后会出现在公开曲谱库中。");
    } catch (error) {
      if (run !== generation) return;
      message(error.message, true);
      $("publishRetry").hidden = false;
    }
  }
  $("publishScore").onclick = () => {
    if (!getProject().id) return;
    if (hasDraft()) return toast("请先保存或取消当前同步点，再发布乐谱。", true);
    pause();
    $("publishDestination").textContent = getProject().title;
    $("publishDialog").showModal();
    prepare();
  };
  $("publishClose").onclick = close;
  $("publishDialog").addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  $("publishRetry").onclick = prepare;
  $("publishConfirm").onclick = async () => {
    if (!capture || committing) return;
    committing = true;
    $("publishConfirm").disabled = $("publishClose").disabled = true;
    message("正在发布 MusicXML、PDF 并更新公开目录…");
    try {
      const result = await request(`/api/publish/commit/${capture.projectId}`, {
        method: "POST", body: JSON.stringify({ draftId: capture.draftId }),
      });
      $("publishedPage").href = result.url;
      $("publishedPdf").href = result.pdfUrl;
      $("publishedXml").href = result.xmlUrl;
      $("publishResult").hidden = false;
      $("publishConfirm").hidden = true;
      message("发布成功，MusicXML 与 PDF 已同时更新。可使用下方固定链接分享。");
    } catch (error) {
      message(error.message, true);
      $("publishConfirm").disabled = false;
      $("publishRetry").hidden = false;
    } finally {
      committing = false;
      $("publishClose").disabled = false;
    }
  };
}
