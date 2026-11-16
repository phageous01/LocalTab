# 原创示例

[English](README.md) · [返回 LocalTab](../README.zh-CN.md)

这些短练习是为 LocalTab 生成的原创示例，适用本仓库的 MIT 许可证，
不包含导入的歌曲或录音。

| 文件 | 乐器 | 用途 |
| --- | --- | --- |
| [five-string-bass.musicxml](five-string-bass.musicxml) | 五弦贝斯 | 休止符、调弦、延音线和死音 |
| [guitar-chords.musicxml](guitar-chords.musicxml) | 六弦吉他 | 同一时值的多弦和弦 |

启动 LocalTab，在顶栏选择 **简体中文**，点击 **导入乐谱** 并选择任一文件。
可以添加自己的 MP3 练习同步；没有录音时，也可使用基础合成预览。

在仓库根目录运行以下命令，可重新生成示例和合成测试样本：

```sh
python scripts/generate_examples.py
```
