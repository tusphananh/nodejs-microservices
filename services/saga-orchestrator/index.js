// services/saga-orchestrator/index.js
const amqplib = require("amqplib");
const { registerService, autoRegister } = require("../../common/lib");
const { v4: uuidv4 } = require("uuid");

const RABBIT = process.env.RABBIT || "amqp://guest:guest@localhost:5672";
const DISCOVERY = process.env.DISCOVERY_URL || "http://localhost:3000";
const instanceId = uuidv4();
registerService(DISCOVERY, {
  name: "saga-orchestrator",
  url: `http://localhost:4300`,
  instanceId,
}).catch(() => {});

autoRegister(DISCOVERY, {
  name: "saga-orchestrator",
  url: `http://localhost:4300`,
  instanceId,
});

async function start() {
  const conn = await amqplib.connect(RABBIT);
  const ch = await conn.createChannel();
  await ch.assertExchange("events", "topic", { durable: true });
  const q = await ch.assertQueue("", { exclusive: true });
  await ch.bindQueue(q.queue, "events", "order.*");
  await ch.bindQueue(q.queue, "events", "inventory.*");

  ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    const rk = msg.fields.routingKey;
    const data = JSON.parse(msg.content.toString());
    console.log("saga got", rk, data);
    if (rk === "order.created") {
      // start saga: ask inventory to reserve (inventory service already listens)
      // Might store saga state in DB — omitted for brevity
    } else if (rk === "inventory.reservation_failed") {
      // compensation: publish order.cancel or trigger refund
      ch.publish(
        "events",
        "order.cancel",
        Buffer.from(JSON.stringify({ id: data.id, reason: data.reason })),
        { persistent: true }
      );
      console.log("Saga: order.cancel published for", data.id);
    } else if (rk === "inventory.reserved") {
      // continue: publish order.confirmed
      ch.publish(
        "events",
        "order.confirmed",
        Buffer.from(JSON.stringify({ id: data.id })),
        { persistent: true }
      );
      console.log("Saga: order.confirmed for", data.id);
    }
    ch.ack(msg);
  });
}

start().catch(console.error);
