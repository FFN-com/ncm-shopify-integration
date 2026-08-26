const http = require("http");
const https = require("https");

const port = process.env.PORT || 10000;

function getNcmData(path, callback) {
  const options = {
    hostname: "demo.nepalcanmove.com",
    path: path,
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
    callback(
      500,
      JSON.stringify({
        error: error.message,
      })
    );
  });

  request.end();
}

const server = http.createServer((req, res) => {

  // Main page
  if (req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });

    res.end("NCM Shopify Integration is running!");
    return;
  }

  // Shopify authentication callback
  if (req.url.startsWith("/auth/callback")) {
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });

    res.end("Shopify authentication callback received successfully!");
    return;
  }

  // Test vendor assigned pickup branches
  if (req.url.startsWith("/test-ncm")) {
    getNcmData(
      "/api/v2/vendor/assigned-branches",
      (statusCode, data) => {
        res.writeHead(statusCode, {
          "Content-Type": "application/json",
        });

        res.end(data);
      }
    );

    return;
  }

  // Test all NCM branches
  if (req.url.startsWith("/test-branches")) {
    getNcmData(
      "/api/v2/branches",
      (statusCode, data) => {
        res.writeHead(statusCode, {
          "Content-Type": "application/json",
        });

        res.end(data);
      }
    );

    return;
  }

  // Page not found
  res.writeHead(404, {
    "Content-Type": "text/plain",
  });

  res.end("Page not found");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
