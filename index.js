const http = require("http");

const port = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  // Main page
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("NCM Shopify Integration is running!");
    return;
  }

  // Shopify redirect callback
  if (req.url.startsWith("/auth/callback")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Shopify authentication callback received successfully!");
    return;
  }

  // Anything else
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Page not found");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
