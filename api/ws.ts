import { createServer } from 'node:http';
import { attachSignalingServer } from '../server/signaling.js';

const server = createServer();

attachSignalingServer(server);

export default server;

