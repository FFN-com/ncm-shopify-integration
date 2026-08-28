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
function getNcmDataAsync(path) {
  return new Promise((resolve, reject) => {
    getNcmData(path, (statusCode, data) => {
      if (statusCode < 200 || statusCode >= 300) {
        reject(
          new Error(`NCM API error ${statusCode}: ${data}`)
        );
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(
          new Error(
            `Invalid JSON received from NCM API: ${data}`
          )
        );
      }
    });
  });
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
    // Export complete NCM price list to Excel
  if (req.url === "/export-ncm-prices") {

    (async () => {
      try {

        const source = "TINKUNE";

        console.log("Starting NCM Excel export...");

        // Get all NCM branches
        const branches =
          await getNcmDataAsync("/api/v2/branches");

        console.log(
          `Found ${branches.length} NCM branches`
        );

        const results = [];

        // Get both prices for every branch
        for (let i = 0; i < branches.length; i++) {

          const branch = branches[i];

          const destination =
            (branch.name || "").trim();

          if (!destination) {
            continue;
          }

          console.log(
            `Processing ${i + 1}/${branches.length}: ${destination}`
          );

          try {

            const sendPath =
              `/api/v1/shipping-rate?creation=${encodeURIComponent(source)}` +
              `&destination=${encodeURIComponent(destination)}` +
              `&type=Send`;

            const b2bPath =
              `/api/v1/shipping-rate?creation=${encodeURIComponent(source)}` +
              `&destination=${encodeURIComponent(destination)}` +
              `&type=B2B`;

            // Fetch Branch → Door
            const sendResponse =
              await getNcmDataAsync(sendPath);

            // Fetch Branch → Branch
            const b2bResponse =
              await getNcmDataAsync(b2bPath);

            results.push({
              sn: results.length + 1,
              branch_code: branch.code || "",
              branch_name: branch.name || "",
              district: branch.district_name || "",
              province: branch.province_name || "",
              branch_to_branch:
                b2bResponse.charge ?? "",
              branch_to_door:
                sendResponse.charge ?? "",
              status: "SUCCESS"
            });

          } catch (error) {

            console.error(
              `Failed for ${destination}:`,
              error.message
            );

            // Keep failed destinations in Sheet 1
            results.push({
              sn: results.length + 1,
              branch_code: branch.code || "",
              branch_name: branch.name || "",
              district: branch.district_name || "",
              province: branch.province_name || "",
              branch_to_branch: "",
              branch_to_door: "",
              status: `FAILED: ${error.message}`
            });
          }

          // Small delay to avoid overwhelming NCM API
          await new Promise(resolve =>
            setTimeout(resolve, 100)
          );
        }

        console.log(
          `Finished processing ${results.length} destinations`
        );

        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();

        workbook.creator = "NCM Shopify Integration";
        workbook.created = new Date();

        // ==========================================
        // SHEET 1: ALL NCM LOCATIONS & PRICES
        // ==========================================

        const allSheet =
          workbook.addWorksheet(
            "All NCM Locations & Prices"
          );

        allSheet.columns = [
          {
            header: "S.N.",
            key: "sn",
            width: 8
          },
          {
            header: "Branch Code",
            key: "branch_code",
            width: 18
          },
          {
            header: "Branch / Location",
            key: "branch_name",
            width: 28
          },
          {
            header: "District",
            key: "district",
            width: 22
          },
          {
            header: "Province",
            key: "province",
            width: 22
          },
          {
            header: "Branch → Branch (NPR)",
            key: "branch_to_branch",
            width: 25
          },
          {
            header: "Branch → Door (NPR)",
            key: "branch_to_door",
            width: 23
          },
          {
            header: "Status",
            key: "status",
            width: 25
          }
        ];

        results.forEach(row => {
          allSheet.addRow(row);
        });

        allSheet.views = [
          {
            state: "frozen",
            ySplit: 1
          }
        ];

        allSheet.autoFilter =
          `A1:H${allSheet.rowCount}`;

        allSheet.getRow(1).font = {
          bold: true
        };

        // ==========================================
        // SHEET 2: GROUPED BY SAME PRICE
        // ==========================================

        const groupedSheet =
          workbook.addWorksheet(
            "Grouped by Same Price"
          );

        groupedSheet.columns = [
          {
            header: "Group",
            key: "group",
            width: 10
          },
          {
            header: "Branch → Branch (NPR)",
            key: "branch_to_branch",
            width: 25
          },
          {
            header: "Branch → Door (NPR)",
            key: "branch_to_door",
            width: 23
          },
          {
            header: "Number of Locations",
            key: "count",
            width: 22
          },
          {
            header: "Locations",
            key: "locations",
            width: 100
          }
        ];

        // Only group successful records
        const successfulResults =
          results.filter(row =>
            row.status === "SUCCESS"
          );

        const grouped = {};

        successfulResults.forEach(row => {

          const key =
            `${row.branch_to_branch}|${row.branch_to_door}`;

          if (!grouped[key]) {
            grouped[key] = {
              branch_to_branch:
                row.branch_to_branch,
              branch_to_door:
                row.branch_to_door,
              locations: []
            };
          }

          grouped[key].locations.push(
            row.branch_name
          );
        });

        const groups =
          Object.values(grouped)
            .sort((a, b) => {

              const b2bDifference =
                Number(a.branch_to_branch) -
                Number(b.branch_to_branch);

              if (b2bDifference !== 0) {
                return b2bDifference;
              }

              return (
                Number(a.branch_to_door) -
                Number(b.branch_to_door)
              );
            });

        groups.forEach((group, index) => {

          groupedSheet.addRow({
            group: index + 1,
            branch_to_branch:
              group.branch_to_branch,
            branch_to_door:
              group.branch_to_door,
            count:
              group.locations.length,
            locations:
              group.locations.join(", ")
          });
        });

        groupedSheet.views = [
          {
            state: "frozen",
            ySplit: 1
          }
        ];

        groupedSheet.autoFilter =
          `A1:E${groupedSheet.rowCount}`;

        groupedSheet.getRow(1).font = {
          bold: true
        };

        // Send Excel file
        const fileName =
          "NCM_Tinkune_All_Branch_Prices.xlsx";

        res.writeHead(200, {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          "Content-Disposition":
            `attachment; filename="${fileName}"`
        });

        await workbook.xlsx.write(res);

        res.end();

        console.log(
          "NCM Excel export completed successfully"
        );

      } catch (error) {

        console.error(
          "Excel export failed:",
          error
        );

        if (!res.headersSent) {

          res.writeHead(500, {
            "Content-Type":
              "application/json"
          });

          res.end(
            JSON.stringify({
              success: false,
              error:
                "Failed to generate NCM Excel file",
              details:
                error.message
            }, null, 2)
          );
        }
      }

    })();

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
