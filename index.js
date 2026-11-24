/**
 * dsh-runs-log — append-only run log for DeepSeek Harness.
 *
 * One tool (`runs_log`) appends one Markdown table row to
 * `<runsDir>/<task>.md`, creating the file and its header when missing.
 *
 * Design notes
 * - No imports from @deepseek-ai/*: the tool definition is a plain object that
 *   `ctx.tools.register` accepts, so the plugin resolves without peer packages.
 * - The host process runs outside the workspace sandbox, so the tool can append
 *   to log files that subprocesses are denied.
 * - Append-only by construction: nothing is rewritten, truncated, or reordered,
 *   and an existing table header is never replaced.
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HEADER = '| 时间 | 状态 | 说明 |\n|---|---|---|'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const STATUSES = ['开始', '进度', '结束', '对账', 'digest', '降级', '事故']

/** `~/.dsh/runs` on any platform, so the default is not tied to one machine. */
export function defaultRunsDir() {
  return join(homedir(), '.dsh', 'runs')
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

/** Local wall-clock stamp in an IANA timezone, `yyyy-MM-dd HH:mm`. */
function stamp(timeZone) {
  const now = new Date()
  const read = (zone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${pad(get('month'))}-${pad(get('day'))} ${pad(get('hour'))}:${pad(get('minute'))}`
  }
  try {
    return read(timeZone)
  } catch {
    return read(DEFAULT_TIMEZONE)
  }
}

/** Keep a row on one line and keep the table intact. */
function cell(text) {
  return String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '｜')
    .trim()
}

/** A file name that survives Windows, without letting `..` escape the runs dir. */
export function fileNameFrom(task) {
  const cleaned = String(task ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.+$/, '')
    .trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error('task 为空或无法转成文件名：请传入任务名，如 "dsh-runs-log上架"')
  }
  return `${cleaned}.md`
}

async function ensureHeader(file) {
  try {
    const info = await stat(file)
    if (info.size === 0) {
      await appendFile(file, `${HEADER}\n`, 'utf8')
      return true
    }
    const text = await readFile(file, 'utf8')
    if (!text.endsWith('\n')) await appendFile(file, '\n', 'utf8')
    return false
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await appendFile(file, `${HEADER}\n`, 'utf8')
      return true
    }
    throw error
  }
}

async function tailRows(file, count) {
  const text = await readFile(file, 'utf8')
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s\-:|]+\|$/.test(line))
  const body = rows.slice(1)
  return { rows: body.slice(-count), total: body.length }
}

/** Build the tool definition bound to one runs directory. */
export function createTool({ runsDir, timeZone = DEFAULT_TIMEZONE }) {
  return {
    name: 'runs_log',
    description:
      "Append one row to this workspace's run log (an append-only Markdown table). " +
      'Creates `<runsDir>/<task>.md` with a header when missing. Use it for start / progress / ' +
      'end / reconciliation / digest rows instead of shelling out to a file appender. ' +
      'Never rewrites or truncates existing content.',
    parameters: {
      task: {
        type: 'string',
        required: true,
        description: '任务名，决定日志文件名，如 "dsh-runs-log上架"；与已有文件名一致可续写同一份',
      },
      status: {
        type: 'string',
        required: true,
        description: `行状态，取 ${STATUSES.join(' / ')} 之一`,
      },
      note: {
        type: 'string',
        description: '一句话说明；换行会压成空格，竖线会替换成全角｜以保表格完整',
      },
      digest: {
        type: 'string',
        description: '可选。给出时额外追加一行 digest（结束摘要），建议写 "<结论一句话>；改动 N 文件"',
      },
      show: {
        type: 'number',
        description: '可选。返回最近 N 行数据行用于核对，默认 0（只返回本次追加）',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const status = cell(args.status)
      if (status === '') throw new Error('status 不能为空')

      await mkdir(runsDir, { recursive: true })
      const file = join(runsDir, fileNameFrom(args.task))
      const lines = [`| ${stamp(timeZone)} | ${status} | ${cell(args.note)} |`]
      if (typeof args.digest === 'string' && args.digest.trim() !== '') {
        lines.push(`| ${stamp(timeZone)} | digest | ${cell(args.digest)} |`)
      }

      await ensureHeader(file)
      for (const line of lines) await appendFile(file, `${line}\n`, 'utf8')

      const out = [`已追加 ${lines.length} 行 → ${file}`, ...lines]
      const show = Number(args.show)
      if (Number.isFinite(show) && show > 0) {
        const { rows, total } = await tailRows(file, Math.floor(show))
        out.push('', `最近 ${rows.length} 行（共 ${total} 个数据行）：`, ...rows)
      }
      return out.join('\n')
    },
  }
}

export function apply(ctx, config) {
  const runsDir = String(config?.runsDir ?? defaultRunsDir())
  const timeZone = String(config?.timeZone ?? DEFAULT_TIMEZONE)
  ctx.effect?.(() => () => {}, 'dsh-runs-log teardown')
  ctx.tools.register(createTool({ runsDir, timeZone }))
}

export const inject = ['tools']
export const name = 'dsh-runs-log'
