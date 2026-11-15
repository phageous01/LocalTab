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
