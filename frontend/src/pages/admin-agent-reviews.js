import { getUser } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { escapeHtml } from '../utils/format.js'
import {
  listAdminAgentReviews, approveAdminAgentReview, rejectAdminAgentReview,
  listAdminKnowledgeReviews, approveAdminKnowledgeReview, rejectAdminKnowledgeReview,
  listAdminAgentReports, resolveAdminAgentReport,
} from '../api/marketplace.js'
import { loadingHTML, operationId, setButtonBusy, notify } from './agent/marketplace-shared.js'

const ADMIN_MENU = [
  { label: '首页', icon: 'home', hash: '#/admin/dashboard' }, { label: '用户管理', icon: 'user', hash: '#/admin/users' },
  { label: '教学管理', icon: 'book', hash: '#/admin/courses' }, { label: '智能体审核', icon: 'star', hash: '#/admin/agent-reviews' },
  { label: '系统管理', icon: 'settings', hash: '#/admin/knowledge' },
]

function agentReviewCard(item) {
  const v = item.version
  return `<article class="admin-review-card" data-review-id="${item.id}"><header><div><span>版本 ${v.versionNumber}</span><h3>${escapeHtml(v.name)}</h3><p>${escapeHtml(v.shortDescription)}</p></div><span>${escapeHtml(item.creator.name)}</span></header>
    <div class="admin-review-meta"><span>${escapeHtml(item.agent.category || '其他')}</span><span>${escapeHtml(v.responseMode)}</span><span>${v.knowledgeBases.length} 个知识库</span><span>${item.agent.reportCount} 条待处理举报</span></div>
    <details><summary>查看配置与 System Prompt</summary><div class="admin-prompt-preview">${escapeHtml(v.systemPrompt)}</div><h4>标签</h4><p>${v.tags.map(tag => escapeHtml(`${tag.group}：${tag.name}`)).join(' · ')}</p><h4>知识库绑定</h4>${v.knowledgeBases.map(kb => `<p>${escapeHtml(kb.name)} · ${escapeHtml(kb.visibility)} · ${escapeHtml(kb.status)}</p>`).join('') || '<p>无</p>'}${item.riskHints.map(hint => `<p class="review-risk">${escapeHtml(hint)}</p>`).join('')}</details>
    <footer><button class="complex-btn" data-review-action="approve">审核通过</button><button class="complex-btn-danger" data-review-action="reject">驳回</button></footer></article>`
}

function kbReviewCard(item) {
  const kb = item.knowledgeBase
  return `<article class="admin-review-card" data-review-id="${item.id}"><header><div><h3>${escapeHtml(kb.name)}</h3><p>${escapeHtml(kb.description || '')}</p></div><span>${escapeHtml(kb.owner.name || kb.owner.username)}</span></header><div class="admin-review-meta"><span>${kb.documents.length} 个文件</span><span>${kb.boundAgentCount} 个智能体使用</span></div><details><summary>查看文档元数据</summary>${kb.documents.map(doc => `<p>${escapeHtml(doc.name)} · ${escapeHtml(doc.mimeType)} · ${Math.round((doc.sizeBytes || 0) / 1024)} KB · ${escapeHtml(doc.status)}</p>`).join('')}</details><footer><button class="complex-btn" data-review-action="approve-kb">审核通过</button><button class="complex-btn-danger" data-review-action="reject-kb">驳回</button></footer></article>`
}

function reportCard(item) {
  return `<article class="admin-review-card" data-report-id="${item.id}"><header><div><h3>${escapeHtml(item.agent.name)}</h3><p>${escapeHtml(item.reason)}：${escapeHtml(item.detail || '')}</p></div><span>举报人：${escapeHtml(item.reporter.name)}</span></header><footer><button class="complex-btn" data-report-action="resolve">处理举报</button><button class="complex-btn-danger" data-report-action="offline">处理并下架</button></footer></article>`
}

export async function renderAdminAgentReviews(app) {
  renderDashboardLayout(app, { user: getUser(), menuItems: ADMIN_MENU, contentHTML: `<div class="agent-market-shell"><section class="agent-market-hero"><div><h1>智能体审核与治理</h1><p>审核公开版本、知识库与举报，所有操作都会保留审计记录。</p></div></section><div class="knowledge-tabs"><button class="active" data-review-tab="agents">智能体审核</button><button data-review-tab="knowledge">知识库审核</button><button data-review-tab="reports">举报处理</button></div><div id="admin-review-root">${loadingHTML()}</div></div>` })
  const root = document.getElementById('admin-review-root')
  const load = async tab => {
    root.innerHTML = loadingHTML()
    try {
      const result = await (tab === 'agents' ? listAdminAgentReviews() : tab === 'knowledge' ? listAdminKnowledgeReviews() : listAdminAgentReports())
      const items = result.data.list || []
      root.innerHTML = items.length ? `<div class="admin-review-list">${items.map(item => tab === 'agents' ? agentReviewCard(item) : tab === 'knowledge' ? kbReviewCard(item) : reportCard(item)).join('')}</div>` : '<div class="agent-market-empty"><p>当前没有待处理项目。</p></div>'
      root.querySelectorAll('[data-review-action]').forEach(button => button.addEventListener('click', async () => {
        const id = button.closest('[data-review-id]').dataset.reviewId; const action = button.dataset.reviewAction
        let reason = null
        if (action.includes('reject')) { reason = prompt('请输入驳回理由（必填）')?.trim(); if (!reason) return notify('驳回必须填写理由', true) }
        setButtonBusy(button, true, '处理中...')
        try {
          if (action === 'approve') await approveAdminAgentReview(id, operationId())
          if (action === 'reject') await rejectAdminAgentReview(id, reason, operationId())
          if (action === 'approve-kb') await approveAdminKnowledgeReview(id, operationId())
          if (action === 'reject-kb') await rejectAdminKnowledgeReview(id, reason, operationId())
          notify(action.includes('reject') ? '已驳回' : '审核通过'); await load(tab)
        } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
      }))
      root.querySelectorAll('[data-report-action]').forEach(button => button.addEventListener('click', async () => {
        const resolution = prompt('请输入处理说明（必填）')?.trim(); if (!resolution) return
        const offline = button.dataset.reportAction === 'offline'; if (offline && !confirm('确认同时下架该智能体吗？')) return
        setButtonBusy(button, true)
        try { await resolveAdminAgentReport(button.closest('[data-report-id]').dataset.reportId, resolution, offline, operationId()); notify('举报已处理'); await load(tab) } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
      }))
    } catch (error) { root.innerHTML = `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>` }
  }
  document.querySelectorAll('[data-review-tab]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-review-tab]').forEach(item => item.classList.remove('active')); button.classList.add('active'); load(button.dataset.reviewTab) }))
  await load('agents')
}
