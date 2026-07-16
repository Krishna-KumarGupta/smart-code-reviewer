import './env.js';

import celery from 'celery-node';
import { celeryClient, analyzePrHandler } from './tasks/analyzePrTask.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize worker instance pointing to Redis using a dedicated queue channel
const worker = celery.createWorker(REDIS_URL, REDIS_URL, 'node-queue');

// Register the analyzePr task handler
worker.register('tasks.analyzePr', analyzePrHandler);

console.log('🚀 Smart Code Reviewer Celery Worker starting up...');
console.log(`Broker URL: ${REDIS_URL}`);

worker.start();
console.log('Worker is now listening for tasks...');
