# dsh-runs-log

Append-only run log for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one tool call, one Markdown table row, no shell.

给会话装一支笔：写运行日志不再拼 shell 命令、不再担心中文编码、不再手抄时间戳。

## 它解决什么

如果要求 agent「每个任务留痕」，它就得往 `runs/<任务>.md` 追加一行表格。
在 DSH 里这件事通常靠 `pwsh -Command Add-Content ...` 完成，代价是：

- 引号、管道、中文在 shell 里要转义，一行日志写错三次；
- 控制台按 GBK 解码 UTF-8 脚本，中文可能变乱码；
- 子进程可能被工作区沙箱拦在日志目录之外；
- 写坏了没有校验，表格少一列才发现。

这个插件把「追加一行表格」变成原生工具：宿主进程内直接追加，参数先校验，文件名与竖线自动清洗，永不改写已有内容。

## 安装

插件市场（收录后）：

```sh
dsh plugin --profile <your-profile> add dsh-runs-log
```

本地目录（开发或自用）：让 agent 执行 `plugin_manager` 的 `install_bundle`，`target` 传本目录绝对路径；包会以链接方式装进 profile 并追加到 `dsh.profile.bundles`。

本包零依赖，`install_bundle` 不需要 `npm install`，也不需要构建步骤；`fiberPhase` 变 `active` 后工具即可用。

## 工具

`runs_log(task, status, note?, digest?, show?)`

| 参数 | 必填 | 说明 |
|---|---|---|
| `task` | 是 | 任务名，决定文件名 `<runsDir>/<task>.md`；非法字符转 `_`，结尾的点被剥掉，`..` 被挡 |
| `status` | 是 | `开始` / `进度` / `结束` / `对账` / `digest` / `降级` / `事故` |
| `note` | 否 | 一句话说明；换行压成空格，`|` 换成 `｜` 保表格完整 |
| `digest` | 否 | 给出时额外追加一行 `digest`，建议写「结论一句话；改动 N 文件」 |
| `show` | 否 | 返回最近 N 行数据行，用于核对 |

首次写入自动建表头：

```
| 时间 | 状态 | 说明 |
|---|---|---|
```

时间取 `Asia/Shanghai` 的本地墙钟，格式 `yyyy-MM-dd HH:mm`。**只追加**：不重写、不截断、不替换表头。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id 覆盖（整份 config 替换，需重述所有字段）：

```yaml
- id: runs-log
  config:
    runsDir: 'D:\workspace\.trae_state\runs'
    timeZone: Asia/Shanghai
```

| 字段 | 默认值 |
|---|---|
| `runsDir` | `~/.dsh/runs` |
| `timeZone` | `Asia/Shanghai` |

## 实现要点

- **不导入 `@deepseek-ai/*`**：工具定义是普通对象，`ctx.tools.register(...)` 直接接收，因此本地链接安装时不存在 peer 依赖解析问题，也不需要 pnpm 安装任何东西。
- **宿主进程内运行**，不受工作区沙箱限制——也因此只对 `runsDir` 动手，参数里不接受任意路径。
- 逻辑与宿主解耦：`createTool()` 是纯函数返回的工具定义，`test/smoke.mjs` 用假 ctx 即可跑完整行为测试。

```sh
node test/smoke.mjs
```

## 已知限制

- 只写不读：没有检索、没有 INDEX 重生成（那是脚本的活）。
- 不校验 `status` 与既有表是否一致，只兜底枚举。
- 每次调用都追加，重试会产生重复行；幂等由调用方控制。
- 时区不支持每文件不同，只有全局一个设置。

## License

MIT
