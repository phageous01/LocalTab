# 发布乐谱

[English](PUBLISHING.md) · [返回 LocalTab](../README.zh-CN.md)

曲谱页面的 **发布** 会将当前乐谱发布到配置好的 GitHub 公开库，
同时提供 MusicXML 和完整的分页 PDF。

## 使用方式

1. 点击 **发布**，程序自动保存当前修改并生成 PDF 预览。
2. 检查乐谱、PDF 和目标仓库，点击 **发布到公开库**。
3. 成功后可以打开公开曲谱页面、PDF 和 MusicXML 链接。

发布会创建或更新 `scores/<曲谱名称>/score.musicxml`、`score.pdf` 和曲谱 README，
同时更新 `catalog.json` 和中英文曲谱目录。新目录以曲谱名称命名，重名时添加后缀区分。
已经发布的路径保持不变，之后修改曲名也不会改变链接。在其他平台推荐使用“公开曲谱页面”链接。
读者不需要记谱软件就能在 GitHub 上查看 PDF。

多乐器乐谱发布时，MusicXML 和完整 PDF 都包含全部声部，包括编辑器中暂时隐藏的乐器。
普通 **打印 / PDF** 则只输出当前勾选显示的乐器。

MusicXML、PDF 和目录通过**同一次提交**更新。MP3 和私人项目元数据不上传；
曲谱页面中 LocalTab 标记区域以外的手写说明会保留。遇到其他人同时更新仓库时会保留其改动并重试，
不强制覆盖 Git 历史。对同一个已完成的预览重试，不会重复创建提交。

预览对应生成时已保存的版本。其他窗口在发布前修改了乐谱，就需要重新生成预览。
普通 **保存** 仍然只保存到本地，**不会自动发布**。预览后直接关闭，不会更改公开库。
此功能不依赖 GitHub Actions。

## 服务端首次设置

以下操作只在运行 LocalTab 服务的电脑上进行；局域网客户端不需要安装额外工具。

1. 安装 [GitHub CLI](https://cli.github.com/)，执行 `gh auth login` 登录。
   该账号需要对目标仓库及分支拥有内容写入权限。
2. 在**运行 LocalTab 的同一个 Python 环境**安装 PDF 依赖：

   ```sh
   python -m pip install -r requirements-publish.txt
   ```

3. 服务端安装 Chrome 或 Edge。导出时会启动独立的无界面浏览器，
   不会使用你已登录的浏览器资料。也可以安装独立 Chromium：

   ```sh
   python -m playwright install chromium
   ```

4. 建立一个**公开**曲谱仓库，至少包含一次初始提交，例如 README。
   在 LocalTab 目录内创建 `.local/publish.json`：

   ```json
   {
     "repository": "你的GitHub用户名/LocalTab-Scores",
     "branch": "main"
   }
   ```

5. 重启 LocalTab，打开乐谱并点击 **发布**。

根据环境将 `python` 换为 `python3` 或 `py -3`。如果不想全局安装依赖，
也支持 `python -m pip install --target .local/python -r requirements-publish.txt`；
该目录中的依赖应与服务端实际使用的 Python 版本一致。

程序支持常规 GitHub CLI 配置及 `GH_CONFIG_DIR`，也会识别
`.local/tools/gh/bin/gh.exe` 和 `.local/github-cli/` 内的本地安装与登录配置。
授权信息只保留在服务端，不发送给浏览器，也不写入乐谱提交。

## 文件与故障处理

- `.local/publish/drafts/`：已固定版本的预览和生成的 PDF。
- `.local/publish/state.json`：本地项目与公开条目的关联；
  **搬迁安装时请将此文件与 `library/` 一起备份**。
- `.local/publish.json`：发布目标配置。代码仓库默认忽略整个 `.local/`。
- 缺少依赖或浏览器：请在服务端安装，局域网客户端无需安装。
- GitHub 授权或网络错误：检查 `gh auth status`、分支权限和网络，然后重试。
  上传响应不明确时，也可以安全重试。
- 预览过期：关闭窗口；若其他客户端修改过乐谱，重新加载后再生成预览。
- 同地址已有不同曲谱：程序拒绝覆盖。迁移安装时请恢复发布关联文件；
  如果远端 MusicXML 与本地完全一致，则可以自动接管并补上 PDF。
- PDF 使用 A4 打印排版，包含全部乐器；适用的声部保留 TAB 时值，并保留渲染器署名。

与已有的无登录局域网编辑相同，能访问此服务的设备都能使用其配置好的发布功能。
请在可信任的局域网使用。
