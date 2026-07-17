import difyApi from './dify.api.js'

export const difyService = {
  async sendMessage(query, options = {}) {
    const result = await difyApi.chat({ query, inputs: options.inputs, conversation_id: options.conversationId, files: options.files })
    return result.data
  },
  async runWorkflow(inputs) {
    const result = await difyApi.workflow(inputs)
    return result.data
  },
  streamMessage(query, options = {}) {
    return difyApi.streamChat({ query, inputs: options.inputs, conversation_id: options.conversationId, files: options.files }, options)
  },
}

export default difyService
