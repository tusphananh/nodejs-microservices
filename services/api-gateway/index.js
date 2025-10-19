// services/api-gateway/index.js
const express = require("express");
const axios = require("axios");
const {
  registerService,
  getService,
  autoRegister,
} = require("../../common/lib");
const CircuitBreaker = require("opossum");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

// Simple permissive CORS middleware so browser-based frontend can call the gateway
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  // respond to preflight
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

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

autoRegister(DISCOVERY, {
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

// NEW: get order status by asking order-service
app.get("/orders/:id/status", async (req, res) => {
  try {
    const orderServiceUrl = await resolveService("order-service");
    const url = `${orderServiceUrl}/orders/${encodeURIComponent(
      req.params.id
    )}`;
    const data = await breaker.fire({ method: "get", url });
    res.send(data);
  } catch (err) {
    console.error("gateway status error", err.message);
    res.status(503).send({ error: err.message });
  }
});

// NEW: get current balance by asking payment-service
app.get("/balance", async (req, res) => {
  try {
    const paymentServiceUrl = await resolveService("payment-service");
    const url = `${paymentServiceUrl}/balance`;
    const data = await breaker.fire({ method: "get", url });
    res.send(data);
  } catch (err) {
    console.error("gateway balance error", err.message);
    res.status(503).send({ error: err.message });
  }
});

app.get("/products", async (req, res) => {
  try {
    const orderServiceUrl = await resolveService("order-service");
    const url = `${orderServiceUrl}/products`;
    const data = await breaker.fire({ method: "get", url });
    res.send(data);
  } catch (err) {
    console.error("gateway balance error", err.message);
    res.status(503).send({ error: err.message });
  }
});

// NEW: proxy payment requests to payment-service
app.post("/payments", async (req, res) => {
  try {
    const paymentServiceUrl = await resolveService("payment-service");
    const url = `${paymentServiceUrl}/payments`;
    const data = await breaker.fire({ method: "post", url, data: req.body });
    res.send(data);
  } catch (err) {
    console.error("gateway payment error", err.message);
    res.status(503).send({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`API Gateway listening ${PORT}`);
});
