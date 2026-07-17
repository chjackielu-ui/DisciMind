import * as marketplace from '../../api/marketplace.js'
import { explainerApi, trainerApi, diagnosticianApi } from '../../api/agent.js'

export * from '../../api/marketplace.js'
export { explainerApi, trainerApi, diagnosticianApi }

const agentApi = Object.freeze({ ...marketplace, explainerApi, trainerApi, diagnosticianApi })

export default agentApi
