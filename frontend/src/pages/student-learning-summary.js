// 学习总结页 — DisciMind 学生端
import { learningWorkflowApi } from '../api/learning-workflows.js';
import { navigateTo } from '../utils/router.js';
import { renderDashboardLayout } from '../utils/dashboard.js';
import { getUser } from '../utils/auth.js';
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js';

export function renderStudentLearningSummary(app, params) {
  const sessionId = Number(params.sessionId);
  const user = getUser();

  const html = `<div class="lw-summary-page">
    <div class="page-header"><h1 class="page-title">学习总结</h1><p class="page-subtitle" id="lw-sum-status">加载中...</p></div>
    <div id="lw-sum-body"><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在生成学习总结...</p></div></div>
    <div style="text-align:center;margin-top:24px"><button class="btn btn-primary" id="lw-sum-back">返回学习流中心</button></div>
  </div>`;
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: html, user });
  loadSummary(sessionId);
}

async function loadSummary(sessionId) {
  try {
    const r = await learningWorkflowApi.getSummary(sessionId);
    const s = r.data || r;
    if (!s) { document.getElementById('lw-sum-body').innerHTML = '<div class="error-state"><p class="error-message">总结数据为空</p></div>'; return; }
    renderData(s);
  } catch(e) {
    document.getElementById('lw-sum-body').innerHTML = `<div class="error-state"><p class="error-message">加载失败: ${esc(e.message||'')}</p></div>`;
  }
}

function renderData(s) {
  document.getElementById('lw-sum-status').textContent = s.status || '';
  const mc = s.masteryChange || {};
  const ch = mc.change != null ? ((mc.change>0?'+':'')+mc.change.toFixed(1)+'%') : '--';
  const ns = s.nodeStats || {};

  document.getElementById('lw-sum-body').innerHTML = `
    <div class="lw-summary-cards">
      <div class="lw-summary-card"><div class="lw-summary-card-value">${s.durationSeconds?fmtDur(s.durationSeconds):'--'}</div><div class="lw-summary-card-label">学习用时</div></div>
      <div class="lw-summary-card"><div class="lw-summary-card-value">${ns.total||0}</div><div class="lw-summary-card-label">总节点</div></div>
      <div class="lw-summary-card"><div class="lw-summary-card-value">${ns.completed||0}</div><div class="lw-summary-card-label">完成</div></div>
      <div class="lw-summary-card"><div class="lw-summary-card-value" style="color:${mc.change>0?'#0D7C66':'#C45C2C'}">${ch}</div><div class="lw-summary-card-label">掌握度变化</div></div>
    </div>
    <div class="lw-summary-detail">
      <div class="lw-summary-section"><h3>掌握度</h3>
        <div class="lw-mastery-item"><span>开始前</span><div class="lw-mastery-bar"><div style="width:${mc.before||0}%;background:#829AB1"></div></div><span>${mc.before!=null?Math.round(mc.before)+'%':'--'}</span></div>
        <div class="lw-mastery-item"><span>结束后</span><div class="lw-mastery-bar"><div style="width:${mc.after||0}%;background:#2F6690"></div></div><span>${mc.after!=null?Math.round(mc.after)+'%':'--'}</span></div>
      </div>
      ${ns.completed>0?`<div class="lw-summary-section"><h3>完成节点 (${ns.completed})</h3>${(s.completedNodes||[]).map(n=>`<div class="lw-summary-node-item completed">${esc(n.type||n.nodeId)}</div>`).join('')}</div>`:''}
      ${ns.skipped>0?`<div class="lw-summary-section"><h3>跳过节点 (${ns.skipped})</h3>${(s.skippedNodes||[]).map(n=>`<div class="lw-summary-node-item skipped">${esc(n.type||n.nodeId)}</div>`).join('')}</div>`:''}
    </div>`;
}

function fmtDur(s) { const m=Math.floor(s/60); return m>=60?Math.floor(m/60)+'h '+m%60+'m':m+'m '+s%60+'s'; }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

setTimeout(() => { document.getElementById('lw-sum-back')&&(document.getElementById('lw-sum-back').onclick = () => navigateTo('#/student/learning-flows')); }, 80);
