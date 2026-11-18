// A stand-in for Mailchimp and the Claude API for the browser tests of the list builder (see playwright.config.ts).
// Run: node scripts/fake-email-apis.ts <port>. It never talks to the real services.
import { createServer } from "node:http";
import { createFake } from "../src/lib/email-lists-fake.testkit.ts";

const port = Number(process.argv[2] ?? 3107);
const fake = createFake();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
  const answer = await fake.handle(`http://localhost:${port}${req.url}`, { method: req.method, body });
  res.writeHead(answer.status, { "Content-Type": "application/json" });
  res.end(await answer.text());
}).listen(port, () => console.log(`fake email APIs on ${port}`));
