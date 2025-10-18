// services/order-service/index.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const amqplib = require("amqplib");
const { registerService } = require("../../common/lib");
const { MongoClient } = require("mongodb");
const pLimit = require("p-limit").default;

const PORT = process.env.PORT || 4100;
const DISCOVERY = process.env.DISCOVERY_URL || "http://localhost:3000";
const RABBIT = process.env.RABBIT || "amqp://guest:guest@localhost:5672";
const MONGO = process.env.MONGO || "mongodb://localhost:27017";

const app = express();
app.use(express.json());

const instanceId = uuidv4();

let channel;
let events;
const limit = pLimit(5); // Bulkhead: allow 5 concurrent order handling

async function connect() {
  const conn = await amqplib.connect(RABBIT);
  channel = await conn.createChannel();
  await channel.assertExchange("events", "topic", { durable: true });

  const client = new MongoClient(MONGO);
  await client.connect();
  events = client.db("eventstore").collection("events");
}
connect().catch((e) => console.error(e));

app.post("/orders", async (req, res) => {
  // handle commands with bulkhead concurrency limit
  limit(async () => {
    const id = uuidv4();
    const order = {
      id,
      items: req.body.items || [],
      status: "CREATED",
      createdAt: new Date(),
    };
    // Append event to event store (Event Sourcing)
    await events.insertOne({
      streamId: id,
      type: "OrderCreated",
      payload: order,
      timestamp: new Date(),
    });
    // Publish event
    channel.publish(
      "events",
      "order.created",
      Buffer.from(JSON.stringify({ id, order })),
      { persistent: true }
    );
    console.log("published order.created", id);
    res.send({ ok: true, id });
  }).catch((err) => {
    console.error("order handling error", err);
    res.status(500).send({ error: err.message });
  });
});

// health and register
app.get("/health", (req, res) => res.send({ status: "ok" }));
registerService(DISCOVERY, {
  name: "order-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

app.listen(PORT, () => console.log(`Order service listening ${PORT}`));
