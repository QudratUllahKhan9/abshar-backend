/*
  Vercel entry point.
  Vercel is file ko /api/index function ke tor par deploy karta hai.
  Server.js se app export hota hai (koi app.listen nahi — serverless).
*/

const app = require('../server');

module.exports = app;
