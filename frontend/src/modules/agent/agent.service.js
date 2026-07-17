import agentApi from './agent.api.js'

const payload = response => response?.data ?? response
const validId = (value, label) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new TypeError(`${label}无效`)
  return id
}

async function list(params = {}) { return payload(await agentApi.listAgents(params)) }
async function get(id) { return payload(await agentApi.getAgent(validId(id, '智能体编号'))) }
async function create(data) { return payload(await agentApi.createAgent(data)) }
async function update(id, data) { return payload(await agentApi.updateAgent(validId(id, '智能体编号'), data)) }
async function remove(id) { return payload(await agentApi.deleteAgent(validId(id, '智能体编号'))) }
async function startConversation(id, data = {}) { return payload(await agentApi.createAgentConversation(validId(id, '智能体编号'), data)) }

const agentService = Object.freeze({
  list, get, create, update, remove, startConversation,
  streamConversation: agentApi.streamAgentConversation,
  explainer: agentApi.explainerApi,
  trainer: agentApi.trainerApi,
  diagnostician: agentApi.diagnosticianApi,
})

export default agentService
export { list, get, create, update, remove, startConversation }
