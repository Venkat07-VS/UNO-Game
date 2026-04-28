const serverless = require('serverless-http');
const app = require('../../server/src/app');

module.exports.handler = serverless(app);
