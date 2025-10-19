// services/projection-service/index.js
const amqplib = require("amqplib");
const { MongoClient } = require("mongodb");

const RABBIT = process.env.RABBIT || "amqp://guest:guest@localhost:5672";
const MONGO = process.env.MONGO || "mongodb://localhost:27017";

async function start() {
  const conn = await amqplib.connect(RABBIT);
  const ch = await conn.createChannel();
  await ch.assertExchange("events", "topic", { durable: true });

  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db("readmodel");
  const orders = db.collection("orders");

  const q = await ch.assertQueue("", { exclusive: true });
  await ch.bindQueue(q.queue, "events", "order.*");
  await ch.bindQueue(q.queue, "events", "inventory.*");

  ch.consume(q.queue, async (msg) => {
    const rk = msg.fields.routingKey;
    const data = JSON.parse(msg.content.toString());
    // Apply simple projections
    if (rk === "order.created") {
      await orders.insertOne({
        id: data.id,
        items: data.order.items,
        totalPrice:
          data.order.totalPrice ||
          (data.order.items || []).reduce(
            (s, i) => s + (i.qty || 0) * (i.price || 10),
            0
          ),
        status: "CREATED",
        createdAt: new Date(),
      });
    } else if (rk === "order.confirmed") {
      await orders.updateOne(
        { id: data.id },
        { $set: { status: "CONFIRMED" } }
      );
    } else if (rk === "inventory.reservation_failed") {
      await orders.updateOne(
        { id: data.id },
        { $set: { status: "FAILED", reason: data.reason } }
      );
    } else if (rk === "order.cancel") {
      await orders.updateOne(
        { id: data.id },
        { $set: { status: "CANCELLED" } }
      );
    } else if (rk === "order.failed_payment") {
      await orders.updateOne(
        { id: data.id },
        { $set: { status: "FAILED_PAYMENT" } }
      );
    }
    ch.ack(msg);
  });

  console.log("Projection service started");
}
start().catch(console.error);
