import { createAgent, updateAgent, getAgent, listKnowledgeBases } from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarketplaceLayout, loadingHTML, operationId, setButtonBusy, notify } from './marketplace-shared.js'

const CATEGORIES = ['课程学习','学科答疑','概念讲解','题目解析','考试复习','学习规划','科研辅助','论文阅读','写作表达','编程学习','职业与生涯规划','校园服务','综合工具','其他']
const TAGS = {
  purpose: ['概念讲解','学科答疑','题目解析','考试复习','学习规划','论文阅读','写作辅导','编程学习','资料总结','其他'],
  style: ['简洁直接','耐心详细','循序渐进','苏格拉底式','生活化类比','严谨专业','鼓励引导','考试导向'],
  audience: ['初学者','本科生','考研学生','竞赛学生','教师','科研人员','通用用户'],
}
const GROUP_LABEL = { purpose: '主要用途', style: '回答风格', audience: '目标用户' }

function tagGroup(group, selected) {
  const all = [...new Set([...TAGS[group], ...selected])]
  return `<fieldset class="agent-tag-group" data-group="${group}"><legend>${GROUP_LABEL[group]}</legend><div>${all.map(tag => `<button type="button" class="agent-tag-choice${selected.includes(tag) ? ' active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}<button type="button" class="agent-tag-custom" data-custom-tag>+ 自定义标签</button></div></fieldset>`
}

