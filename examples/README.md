# Original examples / 原创示例

These short exercises are generated specifically for LocalTab and covered by the
repository's MIT license. They contain no imported songs or audio.

这些练习是为 LocalTab 生成的原创示例，适用本仓库的 MIT 许可证，不包含导入的歌曲或录音。

| File / 文件 | Instrument / 乐器 | Purpose / 用途 |
| --- | --- | --- |
| [five-string-bass.musicxml](five-string-bass.musicxml) | Five-string bass / 五弦贝斯 | Rests, tuning, ties and dead notes / 休止符、调弦、延音线、死音 |
| [guitar-chords.musicxml](guitar-chords.musicxml) | Six-string guitar / 六弦吉他 | Multiple notes at one position / 同一时值的多弦和弦 |

Start LocalTab, click **导入乐谱** (Import score), and choose either file.
Add your own MP3 if you want to try synchronization; the exercises also work
without audio using the basic synthesized preview.

启动 LocalTab，点击 **导入乐谱** 并选择一个文件。可以添加自己的 MP3 练习同步；
没有 MP3 时也可使用基础合成预览。

To regenerate these files and the synthetic test fixture / 重新生成示例及测试样本：

```sh
python scripts/generate_examples.py
```
