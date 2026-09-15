<div style="text-align: center;"> 

# Repeater Web UI

![LICENSE](https://img.shields.io/badge/license-MIT-blue.svg) ![AIGenerated](https://img.shields.io/badge/AI-Generated-yellow.svg) 

</div>

## 介绍

本项目是一个适用于[Repeater](https://github.com/repeater-bot/repeater-ai-bot) 的 Web UI 形式的客户端适配器。
可以提供交互式的 API 操作界面，方便用户快速地操作 Repeater 的 API。

## 安装

首先，请确保你已经部署好 Repeater
然后，按照以下步骤安装 Web UI：

1. 克隆此仓库到本地
2. 进入项目目录：<span title="以克隆出来的目标目录为准">`cd repeater-web-ui` </span>
3. 下载依赖项：<span title="curl -fsSL &quot;https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js&quot; -o &quot;web/vendor/chart.min.js&quot;"> [chart.js](https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js) </span> and <span title="curl -fsSL &quot;https://cdn.jsdelivr.net/npm/marked/marked.min.js&quot; -o &quot;web/vendor/marked.min.js&quot;"> [marked](https://cdn.jsdelivr.net/npm/marked/marked.min.js) </span> (可以执行 [`download_vendor.sh`](./download_vendor.sh) 或 [`download_vendor.ps1`](./download_vendor.ps1) 来下载)
4. 在 Repeater 主服务器下新建一个 <span title="可自定义位置，但要保证与配置一致"> `web` </span> 目录
5. 进入项目配置，修改 `web.index_web_file` 为 `./web/index.html` 让服务器能够将根路径映射到 `web/index.html` 文件
6. 修改配置字段 `web.web_directory` 为 `./web`，让服务器能够将 `/web` 路由下的所有请求都映射到 `./web` 目录下
7. 运行 Repeater （如果已经运行，则重载配置即可）

运行成功后，访问 Repeater 服务器的根路径，即可看到 Web UI。

## License

本项目使用 [MIT](./LICENSE) 许可证。