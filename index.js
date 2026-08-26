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
// Test NCM branch selection
if (req.url.startsWith("/test-branch")) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const address = url.searchParams.get("address");

  if (!address) {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Please provide an address. Example: /test-branch?address=Pokhara"
    }));

    return;
  }

  getNcmData(
    "/api/v2/vendor/assigned-branches",
    (statusCode, data) => {
      try {
        const branches = JSON.parse(data);

        const searchAddress = address.toUpperCase();

        const selectedBranch = branches.find(branch => {
          const branchName = (branch.name || "").toUpperCase();
          const district = (branch.district_name || "").toUpperCase();
          const areas = (branch.areas_covered || "").toUpperCase();
          const branchAddress = (branch.address || "").toUpperCase();

          return (
            searchAddress.includes(branchName) ||
            searchAddress.includes(district) ||
            areas.includes(searchAddress) ||
            branchAddress.includes(searchAddress)
          );
        });

        res.writeHead(200, {
          "Content-Type": "application/json"
        });

        if (selectedBranch) {
  res.end(JSON.stringify({
    customer_address: address,
    selected_branch: selectedBranch.name,
    branch_code: selectedBranch.code,
    district: selectedBranch.district_name,
    province: selectedBranch.province_name,
    branch_address: selectedBranch.address,
    delivery_surcharge: selectedBranch.surcharge,
    matched_branch_raw: selectedBranch
  }, null, 2));
        } else {
          res.end(JSON.stringify({
            customer_address: address,
            selected_branch: null,
            message: "No matching NCM branch found"
          }, null, 2));
        }

      } catch (error) {
        res.writeHead(500, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          error: "Failed to process NCM branch data",
          details: error.message
        }));
      }
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
