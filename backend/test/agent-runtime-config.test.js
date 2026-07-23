const test = require('node:test');
const assert = require('node:assert/strict');
const { agentMode, isLangGraphEnabled } = require('../src/config/agent-runtime');

function withAgentEnv(values, callback) {
  const original = {
    AGENT_MODE: process.env.AGENT_MODE,
    LANGGRAPH_ENABLED: process.env.LANGGRAPH_ENABLED,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('LangGraph is the default Agent runtime', () => {
  withAgentEnv({ AGENT_MODE: null, LANGGRAPH_ENABLED: null }, () => {
    assert.equal(agentMode(), 'langgraph');
    assert.equal(isLangGraphEnabled(), true);
  });
});

test('legacy runtime environment values cannot restore Dify execution', () => {
  withAgentEnv({ AGENT_MODE: 'dify', LANGGRAPH_ENABLED: null }, () => {
    assert.equal(agentMode(), 'langgraph');
    assert.equal(isLangGraphEnabled(), true);
  });
  withAgentEnv({ AGENT_MODE: 'langgraph', LANGGRAPH_ENABLED: 'false' }, () => {
    assert.equal(agentMode(), 'langgraph');
    assert.equal(isLangGraphEnabled(), true);
  });
});
