import { EventEmitter } from 'node:events';

export const eventBus = new EventEmitter();
// Several SSE clients (and internal listeners) can subscribe at once —
// raise the default limit rather than let Node warn about "possible
// memory leak" for a perfectly normal fan-out.
eventBus.setMaxListeners(50);
