# Third-party notices / 第三方声明

LocalTab's own code, documentation and generated examples use the [MIT license](LICENSE).
Vendored components keep their original licenses; they are not relicensed under MIT.

LocalTab 自身的代码、文档和生成的原创示例使用 [MIT 许可证](LICENSE)。
以下第三方组件保留原许可证，不因本项目使用 MIT 而改变。

| Component / 组件 | Version / 版本 | License / 许可证 | Source / 源码 |
| --- | --- | --- | --- |
| alphaTab | 1.9.0 | [MPL-2.0](vendor/package/LICENSE) | [Upstream version 1.9.0](https://github.com/CoderLine/alphaTab/tree/v1.9.0) |
| @xmldom/xmldom | 0.9.12 | [MIT](vendor/xmldom/package/LICENSE) | [Upstream version 0.9.12](https://github.com/xmldom/xmldom/tree/0.9.12) |
| Bravura font | Bundled with alphaTab / 随 alphaTab 分发 | [SIL OFL 1.1](vendor/package/dist/font/Bravura-OFL.txt) | [Steinberg Bravura](https://github.com/steinbergmedia/bravura) |
| Sonivox soundfont | Bundled with alphaTab / 随 alphaTab 分发 | [Apache-2.0 notice](vendor/package/dist/soundfont/LICENSE), [full license](vendor/package/dist/soundfont/Apache-2.0.txt) | [alphaTab upstream](https://github.com/CoderLine/alphaTab/tree/v1.9.0) |

The alphaTab library files are included unmodified, with the full Apache-2.0
license additionally included for the bundled soundfont. Its source is available at the
versioned upstream link above, including the MPL-covered files. Integrated
TinySoundFont and SFZero notices are retained in
[LICENSE.header](vendor/package/LICENSE.header) and the distribution files.
All bundled font and soundfont notices are retained. The renderer's attribution
remains visible in the score and print output.

alphaTab 使用未修改的官方发行包。对应版本的源码（包括 MPL 覆盖的文件）可从上面的链接获取。
TinySoundFont、SFZero 等集成组件的声明保留在原发行包中；字体及音色的许可证亦保留。
谱面及打印输出保留渲染器的署名。

Files in the separate LocalTab-Scores repository have their own rights context;
this software license does not grant rights to third-party compositions or recordings.
独立 LocalTab-Scores 仓库的乐谱不自动适用本软件的 MIT 许可证。
