// services/api-gateway/index.js
const express = require("express");
const axios = require("axios");
const { registerService, getService } = require("../../common/lib");
const CircuitBreaker = require("opossum");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5005;
const DISCOVERY = process.env.DISCOVERY_URL || "http://localhost:3000";

const instanceId = uuidv4();
const SERVICE_NAME = "api-gateway";

// register at start
registerService(DISCOVERY, {
  name: SERVICE_NAME,
  url: `http://localhost:${PORT}`,
  instanceId,
});

async function resolveService(name) {
  const services = await getService(DISCOVERY, name);
  if (!services || services.length === 0) throw new Error("no service");
  // naive round-robin or random
  return services[Math.floor(Math.random() * services.length)].url;
}

// wrap axios call with circuit breaker
function createBreaker() {
  const fire = (opts) => axios(opts).then((r) => r.data);
  const breaker = new CircuitBreaker(fire, {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 5000,
  });
  breaker.fallback(() => {
    throw new Error("Service unavailable (circuit open or failed)");
  });
  return breaker;
}
const breaker = createBreaker();

app.post("/orders", async (req, res) => {
  try {
    const orderServiceUrl = await resolveService("order-service");
    const url = `${orderServiceUrl}/orders`;
    const data = await breaker.fire({ method: "post", url, data: req.body });
    res.send(data);
  } catch (err) {
    console.error("gateway error", err.message);
    res.status(503).send({ error: err.message });
  }
});

app.listen(PORT, () => {
  registerService(DISCOVERY, {
    name: SERVICE_NAME,
    url: `http://localhost:${PORT}`,
    instanceId,
  }).catch(() => {});
  console.log(`API Gateway listening ${PORT}`);
});
