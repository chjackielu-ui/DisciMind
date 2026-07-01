// 学生端控制器
// 负责接收请求、参数校验、调用服务层、返回统一响应

const { success, fail } = require('../utils/response');
const studentService = require('../services/student.service');

// ========================
// 辅助：从 req 中获取 userId
// ========================

function getUserId(req) {
  return req.user?.user_id;
}

// ========================
// 1. Dashboard（已有）
// ========================

async function getDashboard(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return fail(res, 40101, '无法获取用户身份');
    }
    const data = await studentService.getDashboard(userId);
    return success(res, data, '获取仪表盘数据成功');
  } catch (err) {
    console.error('[student.controller] getDashboard 异常:', err.message);
    if (err.code === 40401) return fail(res, 40401, '用户不存在');
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 2. 课程相关
// ========================

/**
 * GET /api/student/courses
 */
async function getCourses(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getStudentCourses(userId);
    return success(res, data, '获取课程列表成功');
  } catch (err) {
    console.error('[student.controller] getCourses 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * GET /api/student/courses/:course_id
 */
async function getCourseDetail(req, res) {
  try {
    const userId = getUserId(req);
    const courseId = parseInt(req.params.course_id, 10);

    if (isNaN(courseId) || courseId < 1) {
      return fail(res, 40001, 'course_id 参数不合法');
    }

    const data = await studentService.getStudentCourseDetail(userId, courseId);
    return success(res, data, '获取课程详情成功');
  } catch (err) {
    console.error('[student.controller] getCourseDetail 异常:', err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    if (err.code === 40002) return fail(res, 40002, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * GET /api/student/courses/:course_id/chapters
 */
async function getCourseChapters(req, res) {
  try {
    const userId = getUserId(req);
    const courseId = parseInt(req.params.course_id, 10);

    if (isNaN(courseId) || courseId < 1) {
      return fail(res, 40001, 'course_id 参数不合法');
    }

    const data = await studentService.getStudentCourseChapters(userId, courseId);
    return success(res, data, '获取章节列表成功');
  } catch (err) {
    console.error('[student.controller] getCourseChapters 异常:', err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * GET /api/student/courses/:course_id/knowledge-points
 */
async function getCourseKnowledgePoints(req, res) {
  try {
    const userId = getUserId(req);
    const courseId = parseInt(req.params.course_id, 10);

    if (isNaN(courseId) || courseId < 1) {
      return fail(res, 40001, 'course_id 参数不合法');
    }

    const data = await studentService.getStudentCourseKnowledgePoints(userId, courseId);
    return success(res, data, '获取知识点列表成功');
  } catch (err) {
    console.error('[student.controller] getCourseKnowledgePoints 异常:', err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * GET /api/student/knowledge-points/:knowledge_point_id
 */
async function getKnowledgePointDetail(req, res) {
  try {
    const userId = getUserId(req);
    const kpId = parseInt(req.params.knowledge_point_id, 10);

    if (isNaN(kpId) || kpId < 1) {
      return fail(res, 40001, 'knowledge_point_id 参数不合法');
    }

    const data = await studentService.getKnowledgePointDetail(userId, kpId);
    return success(res, data, '获取知识点详情成功');
  } catch (err) {
    console.error('[student.controller] getKnowledgePointDetail 异常:', err.message);
    if (err.code === 40002) return fail(res, 40002, err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 3. 学习任务相关
// ========================

/**
 * GET /api/student/tasks
 */
async function getTasks(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getStudentTasks(userId, req.query);
    return success(res, data, '获取任务列表成功');
  } catch (err) {
    console.error('[student.controller] getTasks 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * GET /api/student/tasks/:task_id
 */
async function getTaskDetail(req, res) {
  try {
    const userId = getUserId(req);
    const taskId = parseInt(req.params.task_id, 10);

    if (isNaN(taskId) || taskId < 1) {
      return fail(res, 40001, 'task_id 参数不合法');
    }

    const data = await studentService.getStudentTaskDetail(userId, taskId);
    return success(res, data, '获取任务详情成功');
  } catch (err) {
    console.error('[student.controller] getTaskDetail 异常:', err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    if (err.code === 40002) return fail(res, 40002, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 4. 错题本相关
// ========================

/**
 * GET /api/student/wrong-questions
 */
async function getWrongQuestions(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getWrongQuestions(userId, req.query);
    return success(res, data, '获取错题本成功');
  } catch (err) {
    console.error('[student.controller] getWrongQuestions 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * PATCH /api/student/wrong-questions/:wrong_question_id/status
 */
async function updateWrongQuestionStatus(req, res) {
  try {
    const userId = getUserId(req);
    const wqId = parseInt(req.params.wrong_question_id, 10);

    if (isNaN(wqId) || wqId < 1) {
      return fail(res, 40001, 'wrong_question_id 参数不合法');
    }

    const { status: newStatus } = req.body;
    if (!newStatus) {
      return fail(res, 40001, 'status 不能为空');
    }

    const data = await studentService.updateWrongQuestionStatus(userId, wqId, newStatus);
    return success(res, data, '更新错题状态成功');
  } catch (err) {
    console.error('[student.controller] updateWrongQuestionStatus 异常:', err.message);
    if (err.code === 40001) return fail(res, 40001, err.message);
    if (err.code === 40002) return fail(res, 40002, err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 5. 推荐内容相关
// ========================

/**
 * GET /api/student/recommendations
 */
async function getRecommendations(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getRecommendations(userId, req.query);
    return success(res, data, '获取推荐内容成功');
  } catch (err) {
    console.error('[student.controller] getRecommendations 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 6. 学习记录相关
// ========================

/**
 * GET /api/student/study-records
 */
async function getStudyRecords(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getStudyRecords(userId, req.query);
    return success(res, data, '获取学习记录成功');
  } catch (err) {
    console.error('[student.controller] getStudyRecords 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

/**
 * POST /api/student/study-records
 */
async function createStudyRecord(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.createStudyRecord(userId, req.body);
    return success(res, data, '创建学习记录成功');
  } catch (err) {
    console.error('[student.controller] createStudyRecord 异常:', err.message);
    if (err.code === 40001) return fail(res, 40001, err.message);
    if (err.code === 40301) return fail(res, 40301, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 7. 学生画像相关
// ========================

/**
 * GET /api/student/portrait
 */
async function getPortrait(req, res) {
  try {
    const userId = getUserId(req);
    const data = await studentService.getStudentPortrait(userId);
    return success(res, data, '获取学生画像成功');
  } catch (err) {
    console.error('[student.controller] getPortrait 异常:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 导出
// ========================

module.exports = {
  getDashboard,
  getCourses,
  getCourseDetail,
  getCourseChapters,
  getCourseKnowledgePoints,
  getKnowledgePointDetail,
  getTasks,
  getTaskDetail,
  getWrongQuestions,
  updateWrongQuestionStatus,
  getRecommendations,
  getStudyRecords,
  createStudyRecord,
  getPortrait,
};
