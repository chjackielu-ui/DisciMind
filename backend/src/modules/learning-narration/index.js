const { getNarrationConfig, initializeNarrationStorage, safeConfigSummary } = require('./config');
const { BailianRealtimeTtsAdapter } = require('./adapters/bailian-realtime-tts.adapter');
const { NarrationCacheService } = require('./services/narration-cache.service');
const { NarrationJobService } = require('./services/narration-job.service');
const { createRoutes } = require('./routes/learning-narration.routes');
const { attachLearningNarrationGateway } = require('./ws/learning-narration.gateway');

let singleton;
function getLearningNarrationModule() {
  if (singleton) return singleton;
  const config = initializeNarrationStorage(getNarrationConfig());
  const adapter = new BailianRealtimeTtsAdapter(config);
  const cache = new NarrationCacheService(config);
  const jobService = new NarrationJobService({ config, adapter, cache });
  singleton = {
    config, adapter, cache, jobService,
    publicSettings: () => ({
      enabled: config.enabled, unavailableReason: config.unavailableReason,
      autoplayDefault: config.autoplayDefault, voice: config.enabled ? config.voice : null,
      format: config.responseFormat, sampleRate: config.sampleRate,
      playbackRates: [0.75, 1, 1.25, 1.5, 2],
    }),
    routes: null,
    attach(server) { this.gateway = attachLearningNarrationGateway(server, jobService); return this.gateway; },
    close() { this.gateway?.close(); jobService.closeAll(); },
  };
  singleton.routes = createRoutes(singleton);
  console.log(`[learning-narration] ${JSON.stringify(safeConfigSummary(config))}`);
  return singleton;
}

module.exports = { getLearningNarrationModule };
