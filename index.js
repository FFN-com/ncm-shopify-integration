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
// Test NCM shipping rate
if (req.url.startsWith("/test-rate")) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const destination = url.searchParams.get("destination");
  const type = url.searchParams.get("type") || "Send";

  // Only allow Send or B2B
  if (type !== "Send" && type !== "B2B") {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Invalid delivery type. Use Send or B2B."
    }));

    return;
  }

  if (!destination) {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Please provide a destination. Example: /test-rate?destination=POKHARA&type=Send"
    }));

    return;
  }

  const source = "TINKUNE";

  const path =
    `/api/v1/shipping-rate?creation=${encodeURIComponent(source)}` +
    `&destination=${encodeURIComponent(destination.toUpperCase())}` +
    `&type=${encodeURIComponent(type)}`;

  getNcmData(path, (statusCode, data) => {
    res.writeHead(statusCode, {
      "Content-Type": "application/json"
    });

    try {
      const rateData = JSON.parse(data);

      res.end(JSON.stringify({
        test_mode: true,
        message: "Rate lookup only. No NCM delivery order was created.",
        source_branch: source,
        destination_branch: destination.toUpperCase(),
        delivery_type: type === "Send"
          ? "Branch2Door"
          : "Branch2Branch",
        ncm_rate_response: rateData
      }, null, 2));

    } catch (error) {
      res.end(JSON.stringify({
        test_mode: true,
        source_branch: source,
        destination_branch: destination.toUpperCase(),
        delivery_type: type,
        raw_response: data
      }, null, 2));
    }
  });

  return;
}
// Combined NCM delivery test: address -> branch -> rate
if (req.url.startsWith("/test-delivery")) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const address = url.searchParams.get("address");
  const type = url.searchParams.get("type") || "Send";

  if (!address) {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Please provide an address. Example: /test-delivery?address=Gairapatan&type=Send"
    }));

    return;
  }

  if (type !== "Send" && type !== "B2B") {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Invalid delivery type. Use Send or B2B."
    }));

    return;
  }

  const source = "TINKUNE";
  const searchAddress = address.trim().toUpperCase();

  // Get NCM branches
  getNcmData("/api/v2/vendor/assigned-branches", (statusCode, data) => {
    try {
      const branches = JSON.parse(data);

      // First: exact branch name match
      let selectedBranch = branches.find(branch =>
        (branch.name || "").trim().toUpperCase() === searchAddress
      );

      // Second: match an area covered by a branch
      if (!selectedBranch) {
        selectedBranch = branches.find(branch =>
          (branch.areas_covered || "")
            .toUpperCase()
            .includes(searchAddress)
        );
      }

      if (!selectedBranch) {
        res.writeHead(404, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          test_mode: true,
          customer_address: address,
          message: "No matching NCM branch found"
        }, null, 2));

        return;
      }

      const destination = selectedBranch.name;

      // Get NCM shipping rate
      const ratePath =
        `/api/v1/shipping-rate?creation=${encodeURIComponent(source)}` +
        `&destination=${encodeURIComponent(destination)}` +
        `&type=${encodeURIComponent(type)}`;

      getNcmData(ratePath, (rateStatusCode, rateData) => {
        try {
          const rateResponse = JSON.parse(rateData);

          res.writeHead(rateStatusCode, {
            "Content-Type": "application/json"
          });

          res.end(JSON.stringify({
            test_mode: true,
            message: "Branch lookup and rate lookup only. No NCM delivery order was created.",
            customer_address: address,
            source_branch: source,
            destination_branch: selectedBranch.name,
            branch_code: selectedBranch.code,
            district: selectedBranch.district_name,
            province: selectedBranch.province_name,
            delivery_type: type === "Send"
              ? "Branch2Door"
              : "Branch2Branch",
            ncm_delivery_charge: rateResponse.charge
          }, null, 2));

        } catch (error) {
          res.writeHead(500, {
            "Content-Type": "application/json"
          });

          res.end(JSON.stringify({
            error: "Failed to process NCM rate data",
            raw_response: rateData
          }, null, 2));
        }
      });

    } catch (error) {
      res.writeHead(500, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        error: "Failed to process NCM branch data",
        details: error.message
      }, null, 2));
    }
  });

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
