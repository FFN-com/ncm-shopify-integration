const http = require("http");

const port = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("NCM Shopify Integration is running!");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
