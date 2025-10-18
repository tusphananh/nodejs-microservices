// test/simulate.js
/**
 * End-to-end simulation to demonstrate:
 * - CQRS (write + read model)
 * - Saga orchestration (compensations)
 * - Circuit Breaker (when inventory fails)
 * - Bulkhead (limited concurrency)
 */

const axios = require("axios");
const { MongoClient } = require("mongodb");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const API_GATEWAY = "http://localhost:5005";
const MONGO = "mongodb://localhost:27017";
const mongoClient = new MongoClient(MONGO);

async function main() {
  console.log(`🚀 Starting simulation...`);
  await mongoClient.connect();

  const readModel = mongoClient.db("readmodel").collection("orders");
  const inventoryDb = mongoClient.db("app").collection("inventory");
  const eventStore = mongoClient.db("eventstore").collection("events");

  // Reset databases for clean run
  await readModel.deleteMany({});
  await inventoryDb.deleteMany({});
  await eventStore.deleteMany({});

  // Seed inventory for only SKU A
  await inventoryDb.insertMany([
    { sku: "A", qty: 10 },
    { sku: "B", qty: 0 }, // intentionally insufficient to trigger saga compensation
  ]);

  console.log(`📦 Seeded inventory:`);
  console.table(await inventoryDb.find().toArray());

  // STEP 1: Create successful order (only items with stock)
  console.log(`\n🟢 Creating successful order (sku A)...`);
  const okOrder = await axios.post(`${API_GATEWAY}/orders`, {
    items: [{ sku: "A", qty: 2 }],
  });
  console.log(`✅ Order created:`, okOrder.data);
  const okId = okOrder.data.id;

  // STEP 2: Create failing order (insufficient stock for B)
  console.log(`\n🔴 Creating failing order (sku B)...`);
  const failOrder = await axios.post(`${API_GATEWAY}/orders`, {
    items: [{ sku: "B", qty: 2 }],
  });
  console.log(`📝 Order created (will fail in saga):`, failOrder.data);
  const failId = failOrder.data.id;

  // Wait for async event flow
  console.log(`\n⏳ Waiting 5 seconds for events to propagate...`);
  await delay(5000);

  // STEP 3: Check read model (CQRS projection)
  const allOrders = await readModel.find().toArray();
  console.log(`\n📊 Read model snapshot (CQRS projection):`);
  console.table(
    allOrders.map((o) => ({
      id: o.id,
      status: o.status,
      reason: o.reason || "",
      items: o.items.map((i) => i.sku + ":" + i.qty).join(","),
    }))
  );

  // STEP 4: Show event sourcing history for one order
  const okEvents = await eventStore.find({ streamId: okId }).toArray();
  const failEvents = await eventStore.find({ streamId: failId }).toArray();

  console.log(`\n📜 Event history for successful order:`);
  console.table(
    okEvents.map((e) => ({ type: e.type, time: e.timestamp.toISOString() }))
  );

  console.log(`\n📜 Event history for failed order (saga rollback):`);
  console.table(
    failEvents.map((e) => ({ type: e.type, time: e.timestamp.toISOString() }))
  );

  // STEP 5: Show inventory after saga compensation
  console.log(`\n📦 Inventory after saga compensation:`);
  console.table(await inventoryDb.find().toArray());

  // STEP 6: Simulate Circuit Breaker (call repeatedly to failing service)
  console.log(
    `\n⚡ Simulating circuit breaker by triggering failing orders repeatedly...`
  );
  for (let i = 0; i < 5; i++) {
    try {
      await axios.post(`${API_GATEWAY}/orders`, {
        items: [{ sku: "B", qty: 1 }],
      });
    } catch (err) {
      console.log(`Attempt ${i + 1}:`, err.response?.data || err.message);
    }
  }

  console.log(`\n✅ Demo complete.\n`);
  await mongoClient.close();
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
