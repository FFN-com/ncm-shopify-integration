const http = require("http");
const https = require("https");
const ExcelJS = require("exceljs");

const port = process.env.PORT || 10000;
function getDeliveryZone(city, address) {
  const location = `${city || ""} ${address || ""}`.toUpperCase();

  const valleyAreas = [
    "KATHMANDU",
    "LALITPUR",
    "BHAKTAPUR"
  ];

  const isInsideValley = valleyAreas.some(area =>
    location.includes(area)
  );

  if (isInsideValley) {
    return {
      zone: "KATHMANDU_VALLEY",
      delivery_type: "VALLEY"
    };
  }

  return {
    zone: "OUTSIDE_KATHMANDU_VALLEY",
    delivery_type: "OUTSIDE_VALLEY"
  };
}

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
  console.log("REQUEST RECEIVED:", req.method, req.url);

  // Hello test
  if (req.url === "/hello") {
    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("Hello! Render is running the latest code.");
    return;
  }

  // Test Shopify access token
if (req.url.startsWith("/test-shopify-token")) {
  getShopifyAccessToken()
    .then((data) => {
      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        test_mode: true,
        shopify_response: data
      }, null, 2));
    })
    .catch((error) => {
      res.writeHead(500, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        test_mode: true,
        error: error.message
      }, null, 2));
    });

  return;
}

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
 getNcmData("/api/v2/branches", (statusCode, data) => {
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
// Shopify orders/create webhook - test receiver
if (req.method === "POST" && req.url === "/webhooks/orders-create") {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    try {
      const order = JSON.parse(body);

      console.log("New Shopify order received:");
      console.log(JSON.stringify(order, null, 2));

      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        received: true,
        test_mode: true,
        message: "Shopify order webhook received successfully",
        order_id: order.id,
        order_name: order.name,
        shipping_city: order.shipping_address
          ? order.shipping_address.city
          : null
      }));

    } catch (error) {
      res.writeHead(400, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        received: false,
        error: "Invalid Shopify webhook data",
        details: error.message
      }));
    }
  });

  return;
}
  // Get Shopify access token
async function getShopifyAccessToken() {
  const shop = process.env.SHOPIFY_STORE;

  const response = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {

      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET
      })
    }
  );

  const text = await response.text();

  return {
    status: response.status,
    content_type: response.headers.get("content-type"),
    body: text
  };
}
// Test Shopify orders
if (req.url.startsWith("/test-shopify-orders")) {
  getShopifyAccessToken()
    .then(async (tokenData) => {
      const tokenResponse = JSON.parse(tokenData.body);
      const accessToken = tokenResponse.access_token;

      const shop = process.env.SHOPIFY_STORE;

      const response = await fetch(
        `https://${shop}/admin/api/2026-07/orders.json?status=any&limit=5`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          }
        }
      );

      const data = await response.json();

      res.writeHead(response.status, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        test_mode: true,
        shopify_orders: data
      }, null, 2));
    })
    .catch((error) => {
      res.writeHead(500, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        test_mode: true,
        error: error.message
      }, null, 2));
    });

  return;
}
  // Test Shopify order delivery with NCM
if (req.url.startsWith("/test-order-delivery")) {
  getShopifyAccessToken()
    .then(async (tokenData) => {
      const tokenResponse = JSON.parse(tokenData.body);
      const accessToken = tokenResponse.access_token;
      const shop = process.env.SHOPIFY_STORE;

      // Get the latest Shopify order
      const shopifyResponse = await fetch(
        `https://${shop}/admin/api/2026-07/orders.json?status=any&limit=1`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          }
        }
      );

      const shopifyData = await shopifyResponse.json();

      if (!shopifyData.orders || shopifyData.orders.length === 0) {
        res.writeHead(404, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          test_mode: true,
          error: "No Shopify orders found"
        }, null, 2));

        return;
      }

      const order = shopifyData.orders[0];

      if (!order.shipping_address) {
        res.writeHead(400, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          test_mode: true,
          error: "This order does not have a shipping address",
          order_id: order.id,
          order_name: order.name
        }, null, 2));

        return;
      }

      const customerCity = order.shipping_address.city || "";
      const customerAddress = order.shipping_address.address1 || "";
      const deliveryZone = getDeliveryZone(
  customerCity,
  customerAddress
);

const searchAddress = customerCity.trim().toUpperCase();

// Handle Kathmandu Valley separately
if (deliveryZone.zone === "KATHMANDU_VALLEY") {
  const valleyDeliveryMethod = "NCM_VALLEY_TEST";

  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    test_mode: true,
    message: "Kathmandu Valley delivery test successful. No real delivery was created.",

    shopify_order: {
      id: order.id,
      name: order.name,
      customer_city: customerCity,
      customer_address: customerAddress,
      delivery_zone: deliveryZone.zone,
      delivery_type: deliveryZone.delivery_type
    },

    valley_delivery: {
      enabled: true,
      method: valleyDeliveryMethod,
      pickup_branch: "TINKUNE",
      customer_location: customerAddress || customerCity,
      status: "TEST_ONLY",
      message: "Kathmandu Valley order successfully entered the Valley delivery flow."
    }
  }, null, 2));

  return;
}

// Outside Kathmandu Valley: find matching NCM branch
getNcmData("/api/v2/branches", (branchStatusCode, branchData) => {
  try {
    const branches = JSON.parse(branchData);

    // Find matching NCM branch
    let selectedBranch = branches.find(branch =>
      (branch.name || "").trim().toUpperCase() === searchAddress
    );

    // Try matching NCM service areas
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
        message: "Shopify order received, but no matching NCM branch was found",
        order_id: order.id,
        order_name: order.name,
        customer_city: customerCity,
        customer_address: customerAddress,
        delivery_zone: deliveryZone.zone
      }, null, 2));

      return;
    }

    const source = "TINKUNE";
    const destination = selectedBranch.name;

    // Get NCM shipping rate
    const ratePath =
      `/api/v1/shipping-rate?creation=${encodeURIComponent(source)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&type=Send`;

    getNcmData(ratePath, (rateStatusCode, rateData) => {
      try {
        const rateResponse = JSON.parse(rateData);

        res.writeHead(200, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          test_mode: true,
          message: "Shopify order → NCM branch → shipping rate test successful. No delivery was created.",

          shopify_order: {
            id: order.id,
            name: order.name,
            customer_city: customerCity,
            customer_address: customerAddress,
            delivery_zone: deliveryZone.zone,
            delivery_type: deliveryZone.delivery_type
          },

          ncm: {
            source_branch: source,
            destination_branch: selectedBranch.name,
            branch_code: selectedBranch.code,
            district: selectedBranch.district_name,
            province: selectedBranch.province_name,
            shipping_rate: rateResponse
          }

        }, null, 2));

      } catch (error) {
        res.writeHead(500, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
          test_mode: true,
          error: "Failed to process NCM shipping rate",
          details: error.message,
          raw_response: rateData
        }, null, 2));
      }
    });

  } catch (error) {
    res.writeHead(500, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      test_mode: true,
      error: "Failed to process NCM branch data",
      details: error.message
    }, null, 2));
  }
});
})
    .catch((error) => {
      res.writeHead(500, {
        "Content-Type": "application/json"
      });

      res.end(JSON.stringify({
        test_mode: true,
        error: error.message
      }, null, 2));
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
