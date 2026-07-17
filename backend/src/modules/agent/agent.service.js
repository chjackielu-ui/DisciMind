module.exports = Object.freeze({
  trainer: require('./trainer/trainer.service'),
  explainer: require('./explainer/explainer.service'),
  diagnostician: require('./diagnostician/diagnostician.service'),
  intervention: require('./common/intervention.service'),
});
