import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

const config = loadConfig();
const server = createApp({ config });

server.listen(config.port, () => {
  console.info(JSON.stringify({
    event: 'gateway.start',
    port: config.port,
    googleProject: config.googleProject,
    googleLocation: config.googleLocation,
  }));
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
