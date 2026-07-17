const app = require('./src/app');
// Express 5 uses a different internal structure
// Just log the router stack
const stack = app._router ? (app._router.stack || []) : (app.router ? app.router.stack : []);
console.log('Stack length:', stack.length);
for (let i = 0; i < stack.length; i++) {
  const layer = stack[i];
  if (layer.route) {
    console.log(`[${i}] ROUTE: ${Object.keys(layer.route.methods)} ${layer.route.path}`);
  } else if (layer.handle && layer.handle.name === 'router') {
    console.log(`[${i}] ROUTER: name=${layer.handle.name}, regexp=${layer.regexp}`);
  } else if (layer.name === 'router') {
    console.log(`[${i}] ROUTER layer: name=${layer.name}`);
  } else if (layer.handle) {
    console.log(`[${i}] MW: name=${layer.handle.name || 'anonymous'}`);
    if (layer.handle.stack) {
      for (let j = 0; j < layer.handle.stack.length; j++) {
        const sub = layer.handle.stack[j];
        if (sub.route) {
          console.log(`  [${i}.${j}] ROUTE: ${Object.keys(sub.route.methods)} ${sub.route.path}`);
        } else if (sub.handle && sub.handle.name === 'router') {
          console.log(`  [${i}.${j}] SUB-ROUTER`);
          if (sub.handle.stack) {
            for (let k = 0; k < sub.handle.stack.length; k++) {
              const s2 = sub.handle.stack[k];
              if (s2.route) {
                console.log(`    [${i}.${j}.${k}] ROUTE: ${Object.keys(s2.route.methods)} ${s2.route.path}`);
              } else {
                console.log(`    [${i}.${j}.${k}] MW: ${s2.handle?.name || 'anonymous'}`);
              }
            }
          }
        } else {
          console.log(`  [${i}.${j}] MW: ${sub.handle?.name || 'anonymous'}`);
        }
      }
    }
  } else {
    console.log(`[${i}] OTHER:`, typeof layer.handle);
  }
}
