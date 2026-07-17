const DEFAULTS = Object.freeze({
  mode: 'auto', strategy: 'turbo', enableSource: true, enableCitation: true,
  citationFormat: '[ref_<number>]', prependSearchResult: true,
  enableSearchExtension: false, freshness: null, assignedSiteList: [],
  promptIntervene: null, enableTextImageMixed: false,
})

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function feature(capabilities, key, fallback = false) {
  return capabilities?.features?.[key] || { supported: fallback, reason: fallback ? null : '当前模型未验证此能力' }
}

function searchIcon(kind) {
  const paths = kind === 'settings'
    ? '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.55 1.02l-.03.08h-4l-.03-.08A1.7 1.7 0 0 0 7.85 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-1.02-1.55l-.08-.03v-4l.08-.03A1.7 1.7 0 0 0 3.6 7.85a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 7.85 3.6 1.7 1.7 0 0 0 9.4 2.58l.03-.08h4l.03.08A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 7.85a1.7 1.7 0 0 0 1.02 1.55l.08.03v4l-.08.03A1.7 1.7 0 0 0 19.4 15Z"/>'
    : '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

export function createSearchControls(root, options = {}) {
  const state = { value: { ...DEFAULTS, ...(options.value || {}) }, capabilities: options.capabilities || null, busy: false }

  function optionDisabled(key, fallback = false) {
    const item = feature(state.capabilities, key, fallback)
    return item.supported ? '' : `disabled title="${escapeHtml(item.reason || '当前模型不支持')}"`
  }

  function render() {
    if (!root) return
    const value = state.value
    root.innerHTML = `<div class="ai-search-controls ${state.busy ? 'is-busy' : ''}">
      <div class="ai-search-primary" role="group" aria-label="联网搜索模式">
        <span class="ai-search-label">${searchIcon('network')}<span>联网</span></span>
        ${[['off', '关闭'], ['auto', '自动'], ['force', '强制']].map(([mode, label]) => `<button type="button" data-search-mode="${mode}" class="${value.mode === mode ? 'active' : ''}" ${state.busy ? 'disabled' : ''}>${label}</button>`).join('')}
        <button type="button" class="ai-search-advanced-toggle" data-search-advanced aria-expanded="false" title="联网搜索高级设置">${searchIcon('settings')}<span>高级</span></button>
      </div>
      <div class="ai-search-status">${value.mode === 'off' ? '不访问网络' : value.mode === 'force' ? '必须实际搜索，否则明确报错' : '仅在时效问题中搜索'}</div>
      <div class="ai-search-advanced" hidden>
        <label>策略<select data-search-field="strategy" ${state.busy ? 'disabled' : ''}><option value="turbo" ${value.strategy === 'turbo' ? 'selected' : ''}>Turbo</option><option value="max" ${value.strategy === 'max' ? 'selected' : ''}>Max</option><option value="agent" ${value.strategy === 'agent' ? 'selected' : ''} ${optionDisabled('strategyAgent')}>Agent</option></select></label>
        <label>时效<select data-search-field="freshness" ${optionDisabled('freshness')}><option value="">不限</option>${[7, 30, 180, 365].map(day => `<option value="${day}" ${Number(value.freshness) === day ? 'selected' : ''}>${day} 天</option>`).join('')}</select></label>
        <label class="wide">指定站点<input data-search-field="assignedSiteList" value="${escapeHtml((value.assignedSiteList || []).join(', '))}" placeholder="example.com，多个用逗号分隔" ${optionDisabled('assignedSiteList')}></label>
        <label class="wide">检索干预<input data-search-field="promptIntervene" value="${escapeHtml(value.promptIntervene || '')}" placeholder="例如：优先权威教育来源" ${optionDisabled('promptIntervene')}></label>
        <label><input type="checkbox" data-search-field="enableSource" ${value.enableSource ? 'checked' : ''}>返回来源</label>
        <label><input type="checkbox" data-search-field="enableCitation" ${value.enableCitation ? 'checked' : ''}>正文引用</label>
        <label><input type="checkbox" data-search-field="prependSearchResult" ${value.prependSearchResult ? 'checked' : ''} ${optionDisabled('prependSources', true)}>来源先到</label>
        <label><input type="checkbox" data-search-field="enableSearchExtension" ${value.enableSearchExtension ? 'checked' : ''} ${optionDisabled('searchExtension', true)}>搜索增强</label>
        <label><input type="checkbox" data-search-field="enableTextImageMixed" ${value.enableTextImageMixed ? 'checked' : ''} ${optionDisabled('textImageMixed')}>图文混排</label>
        <p class="ai-search-capability-note">不可用选项会自动禁用并由后端再次裁剪，不会盲目传给模型。</p>
      </div>
    </div>`
    bind()
  }

  function changed() { options.onChange?.(api.getOptions()) }

  function bind() {
    root.querySelectorAll('[data-search-mode]').forEach(button => button.addEventListener('click', () => { state.value.mode = button.dataset.searchMode; render(); changed() }))
    root.querySelector('[data-search-advanced]')?.addEventListener('click', event => {
      const panel = root.querySelector('.ai-search-advanced'); panel.hidden = !panel.hidden
      event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden))
    })
    root.querySelectorAll('[data-search-field]').forEach(control => control.addEventListener('change', () => {
      const key = control.dataset.searchField
      if (control.type === 'checkbox') state.value[key] = control.checked
      else if (key === 'freshness') state.value[key] = control.value ? Number(control.value) : null
      else if (key === 'assignedSiteList') state.value[key] = control.value.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)
      else state.value[key] = control.value || null
      changed()
    }))
  }

  const api = {
    getOptions: () => ({ ...state.value, assignedSiteList: [...(state.value.assignedSiteList || [])] }),
    setOptions: value => { state.value = { ...DEFAULTS, ...(value || {}) }; render() },
    setCapabilities: value => { state.capabilities = value; render() },
    setBusy: value => { state.busy = Boolean(value); render() },
    destroy: () => { if (root) root.innerHTML = '' },
  }
  render()
  return api
}

export { DEFAULTS as DEFAULT_SEARCH_OPTIONS }
