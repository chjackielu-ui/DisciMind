import { getUser } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { escapeHtml } from '../utils/format.js'
import {
  listAdminAgentReviews, approveAdminAgentReview, rejectAdminAgentReview,
  listAdminKnowledgeReviews, approveAdminKnowledgeReview, rejectAdminKnowledgeReview,
  listAdminAgentReports, resolveAdminAgentReport,
} from '../api/marketplace.js'
import { loadingHTML, operationId, setButtonBusy, notify } from './agent/marketplace-shared.js'
import { promptAdmin, confirmAdmin } from '../utils/admin-ui.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'

function readonlyFooter() {
  return '<footer><span class="admin-review-readonly">当前角色仅可查看</span></footer>'
}

function agentReviewCard(item, canManage) {
  const v = item.version
  return `<article class="admin-review-card" data-review-id="${item.id}"><header><div><span>版本 ${v.versionNumber}</span><h3>${escapeHtml(v.name)}</h3><p>${escapeHtml(v.shortDescription)}</p></div><span>${escapeHtml(item.creator.name)}</span></header>
    <div class="admin-review-meta"><span>${escapeHtml(item.agent.category || '其他')}</span><span>${escapeHtml(v.responseMode)}</span><span>${v.knowledgeBases.length} 个知识库</span><span>${item.agent.reportCount} 条待处理举报</span></div>
    <details><summary>查看配置与 System Prompt</summary><div class="admin-prompt-preview">${escapeHtml(v.systemPrompt)}</div><h4>标签</h4><p>${v.tags.map(tag => escapeHtml(`${tag.group}：${tag.name}`)).join(' · ')}</p><h4>知识库绑定</h4>${v.knowledgeBases.map(kb => `<p>${escapeHtml(kb.name)} · ${escapeHtml(kb.visibility)} · ${escapeHtml(kb.status)}</p>`).join('') || '<p>无</p>'}${item.riskHints.map(hint => `<p class="review-risk">${escapeHtml(hint)}</p>`).join('')}</details>
    ${canManage ? '<footer><button class="complex-btn" data-review-action="approve">审核通过</button><button class="complex-btn-danger" data-review-action="reject">驳回</button></footer>' : readonlyFooter()}</article>`
}

function kbReviewCard(item, canManage) {
  const kb = item.knowledgeBase
  return `<article class="admin-review-card" data-review-id="${item.id}"><header><div><h3>${escapeHtml(kb.name)}</h3><p>${escapeHtml(kb.description || '')}</p></div><span>${escapeHtml(kb.owner.name || kb.owner.username)}</span></header><div class="admin-review-meta"><span>${kb.documents.length} 个文件</span><span>${kb.boundAgentCount} 个智能体使用</span></div><details><summary>查看文档元数据</summary>${kb.documents.map(doc => `<p>${escapeHtml(doc.name)} · ${escapeHtml(doc.mimeType)} · ${Math.round((doc.sizeBytes || 0) / 1024)} KB · ${escapeHtml(doc.status)}</p>`).join('')}</details>${canManage ? '<footer><button class="complex-btn" data-review-action="approve-kb">审核通过</button><button class="complex-btn-danger" data-review-action="reject-kb">驳回</button></footer>' : readonlyFooter()}</article>`
}

function reportCard(item, canManage) {
  return `<article class="admin-review-card" data-report-id="${item.id}"><header><div><h3>${escapeHtml(item.agent.name)}</h3><p>${escapeHtml(item.reason)}：${escapeHtml(item.detail || '')}</p></div><span>举报人：${escapeHtml(item.reporter.name)}</span></header>${canManage ? '<footer><button class="complex-btn" data-report-action="resolve">处理举报</button><button class="complex-btn-danger" data-report-action="offline">处理并下架</button></footer>' : readonlyFooter()}</article>`
}

export async function renderAdminAgentReviews(app) {
  const user = getUser()
  let access
  try { access = await loadAdminAccess(user.user_id) } catch (error) {
    renderDashboardLayout(app, { user, menuItems: ADMIN_MENU_ITEMS, contentHTML: `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>` })
    return
  }
  const permissions = {
    agentsView: hasAdminPermission(access, 'admin.agents.view'),
    agentsManage: hasAdminPermission(access, 'admin.agents.manage'),
    knowledgeView: hasAdminPermission(access, 'admin.knowledge.view'),
    knowledgeManage: hasAdminPermission(access, 'admin.knowledge.manage'),
    risksView: hasAdminPermission(access, 'admin.risks.view'),
    risksManage: hasAdminPermission(access, 'admin.risks.manage'),
  }
  const tabs = [
    permissions.agentsView && { id: 'agents', label: '智能体审核' },
    permissions.knowledgeView && { id: 'knowledge', label: '知识库审核' },
    permissions.risksView && { id: 'reports', label: '举报处理' },
  ].filter(Boolean)
  const requestedTab = new URLSearchParams(String(window.location.hash).split('?')[1] || '').get('tab')
  const initialTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0]?.id
  const pageTitle = tabs.find((tab) => tab.id === initialTab)?.label || '内容审核'
  renderDashboardLayout(app, { user, menuItems: ADMIN_MENU_ITEMS, contentHTML: `<div class="agent-market-shell"><section class="agent-market-hero"><div><h1>${escapeHtml(pageTitle)}</h1><p>审核公开版本、知识库与举报，所有操作都会保留审计记录。</p></div></section><div id="admin-review-root">${initialTab ? loadingHTML() : '<div class="agent-market-empty is-error"><p>当前角色没有可查看的审核队列。</p></div>'}</div></div>` })
  const root = document.getElementById('admin-review-root')
  const load = async tab => {
    root.innerHTML = loadingHTML()
    try {
      const result = await (tab === 'agents' ? listAdminAgentReviews() : tab === 'knowledge' ? listAdminKnowledgeReviews() : listAdminAgentReports())
      const items = result.data.list || []
      root.innerHTML = items.length ? `<div class="admin-review-list">${items.map(item => tab === 'agents' ? agentReviewCard(item, permissions.agentsManage) : tab === 'knowledge' ? kbReviewCard(item, permissions.knowledgeManage) : reportCard(item, permissions.risksManage)).join('')}</div>` : '<div class="agent-market-empty"><p>当前没有待处理项目。</p></div>'
      root.querySelectorAll('[data-review-action]').forEach(button => button.addEventListener('click', async () => {
        const id = button.closest('[data-review-id]').dataset.reviewId; const action = button.dataset.reviewAction
        let reason = null
        if (action.includes('reject')) { reason = await promptAdmin({ title: '驳回审核', label: '驳回理由', placeholder: '请输入可审计的驳回理由' }); if (!reason) return notify('驳回必须填写理由', true) }
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
        const resolution = await promptAdmin({ title: '处理举报', label: '处理说明', placeholder: '请输入可审计的处理说明' }); if (!resolution) return
        const offline = button.dataset.reportAction === 'offline'; if (offline && !(await confirmAdmin({ title: '处理并下架', message: '确认同时下架该智能体吗？', confirmLabel: '处理并下架', danger: true }))) return
        setButtonBusy(button, true)
        try { await resolveAdminAgentReport(button.closest('[data-report-id]').dataset.reportId, resolution, offline, operationId()); notify('举报已处理'); await load(tab) } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
      }))
    } catch (error) { root.innerHTML = `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>` }
  }
  if (initialTab) await load(initialTab)
}
