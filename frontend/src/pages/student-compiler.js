import { getMe } from '../api/auth.js'
import { getCompilerHistory, getCompilerTopic, judgeCCompiler, runCCompiler } from '../api/compiler.js'
import { getUser, getToken, setAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'

const LANGUAGE_OPTIONS = Object.freeze({
  c: {
    label: 'C 语言',
    monaco: 'c',
    defaultSource: `#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) return 0;\n    printf("%d\\n", a + b);\n    return 0;\n}\n`,
    templates: [
      { id: 'sum', label: '两数求和', stdin: '1 2', source: `#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n` },
      { id: 'loop', label: '循环输出', stdin: '', source: `#include <stdio.h>\n\nint main(void) {\n    for (int i = 1; i <= 5; i++) printf("%d ", i);\n    putchar('\\n');\n    return 0;\n}\n` },
    ],
  },
  python: {
    label: 'Python',
    monaco: 'python',
    defaultSource: `import sys\n\nvalues = list(map(int, sys.stdin.read().split()))\nif len(values) >= 2:\n    print(values[0] + values[1])\n`,
    templates: [
      { id: 'hello', label: 'Hello World', stdin: '', source: `print("Hello, DisciMind!")\n` },
      { id: 'sum', label: '两数求和', stdin: '1 2', source: `a, b = map(int, input().split())\nprint(a + b)\n` },
      { id: 'average', label: '列表平均值', stdin: '1 2 3', source: `values = list(map(float, input().split()))\nprint(sum(values) / len(values))\n` },
    ],
  },
})

function normalizeLanguage(language) { return LANGUAGE_OPTIONS[language] ? language : 'c' }
function sourceStorageKey(language) { return `discimind.compiler.source.${language}` }
function languageLabel(language) { return LANGUAGE_OPTIONS[normalizeLanguage(language)].label }

async function authUser() {
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { /* request layer handles redirects */ }
  return user
}

function statusLabel(status) {
  return ({ SUCCESS: '运行成功', COMPILE_ERROR: '编译失败', TIME_LIMIT_EXCEEDED: '运行超时', RUNTIME_ERROR: '运行异常', WRONG_ANSWER: '答案错误', SYSTEM_ERROR: '沙箱异常' })[status] || status || '未运行'
}

function statusClass(status) { return String(status || '').toLowerCase().replaceAll('_', '-') }

function editorHTML(source, language) {
  return `<div class="compiler-editor-shell"><div class="compiler-editor-toolbar"><span class="compiler-language-dot"></span><span id="compiler-language-label">${languageLabel(language)}</span><span class="compiler-editor-hint">在线沙箱运行</span></div><div id="compiler-editor" class="compiler-editor" data-source="${escapeHtml(source)}"><textarea id="compiler-source-fallback" spellcheck="false" aria-label="${languageLabel(language)}源代码">${escapeHtml(source)}</textarea></div></div>`
}

function historyHTML(items) {
  if (!items.length) return '<div class="compiler-empty">暂无编译记录</div>'
  return items.map((item) => `<button type="button" class="compiler-history-item" data-history-id="${item.id}"><span class="compiler-history-status status-${statusClass(item.status === 0 ? 'COMPILE_ERROR' : item.status === 1 ? 'SUCCESS' : item.status === 2 ? 'TIME_LIMIT_EXCEEDED' : 'RUNTIME_ERROR')}"></span><span class="compiler-history-copy"><b>${escapeHtml(item.topicTitle || '自由编译')} · ${escapeHtml(languageLabel(item.language))}</b><small>${new Date(item.createdAt).toLocaleString('zh-CN')}</small></span></button>`).join('')
}

function languageOptionsHTML(selectedLanguage) {
  return Object.entries(LANGUAGE_OPTIONS).map(([value, item]) => `<option value="${value}"${value === selectedLanguage ? ' selected' : ''}>${item.label}</option>`).join('')
}

function templateOptionsHTML(language) {
  return `<option value="">选择示例模板</option>${LANGUAGE_OPTIONS[language].templates.map((item) => `<option value="${item.id}">${item.label}</option>`).join('')}`
}

function pageHTML({ source, topic, history, language }) {
  const isJudge = Boolean(topic)
  return `<section class="compiler-page"><header class="compiler-page-head"><div><span class="compiler-eyebrow">STUDENT CODE LAB</span><h1>${isJudge ? escapeHtml(topic.title) : `在线${languageLabel(language)}编译器`}</h1><p>${isJudge ? escapeHtml(topic.description || '完成题目后提交代码，系统会自动运行全部测试样例。') : '自由编写、运行和回溯代码，所有程序都在隔离沙箱中执行。'}</p></div><div class="compiler-mode-badge">${isJudge ? '编程习题模式' : '自由编译器'}</div></header>${topic ? `<section class="compiler-samples"><div><b>测试样例</b><span>${topic.testCases?.length || 0} 组</span></div><div class="compiler-sample-list">${(topic.testCases || []).map((item) => `<span>样例 ${item.index}：${escapeHtml(item.input || '无输入')}</span>`).join('')}</div></section>` : ''}<div class="compiler-workspace"><main class="compiler-main-column">${editorHTML(source, language)}<section class="compiler-console"><header><div><b>控制台</b><span id="compiler-status" class="compiler-status-chip">等待运行</span></div><span class="compiler-console-note">输出 / 编译诊断</span></header><div id="compiler-output" class="compiler-output"><div class="compiler-output-placeholder">点击“编译运行”查看程序输出和错误信息。</div></div></section></main><aside class="compiler-side-panel"><div class="compiler-side-actions"><button class="compiler-run-button" id="compiler-run" type="button">编译运行</button>${isJudge ? '<button class="compiler-judge-button" id="compiler-judge" type="button">提交判题</button>' : ''}<button class="compiler-ghost-button" id="compiler-clear" type="button">清空代码</button></div><div class="compiler-language-controls"><label class="compiler-input-label" for="compiler-language">编程语言<select id="compiler-language">${languageOptionsHTML(language)}</select></label><label class="compiler-input-label" for="compiler-template">示例模板<select id="compiler-template">${templateOptionsHTML(language)}</select></label><button class="compiler-template-button" id="compiler-load-template" type="button">载入模板</button></div>${!isJudge ? '<label class="compiler-input-label" for="compiler-stdin">自定义输入<textarea id="compiler-stdin" placeholder="例如：1 2"></textarea></label>' : ''}<section class="compiler-history"><header><b>编译历史</b><button type="button" id="compiler-refresh-history" title="刷新历史">刷新</button></header><div id="compiler-history-list">${historyHTML(history)}</div></section></aside></div></section>`
}

async function loadMonaco(host, source, language, onChange) {
  const fallback = host.querySelector('#compiler-source-fallback')
  try {
    const [monaco, workerModule] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.api'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    ])
    globalThis.MonacoEnvironment = { getWorker: () => new workerModule.default() }
    await Promise.all([
      import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'),
      import('monaco-editor/esm/vs/basic-languages/python/python.contribution'),
    ])
    const editor = monaco.editor.create(host, { value: source, language: LANGUAGE_OPTIONS[language].monaco, theme: 'vs', automaticLayout: true, minimap: { enabled: false }, fontSize: 14, tabSize: 4, insertSpaces: true, scrollBeyondLastLine: false })
    fallback?.remove()
    editor.onDidChangeModelContent(() => onChange(editor.getValue()))
    return { getValue: () => editor.getValue(), clear: () => editor.setValue(''), setValue: (value) => editor.setValue(value), setLanguage: (nextLanguage) => monaco.editor.setModelLanguage(editor.getModel(), LANGUAGE_OPTIONS[nextLanguage].monaco) }
  } catch {
    if (fallback) { fallback.value = source; fallback.addEventListener('input', () => onChange(fallback.value)) }
    return { getValue: () => fallback?.value || '', clear: () => { if (fallback) fallback.value = '' }, setValue: (value) => { if (fallback) fallback.value = value }, setLanguage: () => {} }
  }
}

export async function renderStudentCompiler(app) {
  const user = await authUser()
  if (!user) return
  const query = new URLSearchParams((window.location.hash.split('?')[1] || ''))
  const topicId = query.get('topicId') || query.get('questionId')
  let topic = null
  let selectedLanguage = normalizeLanguage(localStorage.getItem('discimind.compiler.language'))
  const languageSourceKey = (language) => sourceStorageKey(language)
  let source = localStorage.getItem(languageSourceKey(selectedLanguage)) || (selectedLanguage === 'c' ? localStorage.getItem('discimind.compiler.source') : '') || LANGUAGE_OPTIONS[selectedLanguage].defaultSource
  let history = []
  try {
    const [historyResult, topicResult] = await Promise.all([getCompilerHistory({ topicId: topicId || undefined }), topicId ? getCompilerTopic(topicId) : Promise.resolve(null)])
    history = historyResult.data?.list || []
    topic = topicResult?.data || null
  } catch { /* page remains usable while history or optional topic data is unavailable */ }
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: pageHTML({ source, topic, history, language: selectedLanguage }), user })
  const editor = await loadMonaco(document.getElementById('compiler-editor'), source, selectedLanguage, (value) => localStorage.setItem(languageSourceKey(selectedLanguage), value))
  const output = document.getElementById('compiler-output')
  const status = document.getElementById('compiler-status')
  const stdin = document.getElementById('compiler-stdin')
  const languageSelect = document.getElementById('compiler-language')
  const templateSelect = document.getElementById('compiler-template')
  const languageLabelNode = document.getElementById('compiler-language-label')
  const setBusy = (busy) => { document.querySelectorAll('#compiler-run,#compiler-judge').forEach((button) => { button.disabled = busy; button.textContent = busy ? '执行中...' : button.id === 'compiler-judge' ? '提交判题' : '编译运行' }) }
  const renderOutput = (result, isJudge = false) => {
    const statusName = isJudge ? (result.allPassed ? 'SUCCESS' : result.statusCode === 0 ? 'COMPILE_ERROR' : result.statusCode === 2 ? 'TIME_LIMIT_EXCEEDED' : result.statusCode === 3 ? 'RUNTIME_ERROR' : 'WRONG_ANSWER') : result.status
    status.textContent = isJudge ? `${result.passedCount}/${result.totalCount} 组通过` : statusLabel(statusName)
    status.className = `compiler-status-chip status-${statusClass(statusName)}`
    const message = [result.compileMessage, result.stderr, result.message].filter(Boolean).join('\n')
    const body = isJudge ? (result.results || []).map((item) => `<article class="compiler-case-result"><header><b>样例 ${item.index}</b><span class="compiler-verdict verdict-${statusClass(item.verdict)}">${escapeHtml(item.verdict)}</span></header><div><span>期望：${escapeHtml(item.expectedOutput || '无输出')}</span><span>实际：${escapeHtml(item.actualOutput || '无输出')}</span></div></article>`).join('') : `<pre class="compiler-console-block${message ? ' compiler-error' : ''}">${escapeHtml([message, result.stdout].filter(Boolean).join('\n') || '程序没有输出。')}</pre>`
    output.innerHTML = `${message && isJudge ? `<pre class="compiler-console-block compiler-error">${escapeHtml(message)}</pre>` : ''}${body}`
  }
  const setTemplateOptions = () => { templateSelect.innerHTML = templateOptionsHTML(selectedLanguage) }
  const switchLanguage = (nextLanguage, sourceOverride) => {
    const next = normalizeLanguage(nextLanguage)
    localStorage.setItem(languageSourceKey(selectedLanguage), editor.getValue())
    selectedLanguage = next
    localStorage.setItem('discimind.compiler.language', selectedLanguage)
    languageSelect.value = selectedLanguage
    languageLabelNode.textContent = languageLabel(selectedLanguage)
    editor.setLanguage(selectedLanguage)
    const nextSource = sourceOverride ?? localStorage.getItem(languageSourceKey(selectedLanguage)) ?? LANGUAGE_OPTIONS[selectedLanguage].defaultSource
    editor.setValue(nextSource)
    localStorage.setItem(languageSourceKey(selectedLanguage), nextSource)
    setTemplateOptions()
  }
  const run = async (judgeMode = false) => {
    const payload = { sourceCode: editor.getValue(), language: selectedLanguage }
    if (judgeMode) payload.topicId = Number(topicId)
    else payload.stdin = stdin?.value || ''
    setBusy(true)
    try { const result = (judgeMode ? await judgeCCompiler(payload) : await runCCompiler(payload)).data; renderOutput(result, judgeMode); await refreshHistory() } catch (error) { output.innerHTML = `<pre class="compiler-console-block compiler-error">${escapeHtml(error.message)}</pre>`; status.textContent = '请求失败'; status.className = 'compiler-status-chip status-runtime-error' } finally { setBusy(false) }
  }
  const refreshHistory = async () => { try { const result = await getCompilerHistory({ topicId: topicId || undefined }); history = result.data?.list || []; document.getElementById('compiler-history-list').innerHTML = historyHTML(history); bindHistory() } catch {} }
  const bindHistory = () => document.querySelectorAll('[data-history-id]').forEach((button) => button.addEventListener('click', () => { const item = history.find((entry) => String(entry.id) === String(button.dataset.historyId)); if (item) switchLanguage(item.language, item.sourceCode) }))
  languageSelect?.addEventListener('change', () => switchLanguage(languageSelect.value))
  document.getElementById('compiler-load-template')?.addEventListener('click', () => {
    const template = LANGUAGE_OPTIONS[selectedLanguage].templates.find((item) => item.id === templateSelect.value)
    if (!template) return
    switchLanguage(selectedLanguage, template.source)
    if (stdin) stdin.value = template.stdin
  })
  document.getElementById('compiler-run')?.addEventListener('click', () => run(false))
  document.getElementById('compiler-judge')?.addEventListener('click', () => run(true))
  document.getElementById('compiler-clear')?.addEventListener('click', () => { editor.clear(); localStorage.removeItem('discimind.compiler.source') })
  document.getElementById('compiler-refresh-history')?.addEventListener('click', refreshHistory)
  bindHistory()
}
