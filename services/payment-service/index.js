// services/payment-service/index.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const {
  registerService,
  autoRegister,
  getService,
} = require("../../common/lib");
const axios = require("axios");
const amqplib = require("amqplib");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 4200;
const DISCOVERY = process.env.DISCOVERY_URL || "http://localhost:3000";
const RABBIT = process.env.RABBIT || "amqp://guest:guest@localhost:5672";
const MONGO = process.env.MONGO || "mongodb://localhost:27017";

const app = express();
app.use(express.json());

const instanceId = uuidv4();

let channel;
let events;
let balancesColl;

async function processPayment({ orderId, amount }) {
  // Only orderId is accepted by design. If amount isn't provided, fetch order totalPrice from order-service.
  let parsedAmount =
    amount != null && !Number.isNaN(Number(amount)) ? Number(amount) : null;

  if ((parsedAmount === null || parsedAmount === 0) && orderId) {
    try {
      const services = await getService(DISCOVERY, "order-service");
      if (!services || services.length === 0) {
        console.error("order-service not available from discovery");
        return { ok: false, error: "order_service_unavailable" };
      }
      const orderServiceUrl =
        services[Math.floor(Math.random() * services.length)].url;
      const resp = await axios.get(
        `${orderServiceUrl}/orders/${encodeURIComponent(orderId)}`
      );
      const order = resp && resp.data;
      if (!order || order.totalPrice == null) {
        console.error("order not found or missing totalPrice", orderId);
        return { ok: false, error: "order_not_found" };
      }
      parsedAmount = Number(order.totalPrice);
    } catch (err) {
      console.error(
        "failed to fetch order from order-service",
        err.message || err
      );
      return { ok: false, error: "failed_fetch_order" };
    }
  }

  try {
    const balDoc = await balancesColl.findOne({ id: "main" });
    console.log(
      "process payment with amount: ",
      parsedAmount + "$",
      " with current balance: " + (balDoc && balDoc.balance) + "$"
    );

    const isNotEnough =
      !balDoc || Number(balDoc.balance) < Number(parsedAmount);

    if (!balDoc || Number(balDoc.balance) < Number(parsedAmount)) {
      const failedPayment = {
        id: uuidv4(),
        orderId,
        amount: parsedAmount,
        status: "FAILED",
        reason: "Insufficient service funds",
        createdAt: new Date(),
      };
      await events.insertOne({
        streamId: failedPayment.id,
        type: "PaymentFailed",
        payload: failedPayment,
        timestamp: new Date(),
      });
      channel.publish(
        "events",
        "payment.failed",
        Buffer.from(JSON.stringify({ payment: failedPayment })),
        { persistent: true }
      );

      console.log("Publishing failed payment event: payment.failed");

      return { ok: false, error: "Insufficient service funds" };
    }

    // deduct and publish processed
    await balancesColl.updateOne(
      { id: "main" },
      { $inc: { balance: -parsedAmount } }
    );

    const payment = {
      id: uuidv4(),
      orderId,
      amount: parsedAmount,
      status: "COMPLETED",
      createdAt: new Date(),
    };
    await events.insertOne({
      streamId: payment.id,
      type: "PaymentProcessed",
      payload: payment,
      timestamp: new Date(),
    });

    channel.publish(
      "events",
      "payment.processed",
      Buffer.from(JSON.stringify({ payment })),
      { persistent: true }
    );
    return { ok: true, payment };
  } catch (error) {
    console.log(error);
    const failedPayment = {
      id: uuidv4(),
      orderId,
      amount: parsedAmount,
      status: "FAILED",
      reason: "processing_error",
      createdAt: new Date(),
    };
    await events.insertOne({
      streamId: failedPayment.id,
      type: "PaymentFailed",
      payload: failedPayment,
      timestamp: new Date(),
    });
    channel.publish(
      "events",
      "payment.failed",
      Buffer.from(JSON.stringify({ payment: failedPayment })),
      { persistent: true }
    );

    return { ok: false, payment: failedPayment };
  }
}

async function connect() {
  const conn = await amqplib.connect(RABBIT);
  channel = await conn.createChannel();
  await channel.assertExchange("events", "topic", { durable: true });

  const client = new MongoClient(MONGO);
  await client.connect();
  events = client.db("eventstore").collection("events");

  // NEW: init balances collection with $1000 if not already
  balancesColl = client.db("app").collection("balances");
  await balancesColl.updateOne(
    { id: "main" },
    { $setOnInsert: { id: "main", balance: 1000 } },
    { upsert: true }
  );
}

async function connect() {
  const conn = await amqplib.connect(RABBIT);
  channel = await conn.createChannel();
  await channel.assertExchange("events", "topic", { durable: true });

  const client = new MongoClient(MONGO);
  await client.connect();
  events = client.db("eventstore").collection("events");

  // NEW: init balances collection with $1000 if not already
  balancesColl = client.db("app").collection("balances");
  await balancesColl.updateOne(
    { id: "main" },
    { $setOnInsert: { id: "main", balance: 1000 } },
    { upsert: true }
  );

  // --- NEW: subscribe to payment.request published by saga ---
  const q = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(q.queue, "events", "payment.request");
  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    const rk = msg.fields.routingKey;
    const data = JSON.parse(msg.content.toString());
    try {
      if (rk === "payment.request") {
        await processPayment(data);
      }
      channel.ack(msg);
    } catch (err) {
      console.error("failed processing event", err);
      channel.nack(msg, false, false);
    }
  });
  // -----------------------------------------------------------
}

// NEW: expose current balance
app.get("/balance", async (req, res) => {
  const balDoc = await balancesColl.findOne({ id: "main" });
  res.send({ balance: balDoc ? balDoc.balance : 0 });
});

// POST /payments - accept orderId, items (with price/qty) and/or amount
app.post("/payments", async (req, res) => {
  const { orderId, items, amount } = req.body || {};

  if (
    !orderId &&
    (!Array.isArray(items) || items.length === 0) &&
    (amount == null || Number.isNaN(Number(amount)))
  ) {
    return res
      .status(400)
      .send({ error: "orderId or items or amount is required" });
  }

  // determine parsedAmount: explicit amount > compute from items > undefined (let processPayment fetch order)
  let parsedAmount =
    amount != null && !Number.isNaN(Number(amount)) ? Number(amount) : null;
  if (
    (parsedAmount === null || parsedAmount === 0) &&
    Array.isArray(items) &&
    items.length
  ) {
    parsedAmount = items.reduce((total, it) => {
      const price = Number(it.price) || 0;
      const qty = Number(it.qty) || 0;
      return total + price * qty;
    }, 0);
  }

  try {
    const result = await processPayment({ orderId, amount: parsedAmount });
    if (!result || !result.ok) {
      return res.status(400).send({
        ok: false,
        error: result && result.error ? result.error : "payment_failed",
        payment: result && result.payment ? result.payment : undefined,
      });
    }
    return res.send({ ok: true, payment: result.payment });
  } catch (err) {
    console.error("POST /payments error", err);
    return res.status(500).send({ error: err.message || "internal_error" });
  }
});

// health and register
app.get("/health", (req, res) => res.send({ status: "ok" }));
registerService(DISCOVERY, {
  name: "payment-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

autoRegister(DISCOVERY, {
  name: "payment-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

connect().catch((e) => console.error(e));
app.listen(PORT, () => console.log(`Payment service listening on ${PORT}`));
