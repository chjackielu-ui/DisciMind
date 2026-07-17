import { escapeHtml } from '../../utils/format.js'
import AiMessageItem from './AiMessageItem.js'

export default function AiChatBox(options = {}) {
  const messages = Array.isArray(options.messages) ? options.messages : []
  const disabled = options.disabled === true
  const placeholder = String(options.placeholder || '输入你的问题，Enter 发送，Shift + Enter 换行').slice(0, 120)
  return `<section class="ai-chat-box" data-ai-chat-box>
    <div class="ai-chat-box__messages" role="log" aria-live="polite">
      ${messages.length ? messages.map(AiMessageItem).join('') : '<div class="ai-chat-box__empty">开始一次有依据、可追溯的 AI 对话</div>'}
    </div>
    <form class="ai-chat-box__composer" data-ai-chat-form>
      <label class="sr-only" for="ai-chat-input">消息</label>
      <textarea id="ai-chat-input" name="message" maxlength="10000" rows="3" placeholder="${escapeHtml(placeholder)}" ${disabled ? 'disabled' : ''}></textarea>
      <button type="submit" ${disabled ? 'disabled' : ''}>发送</button>
    </form>
  </section>`
}
