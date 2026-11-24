/** Local behaviour test for dsh-runs-log — no DSH host needed (the plugin has no @deepseek-ai imports). */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, createTool, defaultRunsDir, fileNameFrom, inject, name } from '../index.js'

const results = []
function check(label, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) process.exitCode = 1
}

// 1) 模块契约
check('inject 含 tools', Array.isArray(inject) && inject.includes('tools'))
check('name 正确', name === 'dsh-runs-log')
check('默认目录在 ~/.dsh/runs 下', defaultRunsDir().replace(/\\/g, '/').endsWith('/.dsh/runs'))
check('文件名清洗竖线/斜杠', fileNameFrom('a/b|c') === 'a_b_c.md')
check('文件名剥离尾部点', fileNameFrom('任务..') === '任务.md')

let rejected = false
try {
  fileNameFrom('..')
} catch {
  rejected = true
}
check('非法任务名抛错', rejected)

// 2) apply 注册
const dir = await mkdtemp(join(tmpdir(), 'runs-log-'))
const registered = []
apply({ tools: { register: (def) => registered.push(def) }, effect: () => {} }, { runsDir: dir })
check('apply 注册了 1 个工具', registered.length === 1)
check('工具名 runs_log', registered[0]?.name === 'runs_log')
check('必填参数', registered[0]?.parameters?.task?.required === true && registered[0]?.parameters?.status?.required === true)
check('有 render', typeof registered[0]?.output?.render === 'function')

// 3) 行为
const tool = createTool({ runsDir: dir })
const out1 = await tool.execute({ task: '冒烟 测试', status: '开始', note: '带 | 竖线 and\n换行' })
const file = join(dir, '冒烟 测试.md')
const text1 = await readFile(file, 'utf8')
check('首次写入建表头', text1.startsWith('| 时间 | 状态 | 说明 |') && /已追加 1 行/.test(out1))
check('竖线被替换', text1.includes('｜') && !text1.includes('| 带 | 竖线'))
check('换行被压平', text1.split('\n').filter((line) => line.startsWith('| 20')).length === 1)

const out2 = await tool.execute({ task: '冒烟 测试', status: '结束', note: '收尾', digest: '完成；改动 4 文件', show: 5 })
check('digest 追加两行', (await readFile(file, 'utf8')).split('\n').filter((line) => line.startsWith('| 20')).length === 3)
check('show 返回近期行', out2.includes('最近 3 行（共 3 个数据行）'))

const out3 = await tool.execute({ task: '../逃逸', status: '进度', note: 'x' })
check('穿越名落到目录内', out3.includes('.._逃逸.md') || (!out3.includes('..\\') && out3.includes(dir)))

await rm(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log(process.exitCode ? '\n有失败项' : '\n全部通过')
