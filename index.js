const http = require("http");
const https = require("https");

const port = process.env.PORT || 10000;

function getNcmBranches(callback) {
  const options = {
    hostname: "demo.nepalcanmove.com",
    path: "/api/v2/vendor/assigned-branches",
    method: "GET",
    headers: {
      Authorization: `Token ${process.env.NCM_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  };

  const request = https.request(options, (response) => {
    let data = "";

    response.on("data", (chunk) => {
      data += chunk;
    });

    response.on("end", () => {
      callback(response.statusCode, data);
    });
  });

  request.on("error", (error) => {
    callback(500, JSON.stringify({ error: error.message }));
  });

  request.end();
}

const server = http.createServer((req, res) => {

  // Main page
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("NCM Shopify Integration is running!");
    return;
  }

  // Shopify callback
  if (req.url.startsWith("/auth/callback")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Shopify authentication callback received successfully!");
    return;
  }

  // Test NCM API connection
  if (req.url.startsWith("/test-ncm")) {
    getNcmBranches((statusCode, data) => {
      res.writeHead(statusCode, {
        "Content-Type": "application/json",
      });
      res.end(data);
    });
    return;
  }

  // Page not found
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Page not found");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
