import { escapeHtml } from '../../utils/format.js'

export default function AiGeneratePage(options = {}) {
  const mode = ['text', 'image', 'video'].includes(options.mode) ? options.mode : 'text'
  return `<main class="ai-page ai-generate-page" data-ai-generate-page data-mode="${mode}">
    <header><p class="ai-page__eyebrow">AI 创作</p><h1>内容生成工作台</h1><p>模型与供应商能力由管理员统一配置；生成结果必须预览确认后再保存或发布。</p></header>
    <nav class="ai-generate-tabs" aria-label="生成类型">
      ${[['text', '文本'], ['image', '图片'], ['video', '视频']].map(([key, label]) => `<button type="button" data-generate-mode="${key}" aria-pressed="${key === mode}">${label}</button>`).join('')}
    </nav>
    <form class="ai-generate-form" data-ai-generate-form>
      <label>生成要求<textarea name="prompt" maxlength="10000" required placeholder="${escapeHtml(options.placeholder || '描述主题、受众、风格和输出要求')}"></textarea></label>
      <div class="ai-generate-form__actions"><button type="submit">生成预览</button></div>
    </form>
    <section class="ai-generate-result" aria-live="polite"><p>结果将在这里预览，不会自动入库或发布。</p></section>
  </main>`
}
