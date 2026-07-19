const prisma = require('../config/prisma');
const { recordAdminOperation } = require('./admin-audit.service');

const STANDARD_CONTROLS = [
  {
    key: 'governance-accountability',
    name: '治理责任与全生命周期台账',
    domain: 'governance',
    severity: 'high',
    nist_function: 'GOVERN',
    description: '明确 AI 系统责任人、适用范围、风险等级、上线审批和定期复审要求。',
    requirements: ['登记模型、供应商、用途和责任人', '高风险变更执行审批与回滚', '至少每季度复审一次控制有效性'],
    regulatory_basis: ['NIST AI RMF · GOVERN', 'ISO/IEC 42001 · AIMS/PDCA'],
  },
  {
    key: 'data-privacy',
    name: '数据最小化与隐私保护',
    domain: 'privacy',
    severity: 'critical',
    nist_function: 'MAP',
    description: '限制输入、日志和知识库中的个人信息及敏感数据，落实必要性、授权和留存期限。',
    requirements: ['禁止向模型发送非必要敏感信息', '日志与证据默认脱敏', '支持访问、更正和删除请求'],
    regulatory_basis: ['《个人信息保护法》', '《生成式人工智能服务管理暂行办法》第十一条', 'GB/T 45654-2025'],
  },
  {
    key: 'content-safety',
    name: '生成内容安全',
    domain: 'content',
    severity: 'critical',
    nist_function: 'MEASURE',
    description: '对违法有害、歧视、暴力、自伤及不适合教育场景的输出进行检测、阻断和报告。',
    requirements: ['输入与输出双向安全检测', '高危命中停止生成并保存脱敏证据', '建立投诉举报和处置时限'],
    regulatory_basis: ['《生成式人工智能服务管理暂行办法》第四、十四、十五条', 'GB/T 45654-2025'],
  },
  {
    key: 'prompt-and-access-security',
    name: '提示词注入与越权防护',
    domain: 'security',
    severity: 'critical',
    nist_function: 'MEASURE',
    description: '防止提示词注入、越狱、工具滥用、跨用户数据访问和权限绕过。',
    requirements: ['系统提示词与用户内容隔离', '工具调用执行最小权限校验', '注入与异常调用触发风险事件'],
    regulatory_basis: ['NIST AI RMF · MEASURE/MANAGE', 'NIST Generative AI Profile', 'GB/T 45654-2025'],
  },
  {
    key: 'reliability-and-grounding',
    name: '可靠性、溯源与人工复核',
    domain: 'reliability',
    severity: 'high',
    nist_function: 'MEASURE',
    description: '降低幻觉和错误建议风险，为关键教学结论保留来源、置信度和人工复核入口。',
    requirements: ['关键事实给出可核验来源', '低置信度输出明确提示不确定性', '评分与高影响决策支持人工复核'],
    regulatory_basis: ['NIST AI RMF · MAP/MEASURE', 'ISO/IEC 42001 · 风险评估与控制'],
  },
  {
    key: 'fairness-and-inclusion',
    name: '公平性与偏差评测',
    domain: 'fairness',
    severity: 'high',
    nist_function: 'MEASURE',
    description: '持续评估不同学生群体上的质量差异，避免以受保护特征产生不公平教学影响。',
    requirements: ['按适用群体开展差异评测', '记录数据与模型局限', '偏差超阈值时暂停高影响用途'],
    regulatory_basis: ['NIST AI RMF · MEASURE', 'ISO/IEC 42001 · 负责任 AI'],
  },
  {
    key: 'transparency-and-traceability',
    name: '透明告知与证据链',
    domain: 'transparency',
    severity: 'high',
    nist_function: 'GOVERN',
    description: '清晰告知 AI 参与、适用边界和模型信息，并记录调用、版本、检索依据与治理动作。',
    requirements: ['显著标识 AI 生成内容', '公示模型名称及适用信息', '关键调用形成可审计证据链'],
    regulatory_basis: ['《生成式人工智能服务管理暂行办法》第十、十二、十七条', 'NIST AI RMF · GOVERN'],
  },
  {
    key: 'education-and-minors',
    name: '教育场景与未成年人保护',
    domain: 'education',
    severity: 'critical',
    nist_function: 'MAP',
    description: '控制学生过度依赖、代写作弊和不适龄内容，确保教师监督及学习目标优先。',
    requirements: ['防范过度依赖与沉迷', '检测代写、作弊和绕过学习过程', '未成年人高风险场景升级人工处理'],
    regulatory_basis: ['《生成式人工智能服务管理暂行办法》第十条', '教育场景人工监督原则'],
  },
  {
    key: 'incident-response',
    name: '监测、事件响应与持续改进',
    domain: 'operations',
    severity: 'critical',
    nist_function: 'MANAGE',
    description: '建立分级告警、止损、调查、报告、恢复和复盘闭环，并持续改进规则。',
    requirements: ['严重事件立即限制相关能力', '保留脱敏证据与完整处置记录', '明确报告、恢复和复盘负责人'],
    regulatory_basis: ['NIST AI RMF · MANAGE', 'ISO/IEC 42001 · CHECK/ACT', '《生成式人工智能服务管理暂行办法》第十四条'],
  },
];

