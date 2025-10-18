// services/inventory-service/index.js
const amqplib = require("amqplib");
const { MongoClient } = require("mongodb");
const CircuitBreaker = require("opossum");
const { registerService, autoRegister } = require("../../common/lib");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 4200;
const DISCOVERY = process.env.DISCOVERY_URL || "http://localhost:3000";
const RABBIT = process.env.RABBIT || "amqp://guest:guest@localhost:5672";
const MONGO = process.env.MONGO || "mongodb://localhost:27017";

const instanceId = uuidv4();
registerService(DISCOVERY, {
  name: "inventory-service",
  url: `http://localhost:${PORT}`,
  instanceId,
}).catch(() => {});

autoRegister(DISCOVERY, {
  name: "inventory-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

let channel, eventsDb, inventory;

async function connect() {
  const conn = await amqplib.connect(RABBIT);
  channel = await conn.createChannel();
  await channel.assertExchange("events", "topic", { durable: true });

  const client = new MongoClient(MONGO);
  await client.connect();
  const db = client.db("app");
  inventory = db.collection("inventory");
  eventsDb = client.db("eventstore").collection("events");

  const q = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(q.queue, "events", "order.*");
  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    const routing = msg.fields.routingKey;
    const payload = JSON.parse(msg.content.toString());
    try {
      if (routing === "order.created") {
        await handleOrderCreated(payload);
      }
      channel.ack(msg);
    } catch (e) {
      console.error("failed handle message", e);
      channel.nack(msg, false, false); // discard or dead-letter in production
    }
  });
}
connect().catch(console.error);

// circuit-breaker wrapped reserve function (simulate external dependency)
const reserveFunc = async (items) => {
  // check stock in mongo and decrement if available
  for (const it of items) {
    const r = await inventory.findOne({ sku: it.sku });
    if (!r || r.qty < it.qty) throw new Error("insufficient_stock " + it.sku);
  }
  for (const it of items) {
    await inventory.updateOne(
      { sku: it.sku },
      { $inc: { qty: -it.qty } },
      { upsert: true }
    );
  }
  return true;
};
const breaker = new CircuitBreaker(reserveFunc, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 5000,
});

async function handleOrderCreated({ id, order }) {
  try {
    await breaker.fire(order.items);
    // write event to event store
    await eventsDb.insertOne({
      streamId: id,
      type: "InventoryReserved",
      payload: { id, items: order.items },
      timestamp: new Date(),
    });
    // Publish event that inventory reserved
    channel.publish(
      "events",
      "inventory.reserved",
      Buffer.from(JSON.stringify({ id, items: order.items })),
      { persistent: true }
    );
    console.log("inventory reserved for", id);
  } catch (err) {
    console.error("reserve failed", err.message);
    // publish compensation / failure event for saga
    channel.publish(
      "events",
      "inventory.reservation_failed",
      Buffer.from(JSON.stringify({ id, reason: err.message })),
      { persistent: true }
    );
  }
}

console.log("Inventory service started");
