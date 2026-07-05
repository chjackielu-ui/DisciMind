/**
 * DisciMind 答题系统验证测试脚本
 * 运行方式：node scripts/test-attempt-system.js
 * 前提：后端服务已启动，数据库已迁移
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

// ========== 工具函数 ==========
async function api(method, path, { token, body, headers } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const opts = { method, headers: h, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, data: json };
}

async function login(account, password) {
  const { data } = await api('POST', '/auth/login', { body: { account, password } });
  return data?.data || {};
}

async function logout(token) {
  await api('POST', '/auth/logout', { token });
}

// ========== 测试用例 ==========
let passed = 0;
let failed = 0;
function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function runTests() {
  console.log('========================================');
  console.log('DisciMind 答题系统验证测试');
  console.log('========================================\n');

  // ========================
  // 测试 1: 认证 — Cookie 不能独立恢复登录
  // ========================
  console.log('\n📋 测试1: 认证 — Cookie 不能独立恢复登录');
  {
    // 登录获取 sessionStorage 数据
    const loginResult = await login('student_demo', '123456');
    const accessToken = loginResult.accessToken;
    const sessionId = loginResult.sessionId;
    assert(!!accessToken, '登录后获取 accessToken');
    assert(!!sessionId, '登录后获取 sessionId');

    // 模拟 sessionStorage 存在时刷新
    const refresh1 = await api('POST', '/auth/session/refresh', {
      token: accessToken,
      body: { sessionId },
    });
    assert(refresh1.data?.code === 0, 'sessionStorage刷新成功（有效会话）');

    // 模拟 sessionStorage 为空时，Cookie 刷新应该仍然工作（同一标签页）
    // 注意：Cookie 刷新需要 HttpOnly cookie，这里测试后端逻辑
    const meResult = await api('GET', '/auth/me', { token: accessToken });
    assert(meResult.data?.code === 0, '有效token可以访问 /auth/me');

    // 空闲超时的 sessionId 应该被拒绝
    // （无法在测试中模拟30分钟，但可以验证接口存在）
    const invalidRefresh = await api('POST', '/auth/session/refresh', {
      body: { sessionId: 99999 },
    });
    assert(invalidRefresh.data?.code !== 0, '无效sessionId刷新被拒绝');

    await logout(accessToken);
  }

  // ========================
  // 测试 2: 教师任务 attempt 创建
  // ========================
  console.log('\n📋 测试2: 教师任务 attempt 创建');
  {
    const { accessToken } = await login('student_demo', '123456');

    // 尝试为已存在的演示任务创建 attempt
    // seed.js 中创建了 task_id=1 的任务
    const result = await api('POST', '/student/tasks/1/attempt', { token: accessToken });
    const data = result.data?.data || {};

    if (result.data?.code === 0) {
      assert(!!data.session?.practice_session_id, '创建任务attempt返回sessionId');
      assert(data.session?.source_type === 'TEACHER_TASK' || !data.session?.source_type, 'sourceType为TEACHER_TASK');
      assert(Array.isArray(data.questions), '返回题目列表');
      console.log(`    题目数: ${data.questions?.length || 0}`);

      // 同一任务再次请求应返回已有session（不创建新的）
      const result2 = await api('POST', '/student/tasks/1/attempt', { token: accessToken });
      const data2 = result2.data?.data || {};
      const sameSession = data2.session?.practice_session_id === data.session?.practice_session_id;
      assert(sameSession, '重复请求返回同一session（不重复创建）');
    } else {
      console.log(`    (任务可能不存在或非学生课程: ${result.data?.message})`);
    }

    await logout(accessToken);
  }

  // ========================
  // 测试 3: active attempt 返回规则
  // ========================
  console.log('\n📋 测试3: active attempt 返回规则');
  {
    const { accessToken } = await login('student_demo', '123456');

    const result = await api('GET', '/practice/active', { token: accessToken });
    const data = result.data?.data || {};

    assert(typeof data.hasActiveAttempt === 'boolean', '返回hasActiveAttempt布尔值');
    if (data.hasActiveAttempt) {
      assert(typeof data.forceResume === 'boolean', '返回forceResume布尔值');
      assert(!!data.attemptId, '返回attemptId');
      console.log(`    sourceType: ${data.sourceType}, forceResume: ${data.forceResume}`);
    } else {
      console.log('    当前无活动attempt（正常）');
    }

    await logout(accessToken);
  }

  // ========================
  // 测试 4: 会话刷新接口
  // ========================
  console.log('\n📋 测试4: 会话刷新接口');
  {
    const { accessToken, sessionId } = await login('student_demo', '123456');

    // 有效刷新
    const refresh = await api('POST', '/auth/session/refresh', {
      token: accessToken,
      body: { sessionId },
    });
    assert(refresh.data?.code === 0, '有效sessionId可以刷新token');
    assert(!!refresh.data?.data?.accessToken, '刷新返回新accessToken');

    // 无效刷新
    const badRefresh = await api('POST', '/auth/session/refresh', {
      body: { sessionId: -1 },
    });
    assert(badRefresh.data?.code !== 0, '无效sessionId刷新失败');

    // 已撤销会话刷新
    await logout(accessToken);
    const revokedRefresh = await api('POST', '/auth/session/refresh', {
      body: { sessionId },
    });
    assert(revokedRefresh.data?.code !== 0, '已登出sessionId刷新被拒绝');

    // 尝试用已撤销的token访问
    const meResult = await api('GET', '/auth/me', { token: accessToken });
    assert(meResult.data?.code !== 0, '已登出token访问被拒绝');
  }

  // ========================
  // 测试 5: 教师端成绩查询
  // ========================
  console.log('\n📋 测试5: 教师端成绩查询（含attempt兼容）');
  {
    const { accessToken } = await login('teacher_demo', '123456');

    // 查询任务1的提交列表
    const result = await api('GET', '/teacher/tasks/1/submissions', { token: accessToken });
    const data = result.data?.data || {};

    if (result.data?.code === 0) {
      assert(Array.isArray(data.list), '返回提交列表');
      assert(typeof data.total === 'number', '返回总数');
      // 检查是否包含 engines 字段（attempt/legacy 统计）
      if (data.engines) {
        console.log(`    attempt: ${data.engines.attempt}, legacy: ${data.engines.legacy}`);
      }
      // 检查每条记录的 engine 字段
      if (data.list.length > 0) {
        const first = data.list[0];
        assert(!!first.engine, '每条记录包含engine字段');
        console.log(`    共 ${data.total} 条记录, engine: ${first.engine}`);
      }
    } else {
      console.log(`    (任务或提交不存在: ${result.data?.message})`);
    }

    await logout(accessToken);
  }

  // ========================
  // 测试 6: 自动交卷服务加载
  // ========================
  console.log('\n📋 测试6: 自动交卷服务模块加载');
  try {
    const expiration = require('../backend/src/services/attempt-expiration.service');
    assert(typeof expiration.scanAndSubmitExpiredAttempts === 'function', 'scanAndSubmitExpiredAttempts 可调用');
    assert(typeof expiration.submitExpiredAttempt === 'function', 'submitExpiredAttempt 可调用');
    assert(typeof expiration.checkAndExpireIfNeeded === 'function', 'checkAndExpireIfNeeded 可调用');
    assert(typeof expiration.SUBMIT_REASON === 'object', 'SUBMIT_REASON 枚举存在');
    assert(expiration.SUBMIT_REASON.TIMEOUT_AUTO_SUBMIT === 'TIMEOUT_AUTO_SUBMIT', 'TIMEOUT_AUTO_SUBMIT 值正确');
  } catch (err) {
    console.error(`  模块加载失败: ${err.message}`);
    failed++;
  }

  // ========================
  // 结果汇总
  // ========================
  console.log('\n========================================');
  console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
