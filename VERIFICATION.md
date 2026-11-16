# Verification / 验证记录

Publication baseline: **0.8.0**, checked **2026-11-15** on Windows with Node.js
24.22.1 and Python 3.12.14. The app requires Python 3.10+; other Python versions and
server operating systems have not all been exercised in this baseline.

本次发布基线为 **0.8.0**，于 **2026-11-15** 在 Windows 上验证。自动化测试使用
Node.js 24.22.1 和 Python 3.12.14。最低要求为 Python 3.10，但没有逐一测试所有版本和服务器系统。

## Automated checks / 自动化检查

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "*_test.py"
```

- **40 JavaScript tests passed.** MusicXML/alphaTab round trips; tuning, rhythms,
  ties and dead notes; triplets and techniques; chord entry and deletion;
  structural edits; zero/one/multiple sync points; tempo changes; frozen sync
  drafts; timestamp parsing; independent recording maps.
- **10 HTTP tests passed.** New scores and meter/tempo validation; MusicXML/MXL
  imports; audio upload and range responses; save/reload and revision conflicts;
  metadata persistence; host, origin and write-token checks; path containment.
- **10 publishing tests passed.** One-commit XML/PDF/catalog updates, preserved
  manual notes, repeat submission, concurrent remote changes, lost responses,
  stale previews, destination changes, private repositories, path collisions and PDF failure.
- The regression score is generated from scratch in
  [scripts/generate_examples.py](scripts/generate_examples.py): 80 measures,
  316 pitched notes, 8 ties and 2 dead notes. It contains no imported song.
- HTTP tests use a temporary library and do not modify a user's real library.

**40 项 JavaScript、10 项 HTTP、10 项发布测试通过。** 覆盖和弦、时值、奏法、导入导出、
零/单/多同步点、速度变化、固定时间戳、保存冲突、音频上传及局域网请求校验。
测试样本是从零生成的合成数据；HTTP 测试只使用临时谱库。

## Selection and layout update / 选区与布局更新

After the 0.8 publication baseline, **52 JavaScript tests passed** (12 new clipboard
cases). Added checks cover chords, rests, markings, tuplets, cross-bar ties, different
meters and tunings, appended measures, preserved tempo positions and untouched note
annotations, and atomic rejection of invalid fragments. The HTTP/publishing checks
above describe the earlier baseline; those backend modules were unchanged in this update.

Browser checks used an isolated original guitar exercise over LAN HTTP: mouse drag
across measures, edge scrolling, Shift+arrow extension/shrinking, keyboard copy/paste,
cross-tab paste, in-page buttons, undo/redo, and saved MusicXML chord contents. Compact
layout, sidebar persistence, zoom and playback following were also checked.

0.8 发布之后，**52 项 JavaScript 测试通过**，新增 12 项剪贴板测试，覆盖和弦、休止、奏法、
三连音、跨小节延音、不同拍号与调弦、末尾补小节、速度位置、保留选区外标记，以及无效片段不修改乐谱。
本次没有修改后端，上述 HTTP / 发布测试记录仍对应原发布基线。
使用独立原创吉他练习谱和局域网 HTTP 地址验证了拖选、边缘滚动、Shift 扩大/缩小选区、
键盘复制粘贴、跨标签页粘贴、页内按钮、撤销/重做及保存后的 MusicXML 和弦内容。
紧凑布局、侧栏记忆、缩放与播放跟随也已完成浏览器验证。

## Manual checks and scope / 人工验证及范围

Version 0.8: the Chrome UI completed a real publication to a public score
repository. An 80-measure score produced a four-page A4 PDF; all pages were rendered
and visually checked, including the title, rhythmic TAB, final measures and page numbers.
The public XML/PDF links and bilingual index were checked after publication.

0.8 版本已从 Chrome 页面实际完成一次公开发布。80 小节谱面生成 4 页 A4 PDF，
逐页检查了标题、TAB 时值、最后小节和页码，并核对公开 XML/PDF 链接及双语目录。

During prototype development, the Windows Chrome UI was exercised for direct TAB
entry, chords, rhythmic rendering, horizontal playback, synchronization and
save/reload. A second computer running macOS successfully accessed the Windows
server over the LAN, including library and audio requests.

开发期间已在 Windows Chrome 中操作验证 TAB 输入、和弦、节奏显示、横向播放、同步及保存重载；
同一局域网的 macOS 设备也已成功访问 Windows 服务端及录音。

These checks do not establish compatibility with every MusicXML dialect, mobile
browser, printer, multi-voice score or simultaneous editing workflow. Known limits
are listed in both READMEs. Re-run tests after editor, timing or server changes;
audio and print behavior still need browser checks.

这些结果不代表所有 MusicXML 方言、移动浏览器、打印机、多声部或同时编辑场景均兼容。
修改编辑器、同步或服务端逻辑后应重跑测试；音频和打印仍需浏览器人工验证。


## Version 0.9 / 0.9 版本

- **61 JavaScript tests and 25 Python HTTP/publishing tests passed.** New tests cover translation placeholders, literal user content, blocked preference storage, static label updates without replacing inputs, active-part editing/copy-paste, whole-score meter/bar/tempo changes, atomic rejection, all-part publication snapshots, and frame-rate-independent continuous following.
- A read-only local migration audit loaded **34 multi-instrument scores / 90 parts**, including **52 editable parts**, through the editor and alphaTab. Track counts matched; selecting every part left serialized notation unchanged and retained the same global tempo map. No imported files were rewritten by this audit.
- The actual PDF preview service generated an original two-instrument, four-measure duet as a one-page A4 PDF. The rendered page was visually inspected: both instrument staves, rhythmic TAB, title and page number were present. No public score was published by this check.
- All static Chinese UI labels in the main and print HTML have English entries. Browser interaction verification of this update is incomplete: Windows Computer Use stopped because it could not reliably confirm the current Chrome URL. The tests above do not substitute for a live interaction/animation check.

**61 项 JavaScript 与 25 项 Python HTTP/发布测试通过。** 新增验证涵盖语言插值、保留用户文字、浏览器存储不可用、更新标签而不替换输入框、多乐器编辑与粘贴、全谱拍号/小节/速度修改、失败回滚、包含全部声部的发布快照和不同帧率下的连续滚动。
只读检查了本地 **34 首多乐器谱、90 个声部**，其中 **52 个声部符合当前编辑条件**；切换声部不改变乐谱或全谱速度映射，检查没有重写导入文件。
实际 PDF 预览服务生成了一份原创双乐器、四小节测试谱，输出为一页 A4；渲染后检查了两个乐器、节奏 TAB、标题与页码，未发布任何公开曲谱。
主页面与打印页面的中文静态标签均有英文条目。本轮浏览器交互验证尚未完成：Windows Computer Use 因无法可靠确认 Chrome 地址而中止。上述测试不等同于实际交互和动画效果验证。

## Library sorting and search / 谱库排序与搜索

- **65 JavaScript tests and 28 Python HTTP/publishing tests passed.** New checks cover all six sort orders, natural numeric title order, Unicode/case-insensitive partial search, literal punctuation, missing dates and invalid saved preferences. HTTP checks cover server-owned timestamps, creation/import/save behavior, metadata-only listing and legacy reads that leave files and revisions unchanged.
- Browser checks used the real **348-score library** in the in-app browser. Searching `TOE` returned six scores; title ascending/descending order, no matches, clear search, unchanged current score, English labels and preserved input, and created-ascending preference persistence after reload were verified. A screenshot confirmed the sidebar layout. This check did not edit existing scores.
- All running local endpoints returned 348 library summaries with both timestamps after restart. The new save behavior is covered by isolated HTTP tests; browser checks did not save changes to user scores.

**65 项 JavaScript 与 28 项 Python HTTP/发布测试通过。** 新增验证覆盖六种排序、曲名数字自然排序、忽略大小写与 Unicode 差异的片段搜索、标点、缺失时间和无效偏好；HTTP 测试验证服务端记录的时间、新建／导入／保存、仅读取元数据的列表，以及读取旧谱不改动文件或版本号。

在内置浏览器中使用真实的 **348 首谱库**验证：`TOE` 匹配六首，名字正反序、零结果、清空搜索、保持当前谱子、切换英文时保留输入、刷新后保留创建时间正序均正常，并通过截图检查侧栏布局。没有编辑现有乐谱。
重启后，各本地服务均返回带两个时间字段的 348 条记录；保存行为由隔离的 HTTP 测试验证，浏览器验证未向用户乐谱写入修改。

## Grace notes and open slides / 倚音与无指定端点滑音

**77 JavaScript tests and 28 Python HTTP/publishing tests passed.** Twelve new
regressions cover grace-note/chord editing and deletion, slashed/unslashed rendering,
display duration, unchanged written beats/tempo/synchronization, positive preview
durations, same-position hammer-ons, ties across grace groups, all four standard
open-slide articulations, per-string rendering and conflicting slide endpoints.
Clipboard checks include grace-only fragments, trailing graces before a preserved
tail, chords and paired techniques, cross-bar open-slide endpoints and meter trimming.
Unsupported explicit-time/trailing grace structures remain unmodified and view-only.

An isolated four-measure original study was exercised in the in-app browser:
toolbar and G entry, immediate fret input, slash toggle, Delete, undo, saving and
reopening, combined slide-in/out and English/Chinese labels. Saved XML contained
grace notes without duration elements and the standard open-slide articulations.
Editor and A4 print-view screenshots were visually checked. The print view used
the same display mapping as PDF export; no public score was published and no user
score was modified. These checks do not establish another editor's rendering or
realistic synthesized guitar techniques.

**77 项 JavaScript 与 28 项 Python HTTP/发布测试通过。** 新增 12 项回归验证，涵盖倚音／和弦的编辑删除、斜线与显示时值、谱面拍位／速度／同步不变、合成预览的正时长、同拍位击弦、跨倚音组延音、四种标准滑音、按弦渲染和滑音端点冲突。
复制粘贴覆盖纯倚音片段、以倚音结尾并接回原音尾部、和弦与连线、跨小节滑音端点及拍号截短。不支持的额外时间／小节末尾倚音结构保持查看模式且不重写。

在隔离谱库的原创四小节测试谱上，实际验证了工具栏／G 添加、立即输入品位、斜线切换、删除、撤销、保存重开、同音滑入加滑出及中英文标签。保存后的 XML 中倚音没有 duration 元素，滑音为标准奏法元素；通过截图检查编辑器及 A4 打印视图，后者与 PDF 导出共用显示映射。没有发布公开曲谱或修改用户乐谱；本次验证不代表其他软件的排版一致，也不保证真实的吉他合成奏法音色。
