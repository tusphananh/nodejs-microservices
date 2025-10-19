const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { registerService } = require("../../common/lib");
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

async function connect() {
  const conn = await amqplib.connect(RABBIT);
  channel = await conn.createChannel();
  await channel.assertExchange("events", "topic", { durable: true });

  const client = new MongoClient(MONGO);
  await client.connect();
  events = client.db("eventstore").collection("events");
}
connect().catch((e) => console.error(e));

app.post("/payments", async (req, res) => {
  const payment = {
    id: uuidv4(),
    orderId: req.body.orderId,
    amount: req.body.amount,
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

  console.log("published payment.processed", payment.id);
  res.send({ ok: true, payment });
});

// health and register
app.get("/health", (req, res) => res.send({ status: "ok" }));
registerService(DISCOVERY, {
  name: "payment-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

app.listen(PORT, () => console.log(`Payment service listening on ${PORT}`));