const ruleKey = (control) => `standard:${control.key}`;

function rulePayload(control, userId) {
  return {
    name: control.name,
    risk_type: control.domain,
    severity: control.severity,
    detection_type: 'governance_control',
    condition_json: {
      standard_control: control.key,
      nist_function: control.nist_function,
      requirements: control.requirements,
      regulatory_basis: control.regulatory_basis,
    },
    action_json: {
      response: 'record_escalate_review',
      owner: 'ai_safety_officer',
      evidence_required: true,
    },
    status: 'published',
    enabled: true,
    updated_by: userId,
    published_at: new Date(),
  };
}

async function getOverview() {
  const keys = STANDARD_CONTROLS.map(ruleKey);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [rules, openEvents, criticalEvents, highEvents, todayEvents, recentEvents] = await Promise.all([
    prisma.aiRiskRule.findMany({ where: { rule_key: { in: keys } }, orderBy: { id: 'asc' } }),
    prisma.aiRiskEvent.count({ where: { status: { in: ['open', 'confirmed'] } } }),
    prisma.aiRiskEvent.count({ where: { status: { in: ['open', 'confirmed'] }, severity: 'critical' } }),
    prisma.aiRiskEvent.count({ where: { status: { in: ['open', 'confirmed'] }, severity: 'high' } }),
    prisma.aiRiskEvent.count({ where: { detected_at: { gte: today } } }),
    prisma.aiRiskEvent.findMany({
      include: { rule: { select: { name: true, rule_key: true } }, _count: { select: { evidence: true, actions: true } } },
      orderBy: { detected_at: 'desc' }, take: 8,
    }),
  ]);
  const byKey = new Map(rules.map((rule) => [rule.rule_key, rule]));
  const controls = STANDARD_CONTROLS.map((control) => {
    const rule = byKey.get(ruleKey(control));
    return {
      ...control,
      rule_id: rule?.id || null,
      configured: Boolean(rule),
      enabled: Boolean(rule?.enabled),
      status: rule?.status || 'not_configured',
      version: rule?.version || null,
      updated_at: rule?.updated_at || null,
    };
  });
  const activeControls = controls.filter((item) => item.enabled && item.status === 'published').length;
  const posture = criticalEvents ? 'critical' : highEvents ? 'high' : openEvents ? 'medium' : 'low';
  return {
    standard_control_count: controls.length,
    active_control_count: activeControls,
    control_configuration_rate: Number((activeControls / controls.length).toFixed(4)),
    open_event_count: openEvents,
    critical_event_count: criticalEvents,
    high_event_count: highEvents,
    today_event_count: todayEvents,
    risk_posture: posture,
    controls,
    recent_events: recentEvents,
    framework_version: '2026.07',
  };
}

async function syncStandards(req) {
  const userId = Number(req.user.user_id);
  const results = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const control of STANDARD_CONTROLS) {
      const key = ruleKey(control);
      const payload = rulePayload(control, userId);
      const updatePayload = { ...payload };
      delete updatePayload.enabled;
      rows.push(await tx.aiRiskRule.upsert({
        where: { rule_key: key },
        update: updatePayload,
        create: { rule_key: key, ...payload, created_by: userId },
      }));
    }
    return rows;
  });
  await recordAdminOperation({
    req, operationType: 'SYNC_AI_SAFETY_STANDARDS', targetType: 'ai_risk_rule',
    after: { framework_version: '2026.07', control_count: results.length, rule_ids: results.map((item) => item.id) },
  });
  return { synced_count: results.length, framework_version: '2026.07' };
}

async function setRuleEnabled(ruleId, enabled, req) {
  const id = Number(ruleId);
  if (!Number.isInteger(id) || id <= 0 || typeof enabled !== 'boolean') {
    throw Object.assign(new Error('规则 ID 或启用状态无效'), { code: 40001 });
  }
  const rule = await prisma.aiRiskRule.findUnique({ where: { id } });
  if (!rule || !rule.rule_key.startsWith('standard:')) throw Object.assign(new Error('标准安全规则不存在'), { code: 40401 });
  const updated = await prisma.aiRiskRule.update({ where: { id }, data: { enabled, updated_by: Number(req.user.user_id) } });
  await recordAdminOperation({
    req, operationType: enabled ? 'ENABLE_AI_SAFETY_RULE' : 'DISABLE_AI_SAFETY_RULE', targetType: 'ai_risk_rule', targetId: id,
    before: { enabled: rule.enabled }, after: { enabled: updated.enabled, rule_key: updated.rule_key },
  });
  return { id: updated.id, enabled: updated.enabled, updated_at: updated.updated_at };
}

module.exports = { STANDARD_CONTROLS, getOverview, syncStandards, setRuleEnabled };