function formHTML(state) {
  const v = state.agent?.version || {}
  return `<section class="agent-create-hero"><div><h1>${state.agent ? '编辑智能体草稿' : '创建你的专属学习助手'}</h1><p>用一句自然语言描述需求，其余配置交给系统完成。</p></div><span id="agent-create-state">${state.agent ? 'READY' : 'IDLE'}</span></section>
    <form id="agent-create-form" class="agent-create-form">
      <section class="complex-card"><h2>描述你的智能体</h2><label>类型<select id="agent-type" ${state.agent ? 'disabled' : ''}><option value="CHAT" ${state.agentType === 'CHAT' ? 'selected' : ''}>CHAT 对话助手</option><option value="FILE_GENERATOR" ${state.agentType === 'FILE_GENERATOR' ? 'selected' : ''}>文件生成器</option></select></label><label>简单简介<textarea id="agent-description" maxlength="500" required placeholder="例如：创建一个帮助学生理解机器学习概念的学习助手，回答要耐心，尽量使用生活中的例子。">${escapeHtml(v.shortDescription || '')}</textarea></label><label>名称（可选）<input id="agent-name" maxlength="100" value="${escapeHtml(v.name || '')}" placeholder="留空时由 AI 生成"></label><label>分类<select id="agent-category">${CATEGORIES.map(item => `<option ${item === (state.agent?.category || '综合工具') ? 'selected' : ''}>${item}</option>`).join('')}</select></label></section>
      <section id="file-generator-config" class="complex-card ${state.agentType === 'FILE_GENERATOR' ? '' : 'is-hidden'}"><h2>受控文件配置</h2><div class="agent-advanced-grid"><label>默认文件<select id="fg-default-type"><option value="EXAM_PAPER" ${(v.fileGeneratorConfig?.documentType || 'EXAM_PAPER') === 'EXAM_PAPER' ? 'selected' : ''}>试卷</option><option value="STUDY_HANDOUT" ${v.fileGeneratorConfig?.documentType === 'STUDY_HANDOUT' ? 'selected' : ''}>学习讲义</option></select></label><label>目标用户<input id="fg-target" maxlength="100" value="${escapeHtml(v.fileGeneratorConfig?.targetAudience || '本科生')}"></label><label>默认难度<select id="fg-default-difficulty">${['EASY','MEDIUM','HARD'].map(x=>`<option ${x === (v.fileGeneratorConfig?.defaultDifficulty || 'MEDIUM') ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>题目上限<input id="fg-max-count" type="number" min="1" max="50" value="${v.fileGeneratorConfig?.maxQuestionCount || 20}"></label></div><p>支持 DOCX 与 PDF。文件生成在受控异步任务中运行，不允许用户代码、自定义工具、外部 API 或任意文件系统访问。</p></section>
      <section class="complex-card"><h2>选择标签</h2>${Object.keys(TAGS).map(group => tagGroup(group, state.tags[group])).join('')}</section>
      <section class="complex-card"><h2>可选配置</h2><div class="agent-mode-options"><label><input type="radio" name="response-mode" value="DEFAULT" ${state.mode === 'DEFAULT' ? 'checked' : ''}> <strong>默认模式</strong><small>使用通用模型能力回答</small></label><label><input type="radio" name="response-mode" value="KNOWLEDGE_FIRST" ${state.mode === 'KNOWLEDGE_FIRST' ? 'checked' : ''}> <strong>知识库优先</strong><small>优先使用你绑定的资料</small></label></div>
        <div id="knowledge-selector" class="${state.mode === 'KNOWLEDGE_FIRST' ? '' : 'is-hidden'}"><h3>绑定知识库（最多 3 个）</h3>${state.knowledgeBases.length ? state.knowledgeBases.map(kb => `<label class="agent-kb-option"><input type="checkbox" value="${kb.id}" ${state.selectedKbIds.includes(kb.id) ? 'checked' : ''}> ${escapeHtml(kb.name)} <small>${escapeHtml(kb.status)}</small></label>`).join('') : '<p>暂无可绑定知识库，请先到“我的知识库”创建并上传资料。</p>'}</div>
        <label class="agent-switch"><input id="agent-memory" type="checkbox" ${v.memoryEnabledByDefault ? 'checked' : ''}> 允许这个智能体默认记住我的学习偏好</label>
        <details class="agent-advanced"><summary>高级设置</summary><label>System Prompt<textarea id="agent-system-prompt" maxlength="3000" placeholder="创建后可在此查看和编辑；留空时由 AI 自动生成。">${escapeHtml(v.systemPrompt || '')}</textarea></label><div class="agent-advanced-grid"><label>召回数量<input id="agent-top-k" type="number" min="1" max="10" value="${v.topK || 5}"></label><label>相关度要求<input id="agent-threshold" type="number" min="0.1" max="0.95" step="0.05" value="${v.scoreThreshold || 0.55}"><small>越高时引用更严格，但可能减少可用内容。</small></label><label>模型回答长度<input id="agent-max-tokens" type="number" min="256" max="4000" value="${v.maxOutputTokens || 1200}"></label></div></details>
      </section>
      <div class="agent-create-submit"><button id="agent-save" class="complex-btn" type="submit">${state.agent ? '保存修改' : '创建智能体'}</button><a class="complex-btn-ghost" href="#/student/agents/mine">取消</a></div>
    </form>`
}

async function loadKnowledgeOptions() {
  const [mine, pub] = await Promise.all([listKnowledgeBases(), listKnowledgeBases('public')])
  const map = new Map([...(mine.data.list || []), ...(pub.data.list || [])].map(item => [item.id, item]))
  return [...map.values()].filter(item => !['DELETING', 'DELETED', 'OFFLINE'].includes(item.status))
}

async function renderForm(app, agentId = null) {
  renderMarketplaceLayout(app, loadingHTML('正在准备创建页面...'), '#/student/agents/create')
  try {
    const [agentResult, knowledgeBases] = await Promise.all([agentId ? getAgent(agentId) : Promise.resolve(null), loadKnowledgeOptions()])
    const agent = agentResult?.data || null; const v = agent?.version || {}
    const state = {
      agent, knowledgeBases, agentType: agent?.agentType || 'CHAT', mode: v.responseMode || 'DEFAULT', selectedKbIds: (v.knowledgeBases || []).map(item => item.id),
      tags: { purpose: [...(v.tags?.purpose || [])], style: [...(v.tags?.style || [])], audience: [...(v.tags?.audience || [])] },
    }
    renderMarketplaceLayout(app, formHTML(state), agent ? '#/student/agents/mine' : '#/student/agents/create')
    document.getElementById('agent-type').addEventListener('change', event => { state.agentType = event.target.value; document.getElementById('file-generator-config').classList.toggle('is-hidden', state.agentType !== 'FILE_GENERATOR') })
    document.querySelectorAll('input[name="response-mode"]').forEach(radio => radio.addEventListener('change', () => { state.mode = radio.value; document.getElementById('knowledge-selector').classList.toggle('is-hidden', state.mode !== 'KNOWLEDGE_FIRST') }))
    document.querySelectorAll('.agent-tag-group').forEach(groupEl => groupEl.addEventListener('click', event => {
      const group = groupEl.dataset.group
      const tagButton = event.target.closest('[data-tag]')
      if (tagButton) {
        const tag = tagButton.dataset.tag; const selected = state.tags[group]
        if (selected.includes(tag)) state.tags[group] = selected.filter(item => item !== tag)
        else if (selected.length < 5) state.tags[group].push(tag)
        else return notify('每组最多选择 5 个标签', true)
        tagButton.classList.toggle('active')
      }
      if (event.target.closest('[data-custom-tag]')) {
        const value = prompt('输入自定义标签（最多 20 个字，不包含 HTML）')?.trim()
        if (!value) return
        if (value.length > 20 || /[<>]/.test(value)) return notify('标签格式不合法', true)
        if (!state.tags[group].includes(value) && state.tags[group].length < 5) { state.tags[group].push(value); const button = document.createElement('button'); button.type = 'button'; button.className = 'agent-tag-choice active'; button.dataset.tag = value; button.textContent = value; event.target.before(button) }
      }
    }))
    document.getElementById('agent-create-form').addEventListener('submit', async event => {
      event.preventDefault(); const button = document.getElementById('agent-save'); const status = document.getElementById('agent-create-state')
      const checkedKbIds = [...document.querySelectorAll('#knowledge-selector input:checked')].map(input => Number(input.value))
      if (state.mode === 'KNOWLEDGE_FIRST' && checkedKbIds.length === 0) return notify('知识库优先模式请至少选择一个知识库', true)
      if (checkedKbIds.length > 3) return notify('一个智能体最多绑定 3 个知识库', true)
      const data = {
        agentType: state.agentType,
        description: document.getElementById('agent-description').value.trim(), name: document.getElementById('agent-name').value.trim(),
        category: document.getElementById('agent-category').value, tags: state.tags, responseMode: state.mode,
        knowledgeBaseIds: state.mode === 'KNOWLEDGE_FIRST' ? checkedKbIds : [], memoryEnabledByDefault: document.getElementById('agent-memory').checked,
        systemPrompt: document.getElementById('agent-system-prompt').value.trim() || undefined,
        topK: Number(document.getElementById('agent-top-k').value), scoreThreshold: Number(document.getElementById('agent-threshold').value),
        maxOutputTokens: Number(document.getElementById('agent-max-tokens').value), operationId: operationId(), changeSummary: agent ? '创建者保存了新的草稿版本' : undefined,
        ...(state.agentType === 'FILE_GENERATOR' ? { fileGeneratorConfig: { documentType:document.getElementById('fg-default-type').value, targetAudience:document.getElementById('fg-target').value.trim(), defaultDifficulty:document.getElementById('fg-default-difficulty').value, answerStyle:'清晰严谨', knowledgeEnhanced:state.mode === 'KNOWLEDGE_FIRST', outputTemplate:'', maxQuestionCount:Number(document.getElementById('fg-max-count').value), fileFormat:'DOCX', outputFormats:['DOCX','PDF'] } } : {}),
      }
      setButtonBusy(button, true, '正在生成配置...'); status.textContent = 'GENERATING'
      try { const result = await (agent ? updateAgent(agent.id, data) : createAgent(data)); status.textContent = 'SAVED'; notify(agent ? '修改已保存为新草稿' : '智能体创建成功'); window.location.hash = `#/student/agents/${result.data.id}/detail` }
      catch (error) { status.textContent = 'ERROR'; notify(error.message, true); setButtonBusy(button, false) }
    })
  } catch (error) { renderMarketplaceLayout(app, `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>`) }
}

export const renderAgentCreate = app => renderForm(app)
export const renderAgentEdit = (app, params) => renderForm(app, params.id)
