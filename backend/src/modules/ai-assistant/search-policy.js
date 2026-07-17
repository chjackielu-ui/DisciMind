const { z } = require('zod');
const { aiError } = require('./errors');

const SEARCH_MODES = Object.freeze(['off', 'auto', 'force']);
const SEARCH_STRATEGIES = Object.freeze(['turbo', 'max', 'agent']);
const FRESHNESS_VALUES = Object.freeze([7, 30, 180, 365]);
const CITATION_FORMATS = Object.freeze(['[ref_<number>]', '[<number>]']);

const searchOptionsSchema = z.object({
  mode: z.enum(SEARCH_MODES).default('auto'),
  strategy: z.enum(SEARCH_STRATEGIES).default('turbo'),
  enableSource: z.boolean().default(true),
  enableCitation: z.boolean().default(true),
  citationFormat: z.enum(CITATION_FORMATS).default('[ref_<number>]'),
  prependSearchResult: z.boolean().default(true),
  enableSearchExtension: z.boolean().default(false),
  freshness: z.union([z.null(), z.enum(['7', '30', '180', '365']), z.number().int()]).default(null),
  assignedSiteList: z.array(z.string()).max(25).default([]),
  promptIntervene: z.union([z.string().max(300), z.null()]).default(null),
  enableTextImageMixed: z.boolean().default(false),
}).strict();

const DEFAULT_SEARCH_OPTIONS = Object.freeze({
  mode: 'auto', strategy: 'turbo', enableSource: true, enableCitation: true,
  citationFormat: '[ref_<number>]', prependSearchResult: true,
  enableSearchExtension: false, freshness: null, assignedSiteList: [],
  promptIntervene: null, enableTextImageMixed: false,
});

const REALTIME_TERMS = /(?:最新|最近|近期|当前|现在|今天|今日|实时|刚刚|新闻|政策|价格|股价|汇率|天气|预报|版本|发布|更新|赛程|排名|截止|法规|利率|油价|金价|银价|热搜|本周|本月|近\s*\d+\s*天|latest|recent|current|today|news|weather|price|version|release)/iu;

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.replace(/^www\./, '');
    return /^[a-z0-9.-]+$/i.test(host) && host.includes('.') ? host.slice(0, 253) : null;
  } catch {
    return null;
  }
}

function parseSearchOptions(input = {}) {
  const candidate = { ...DEFAULT_SEARCH_OPTIONS, ...(input || {}) };
  const parsed = searchOptionsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw aiError('AI_TOOL_VALIDATION_FAILED', `联网设置不合法：${parsed.error.issues[0]?.message || '参数错误'}`, 400);
  }
  const freshness = parsed.data.freshness == null ? null : Number(parsed.data.freshness);
  if (freshness != null && !FRESHNESS_VALUES.includes(freshness)) {
    throw aiError('AI_TOOL_VALIDATION_FAILED', '搜索时效性仅支持 7、30、180 或 365 天。', 400);
  }
  const assignedSiteList = [...new Set(parsed.data.assignedSiteList.map(normalizeDomain).filter(Boolean))];
  if (assignedSiteList.length !== parsed.data.assignedSiteList.filter(item => String(item || '').trim()).length) {
    throw aiError('AI_TOOL_VALIDATION_FAILED', '来源站点必须是有效的 HTTP/HTTPS 域名。', 400);
  }
  return {
    ...parsed.data,
    freshness,
    assignedSiteList,
    promptIntervene: String(parsed.data.promptIntervene || '').trim().slice(0, 300) || null,
  };
}

function isRealtimeQuestion(question) {
  return REALTIME_TERMS.test(String(question || ''));
}

function decideSearch(question, options = DEFAULT_SEARCH_OPTIONS) {
  const normalized = parseSearchOptions(options);
  const realtime = isRealtimeQuestion(question);
  if (normalized.mode === 'off') {
    return { enabled: false, forced: false, realtime, reason: realtime ? 'disabled_realtime' : 'disabled' };
  }
  if (normalized.mode === 'force') return { enabled: true, forced: true, realtime, reason: 'forced' };
  return { enabled: realtime, forced: false, realtime, reason: realtime ? 'auto_realtime' : 'auto_not_needed' };
}

function capabilityEnabled(capabilities, key, fallback = false) {
  return capabilities?.features?.[key]?.supported ?? capabilities?.[key] ?? fallback;
}

function cropSearchOptions(options, capabilities = {}) {
  const normalized = parseSearchOptions(options);
  const omitted = [];
  const effective = { ...normalized, assignedSiteList: [...normalized.assignedSiteList] };
  if (effective.strategy === 'agent' && !capabilityEnabled(capabilities, 'strategyAgent')) {
    omitted.push({ field: 'strategy', reason: 'unsupported', requested: 'agent', applied: 'turbo' });
    effective.strategy = 'turbo';
  }
  if (effective.freshness != null && !capabilityEnabled(capabilities, 'freshness')) {
    omitted.push({ field: 'freshness', reason: 'unsupported' }); effective.freshness = null;
  }
  if (effective.assignedSiteList.length && !capabilityEnabled(capabilities, 'assignedSiteList')) {
    omitted.push({ field: 'assignedSiteList', reason: 'unsupported' }); effective.assignedSiteList = [];
  }
  if (effective.promptIntervene && !capabilityEnabled(capabilities, 'promptIntervene')) {
    omitted.push({ field: 'promptIntervene', reason: 'unsupported' }); effective.promptIntervene = null;
  }
  if (effective.enableTextImageMixed && !capabilityEnabled(capabilities, 'textImageMixed')) {
    omitted.push({ field: 'enableTextImageMixed', reason: 'unsupported' }); effective.enableTextImageMixed = false;
  }
  if (effective.enableSearchExtension && !capabilityEnabled(capabilities, 'searchExtension', true)) {
    omitted.push({ field: 'enableSearchExtension', reason: 'unsupported' }); effective.enableSearchExtension = false;
  }
  if (effective.prependSearchResult && !capabilityEnabled(capabilities, 'prependSources', true)) {
    omitted.push({ field: 'prependSearchResult', reason: 'unsupported' }); effective.prependSearchResult = false;
  }
  return { requested: normalized, effective, omitted };
}

function buildDashScopeParameters(options, capabilities = {}) {
  const cropped = cropSearchOptions(options, capabilities);
  const value = cropped.effective;
  const searchOptions = {
    forced_search: value.mode === 'force',
    enable_source: value.enableSource,
    enable_citation: value.enableSource && value.enableCitation,
    citation_format: value.citationFormat,
    prepend_search_result: value.enableSource && value.prependSearchResult,
    search_strategy: value.strategy,
  };
  if (value.enableSearchExtension) searchOptions.enable_search_extension = true;
  if (value.freshness != null) searchOptions.freshness = value.freshness;
  if (value.assignedSiteList.length) searchOptions.assigned_site_list = value.assignedSiteList;
  if (value.promptIntervene) searchOptions.intention_options = { prompt_intervene: value.promptIntervene };
  return {
    ...cropped,
    parameters: {
      enable_search: value.mode !== 'off',
      search_options: searchOptions,
      ...(value.enableTextImageMixed ? { enable_text_image_mixed: true } : {}),
    },
  };
}

module.exports = {
  SEARCH_MODES, SEARCH_STRATEGIES, FRESHNESS_VALUES, CITATION_FORMATS,
  DEFAULT_SEARCH_OPTIONS, searchOptionsSchema, parseSearchOptions,
  normalizeDomain, isRealtimeQuestion, decideSearch, cropSearchOptions,
  buildDashScopeParameters,
};
