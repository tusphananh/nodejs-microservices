const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { registerService } = require("../../common/lib");
const amqplib = require("amqplib");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 4300;
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

app.post("/notifications", async (req, res) => {
  const notification = {
    id: uuidv4(),
    recipient: req.body.recipient,
    message: req.body.message,
    status: "SENT",
    createdAt: new Date(),
  };

  await events.insertOne({
    streamId: notification.id,
    type: "NotificationSent",
    payload: notification,
    timestamp: new Date(),
  });

  channel.publish(
    "events",
    "notification.sent",
    Buffer.from(JSON.stringify({ notification })),
    { persistent: true }
  );

  console.log("published notification.sent", notification.id);
  res.send({ ok: true, notification });
});

// health and register
app.get("/health", (req, res) => res.send({ status: "ok" }));
registerService(DISCOVERY, {
  name: "notification-service",
  url: `http://localhost:${PORT}`,
  instanceId,
});

app.listen(PORT, () => console.log(`Notification service listening on ${PORT}`));