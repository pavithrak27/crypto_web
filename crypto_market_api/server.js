
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;



app.use(cors());
app.use(express.json());

// Load mock coin data
const coinsPath = path.join(__dirname, "mock", "coins.json");

function loadCoins() {
  const rawData = fs.readFileSync(coinsPath, "utf8");
  const parsedData = JSON.parse(rawData);

  if (!Array.isArray(parsedData)) {
    throw new Error("coins.json must contain a JSON array");
  }

  console.log(`Loaded ${parsedData.length} coins from mock data`);

  return parsedData;
}
let coins = loadCoins();

console.log("Coins file:", coinsPath);
console.log("Loaded coins count:", coins.length);
console.log("First coin:", coins[0]);

// In-memory watchlist
const watchlist = new Set(["bitcoin", "ethereum"]);

// Simple 60-second cache
const cache = new Map();

function getCached(key, callback) {
  const item = cache.get(key);

  if (item && Date.now() - item.time < 60000) {
    return item.data;
  }

  const data = callback();
  cache.set(key, { data, time: Date.now() });
  return data;
}

function clearCache() {
  cache.clear();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// ==================================================
// API 1: COINS
// List + search + pagination + filter + sort + details
// ==================================================

app.get("/api/coins", (req, res) => {
  try {
    // Optional details mode
    const id = req.query.id;

    if (id) {
      const coin = coins.find(
        (item) => item.id === String(id).toLowerCase()
      );

      if (!coin) {
        return sendError(res, 404, "Coin not found");
      }

      return res.json({
        success: true,
        data: {
          ...coin,
          description: `${coin.name} is a cryptocurrency. This is mock research data.`,
          data_source: "mock"
        }
      });
    }

    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.per_page ?? 10);
    const search = String(req.query.search ?? "").trim().toLowerCase();

    const sortBy = String(req.query.sort_by ?? "market_cap_rank");
    const order = String(req.query.order ?? "asc").toLowerCase();

    const allowedSortFields = [
      "name",
      "current_price",
      "market_cap",
      "market_cap_rank",
      "total_volume",
      "price_change_percentage_24h"
    ];

    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, "page must be a positive integer");
    }

    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      return sendError(res, 400, "per_page must be between 1 and 100");
    }

    if (!allowedSortFields.includes(sortBy)) {
      return sendError(res, 400, "Invalid sort_by field");
    }

    if (!["asc", "desc"].includes(order)) {
      return sendError(res, 400, "order must be asc or desc");
    }

    const minPrice =
      req.query.min_price === undefined ? null : Number(req.query.min_price);

    const maxPrice =
      req.query.max_price === undefined ? null : Number(req.query.max_price);

    if (
      (minPrice !== null && !Number.isFinite(minPrice)) ||
      (maxPrice !== null && !Number.isFinite(maxPrice))
    ) {
      return sendError(res, 400, "Price filters must be valid numbers");
    }

    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      return sendError(res, 400, "min_price cannot exceed max_price");
    }

    const change = String(req.query.change ?? "").toLowerCase();

    if (change && !["positive", "negative"].includes(change)) {
      return sendError(res, 400, "change must be positive or negative");
    }

    const result = getCached(
      JSON.stringify({
        page, perPage, search, sortBy, order,
        minPrice, maxPrice, change
      }),
      () => {
        // Search and filter
        let filtered = coins.filter((coin) => {
          const matchesSearch =
            !search ||
            coin.name.toLowerCase().includes(search) ||
            coin.symbol.toLowerCase().includes(search) ||
            coin.id.toLowerCase().includes(search);

          const price = Number(coin.current_price);

          const matchesMin =
            minPrice === null || price >= minPrice;

          const matchesMax =
            maxPrice === null || price <= maxPrice;

          const changeValue = Number(
            coin.price_change_percentage_24h ?? 0
          );

          const matchesChange =
            !change ||
            (change === "positive" && changeValue > 0) ||
            (change === "negative" && changeValue < 0);

          return (
            matchesSearch &&
            matchesMin &&
            matchesMax &&
            matchesChange
          );
        });

        // Sorting
        filtered.sort((a, b) => {
          const first = a[sortBy];
          const second = b[sortBy];

          const comparison =
            typeof first === "string"
              ? first.localeCompare(second)
              : Number(first ?? 0) - Number(second ?? 0);

          return order === "asc" ? comparison : -comparison;
        });

        // Pagination after search/filter/sort
        const total = filtered.length;
        const totalPages = Math.ceil(total / perPage);
        const start = (page - 1) * perPage;

        return {
          success: true,
          data: filtered.slice(start, start + perPage),
          pagination: {
            page,
            per_page: perPage,
            total,
            total_pages: totalPages,
            has_next: page < totalPages,
            has_previous: page > 1
          },
          data_source: "mock"
        };
      }
    );

    res.json(result);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch coins");
  }
});

// ==================================================
// API 2: MARKET STATISTICS
// GET /api/market-stats
// ==================================================

app.get("/api/market-stats", (req, res) => {
  try {
    const result = getCached("market-stats", () => {
      const totalMarketCap = coins.reduce(
        (sum, coin) => sum + Number(coin.market_cap ?? 0),
        0
      );

      const totalVolume = coins.reduce(
        (sum, coin) => sum + Number(coin.total_volume ?? 0),
        0
      );

      const positive = coins.filter(
        (coin) => Number(coin.price_change_percentage_24h ?? 0) > 0
      ).length;

      const bitcoin = coins.find((coin) => coin.id === "bitcoin");

      return {
        success: true,
        data: {
          active_cryptocurrencies: 10000,
          markets: 500,
          total_market_cap: { usd: totalMarketCap },
          total_volume: { usd: totalVolume },
          market_cap_percentage: {
            btc: totalMarketCap > 0
              ? Number(
                ((Number(bitcoin?.market_cap ?? 0) / totalMarketCap) * 100)
                  .toFixed(2)
              )
              : 0
          },
          market_positive_coins: positive,
          market_negative_coins: coins.length - positive,
          data_source: "mock"
        }
      };
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to fetch market statistics");
  }
});


app.get("/api/watchlist", (req, res) => {
  const data = coins.filter((coin) => watchlist.has(coin.id));

  res.json({
    success: true,
    data,
    total: data.length,
    data_source: "mock"
  });
});

app.post("/api/watchlist", (req, res) => {
  const coinId = String(req.body?.coin_id ?? "").toLowerCase();

  if (!coinId) {
    return sendError(res, 400, "coin_id is required");
  }

  const coin = coins.find((item) => item.id === coinId);

  if (!coin) {
    return sendError(res, 404, "Coin not found");
  }

  if (watchlist.has(coinId)) {
    return res.json({
      success: true,
      message: "Coin is already in watchlist",
      data: coin
    });
  }

  watchlist.add(coinId);

  res.status(201).json({
    success: true,
    message: "Coin added to watchlist",
    data: coin
  });
});

app.delete("/api/watchlist", (req, res) => {
  const coinId = String(req.query.id ?? "").toLowerCase();

  if (!coinId) {
    return sendError(res, 400, "Provide the coin id using ?id=bitcoin");
  }

  if (!watchlist.has(coinId)) {
    return sendError(res, 404, "Coin not found in watchlist");
  }

  watchlist.delete(coinId);

  res.json({
    success: true,
    message: "Coin removed from watchlist"
  });
});

// Unknown endpoint
app.use((req, res) => {
  sendError(res, 404, "API endpoint not found");
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) return next(err);

  sendError(res, 500, "Internal server error");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Crypto API running at 192.168.1.15:${PORT}`);
});
