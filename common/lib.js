// common/lib.js
const axios = require("axios");

async function registerService(discoveryUrl, service) {
  await axios.post(`${discoveryUrl}/register`, service).catch((e) => {
    console.error("register error", e.message);
  });
}

async function getService(discoveryUrl, name) {
  const res = await axios.get(`${discoveryUrl}/services/${name}`);
  return res.data;
}

module.exports = { registerService, getService };
