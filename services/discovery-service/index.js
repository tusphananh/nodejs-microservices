// services/discovery-service/index.js
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 3000;

const registry = {}; // { name: [ {url, instanceId, meta, lastSeen} ] }

app.post("/register", (req, res) => {
  const { name, url, instanceId, meta } = req.body;
  if (!name || !url) return res.status(400).send("name and url required");
  registry[name] = registry[name] || [];
  // replace existing with same instanceId
  registry[name] = registry[name].filter((i) => i.instanceId !== instanceId);
  registry[name].push({ url, instanceId, meta, lastSeen: Date.now() });
  res.send({ ok: true });
});

app.get("/services/:name", (req, res) => {
  const list = registry[req.params.name] || [];
  // simple liveness filter
  const alive = list.filter((i) => Date.now() - i.lastSeen < 1000 * 60 * 5);
  res.send(alive);
});

app.get("/services", (req, res) => res.send(registry));

app.listen(port, () => console.log(`Discovery service listening ${port}`));
