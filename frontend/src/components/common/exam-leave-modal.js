// 统一考试/练习离开确认模态框
// 用于在答题过程中用户尝试离开时显示确认对话框

/**
 * 显示离开确认模态框
 * @param {Object} options
 * @param {string} options.mode - 'exam' | 'practice' | 'task'
 * @param {string} options.title - 答题类型标题
 * @param {number} options.answeredCount - 已作答题数
 * @param {number} options.totalCount - 总题数
 * @param {number|null} options.remainingSeconds - 剩余时间（秒），null 表示不限时
 * @param {boolean} options.hasUnsavedChanges - 是否有未保存的答案
 * @param {string} options.targetHash - 目标跳转 hash（用于提交后导航）
 * @param {Function} options.onContinue - 继续答题回调
 * @param {Function} options.onSubmitAndLeave - 提交并退出回调（返回 Promise）
 * @param {Function} options.onSaveAndLeave - 保存进度并退出回调（返回 Promise）
 * @param {Function} options.onAbandon - 放弃答题回调（仅限练习模式）
 * @returns {HTMLElement} 模态框 DOM 元素
 */
export function showExamLeaveModal(options = {}) {
  const {
    mode = 'practice',
    title = '答题',
    answeredCount = 0,
    totalCount = 0,
    remainingSeconds = null,
    hasUnsavedChanges = false,
    targetHash = null,
    onContinue,
    onSubmitAndLeave,
    onSaveAndLeave,
    onAbandon,
  } = options;

  const unansweredCount = Math.max(0, totalCount - answeredCount);
  const isExam = mode === 'exam';
  const isTask = mode === 'task';

  // 移除已有模态框
  const existing = document.querySelector('.exam-leave-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'exam-leave-overlay';

  let timeText = '不限时';
  if (remainingSeconds != null && remainingSeconds > 0) {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    timeText = `${m}分${s}秒`;
  }

  let buttonHTML = '';

  if (isExam) {
    // 考试模式：继续答题 + 提交并退出
    buttonHTML = `
      <button class="exam-leave-btn exam-leave-btn-continue" id="exam-leave-continue">
        继续答题
      </button>
      <button class="exam-leave-btn exam-leave-btn-submit" id="exam-leave-submit">
        提交整卷并退出
      </button>
    `;
  } else if (isTask) {
    // 教师任务：继续答题 + 提交并退出 + (可选)保存进度退出
    buttonHTML = `
      <button class="exam-leave-btn exam-leave-btn-continue" id="exam-leave-continue">
        继续答题
      </button>
      <button class="exam-leave-btn exam-leave-btn-submit" id="exam-leave-submit">
        提交并退出
      </button>
      <button class="exam-leave-btn exam-leave-btn-save" id="exam-leave-save">
        保存进度并退出
      </button>
    `;
  } else {
    // 练习模式：继续答题 + 保存退出 + 结束练习
    buttonHTML = `
      <button class="exam-leave-btn exam-leave-btn-continue" id="exam-leave-continue">
        继续答题
      </button>
      <button class="exam-leave-btn exam-leave-btn-save" id="exam-leave-save">
        保存进度并退出
      </button>
      <button class="exam-leave-btn exam-leave-btn-abandon" id="exam-leave-abandon">
        结束练习
      </button>
    `;
  }

  overlay.innerHTML = `
    <div class="exam-leave-mask"></div>
    <div class="exam-leave-dialog">
      <div class="exam-leave-header">
        <h3>${isExam ? '确认离开考试' : isTask ? '确认离开任务' : '确认离开练习'}</h3>
        <p class="exam-leave-subtitle">${title}</p>
      </div>
      <div class="exam-leave-body">
        <div class="exam-leave-stats">
          <div class="exam-leave-stat">
            <span class="exam-leave-stat-label">已作答</span>
            <span class="exam-leave-stat-value">${answeredCount} / ${totalCount}</span>
          </div>
          <div class="exam-leave-stat">
            <span class="exam-leave-stat-label">未作答</span>
            <span class="exam-leave-stat-value" style="color: ${unansweredCount > 0 ? '#ef4444' : '#22c55e'}">${unansweredCount}</span>
          </div>
          <div class="exam-leave-stat">
            <span class="exam-leave-stat-label">剩余时间</span>
            <span class="exam-leave-stat-value">${timeText}</span>
          </div>
        </div>
        ${hasUnsavedChanges ? '<p class="exam-leave-warning">⚠ 当前题目有未保存的答案</p>' : ''}
        ${isExam ? '<p class="exam-leave-notice">离开后无法继续作答，请确认是否要提交整卷。</p>' : ''}
        ${!isExam && unansweredCount > 0 ? `<p class="exam-leave-notice">还有 ${unansweredCount} 道题目未作答。</p>` : ''}
      </div>
      <div class="exam-leave-footer">
        ${buttonHTML}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 锁定 body 滚动
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  function close() {
    overlay.remove();
    document.body.style.overflow = prevOverflow;
  }

  function setButtonsDisabled(disabled) {
    overlay.querySelectorAll('.exam-leave-btn').forEach((btn) => {
      btn.disabled = disabled;
      if (disabled) btn.style.opacity = '0.6';
    });
  }

  // 继续答题
  overlay.querySelector('#exam-leave-continue')?.addEventListener('click', () => {
    close();
    if (onContinue) onContinue();
  });

  // 提交并退出
  overlay.querySelector('#exam-leave-submit')?.addEventListener('click', async () => {
    setButtonsDisabled(true);
    try {
      if (onSubmitAndLeave) {
        await onSubmitAndLeave();
      }
      close();
      if (targetHash) {
        window.location.hash = targetHash;
      }
    } catch (err) {
      setButtonsDisabled(false);
      // 提交失败，显示错误提示
      const notice = overlay.querySelector('.exam-leave-notice');
      if (notice) {
        notice.textContent = err.message || '提交失败，请重试';
        notice.style.color = '#ef4444';
      }
    }
  });

  // 保存进度并退出
  overlay.querySelector('#exam-leave-save')?.addEventListener('click', async () => {
    setButtonsDisabled(true);
    try {
      if (onSaveAndLeave) {
        await onSaveAndLeave();
      }
      close();
      if (targetHash) {
        window.location.hash = targetHash;
      }
    } catch (err) {
      setButtonsDisabled(false);
    }
  });

  // 放弃/结束练习
  overlay.querySelector('#exam-leave-abandon')?.addEventListener('click', () => {
    close();
    if (onAbandon) onAbandon();
    if (targetHash) {
      window.location.hash = targetHash;
    }
  });

  // 点击遮罩关闭 → 继续答题
  overlay.querySelector('.exam-leave-mask')?.addEventListener('click', () => {
    close();
    if (onContinue) onContinue();
  });

  return overlay;
}
