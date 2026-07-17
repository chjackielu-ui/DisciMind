import AiChatBox from '../../components/ai/AiChatBox.js'

export default function AiChatPage(options = {}) {
  return `<main class="ai-page ai-chat-page">
    <header><p class="ai-page__eyebrow">DisciMind AI</p><h1>智能对话</h1><p>统一接入课程知识、联网检索与受控工具调用；关键操作会先请求确认。</p></header>
    ${AiChatBox(options)}
  </main>`
}
