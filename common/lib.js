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

function autoRegister(discoveryUrl, service, interval = 60000) {
  setInterval(() => {
    console.log(
      `Auto Registering Discovery Service [${service.name}] heartbeat`
    );
    registerService(discoveryUrl, service).catch((err) =>
      console.error(`[${service}] heartbeat failed`, err.message)
    );
  }, interval);
}

module.exports = { registerService, getService, autoRegister };
