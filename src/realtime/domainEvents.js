import { EventEmitter } from 'node:events';

export const domainEvents = new EventEmitter({ captureRejections: true });
domainEvents.on('error', () => {});
