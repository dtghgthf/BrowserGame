import { startServer } from './server';

// Colyseus installs its own SIGINT/SIGTERM handlers for a graceful shutdown.
await startServer();
